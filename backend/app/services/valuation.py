"""宽基指数估值区间（指数概览/指数成分增补：长历史 PE/PB → 高估还是低估）

数据来自乐咕乐股（providers/legulegu），上游按 IP 限流且只有它给日线级长序列，
所以抓一次就归档进 index_valuation_history，页面只读库；每天 18:40 定时补一次。
判定口径：把当前 PE/PB 放进选定窗口（全部/10/5/3 年）的历史序列里排百分位，
分位低=便宜，分位高=贵，越长的窗口越能说明「相对历史」而不是「相对最近几个月」。
"""
from __future__ import annotations

import threading
import time
from bisect import bisect_right
from datetime import datetime
from typing import Any

import requests

from .. import config, db
from ..providers import registry
from ..providers.base import ProviderError

# 有长历史的宽基：乐咕只认这些代码（上证综指/科创50/北证50 实测返回空数组）
UNIVERSE: list[dict] = [
    {"code": "000016.SH", "name": "上证50", "kind": "index"},
    {"code": "000010.SH", "name": "上证180", "kind": "index"},
    {"code": "000903.SH", "name": "中证100", "kind": "index"},
    {"code": "000300.SH", "name": "沪深300", "kind": "index"},
    {"code": "000905.SH", "name": "中证500", "kind": "index"},
    {"code": "000852.SH", "name": "中证1000", "kind": "index"},
    {"code": "000906.SH", "name": "中证800", "kind": "index"},
    {"code": "000009.SH", "name": "上证380", "kind": "index"},
    {"code": "000015.SH", "name": "上证红利", "kind": "index"},
    {"code": "399673.SZ", "name": "创业板50", "kind": "index"},
    {"code": "399330.SZ", "name": "深证100", "kind": "index"},
    {"code": "399324.SZ", "name": "深证红利", "kind": "index"},
    # 下面四条是整个市场的口径，不是某个指数的估值，界面要标清楚
    {"code": "MKT1", "name": "沪市整体", "kind": "market", "market_id": "1"},
    {"code": "MKT2", "name": "深市整体", "kind": "market", "market_id": "2"},
    {"code": "MKT4", "name": "创业板整体", "kind": "market", "market_id": "4"},
    {"code": "MKT7", "name": "科创板整体", "kind": "market", "market_id": "7"},
]
BY_CODE = {i["code"]: i for i in UNIVERSE}

# 成分页的指数 key → 估值代码。科创50 指数本身没有长历史估值（乐咕接口回空数组），
# 用整个科创板的口径顶上，界面必须写清是近似；北证50 两个口径都没有，不映射。
COMPONENT_VALUATION = {"hs300": "000300.SH", "sz50": "000016.SH", "zz500": "000905.SH",
                       "sse180": "000010.SH", "kc50": "MKT7"}
COMPONENT_VALUATION_NOTE = {"kc50": "科创板没有单独的长历史估值，这里用整个科创板的口径近似"}

# 分位判定的对照基准：所有指数都再和沪深300 比一次，回答「便宜是跟自己比还是真便宜」
BENCHMARK_CODE = "000300.SH"

SOURCE_NOTE = ("估值序列取自乐咕乐股（月度整体法，PE 为滚动口径）；"
               "沪市/深市/创业板/科创板四条是全市场整体估值，不等于对应指数本身")

# 分位 → 白话判定：30%/70% 是基金行业通用的「便宜/贵」切点，这里再细切成五档。
# 每一档说的都是「相对它自己的历史」，横向贵不贵看 vs沪深300 那一块。
VERDICTS = [
    {"hi": 0.20, "key": "very_low", "label": "很便宜", "tone": "emerald",
     "meaning": "比它自己历史上八成以上时间都低；只是纵向便宜，不代表比别的指数便宜"},
    {"hi": 0.35, "key": "low", "label": "偏低", "tone": "teal",
     "meaning": "处在它自己的历史下沿，估值不是当前主要风险"},
    {"hi": 0.65, "key": "mid", "label": "中性", "tone": "amber",
     "meaning": "在它自己历史中位附近，涨跌更多靠业绩和资金面驱动"},
    {"hi": 0.80, "key": "high", "label": "偏高", "tone": "orange",
     "meaning": "已经高于它自己历史大部分时间，回撤空间开始累积"},
    {"hi": 1.01, "key": "very_high", "label": "高估", "tone": "rose",
     "meaning": "只在它自己历史上少数狂热阶段出现过，安全边际很薄"},
]

_cache: dict[str, tuple[float, Any]] = {}
_ensure_guard: dict[str, float] = {}
_lock = threading.Lock()
_refresh_lock = threading.Lock()
STATUS_KEY = "valuation_status"


def _cached(key: str, fn, ttl: float = 300.0):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def invalidate() -> None:
    with _lock:
        _cache.clear()


def set_status(**kw: Any) -> dict:
    cur = db.get_setting(STATUS_KEY, {}) or {}
    cur.update(kw)
    db.set_setting(STATUS_KEY, cur)
    return cur


def status() -> dict:
    st = db.get_setting(STATUS_KEY, {}) or {}
    return {"running": bool(st.get("running")), "done": st.get("done", 0),
            "total": st.get("total", len(UNIVERSE)), "lastAt": st.get("last_at"),
            "errors": st.get("errors") or []}


def _rows_of(code: str) -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT trade_date,close,pe,pb,pe_equal,pe_median FROM index_valuation_history "
        "WHERE index_code=? ORDER BY trade_date", (code,))]


def _upsert(code: str, name: str, kind: str, raw: list[dict]) -> None:
    """缺值不会被 NULL 冲掉：上游半路挂掉时（PB 504）库里已有的值要留着"""
    stamp = db.now()
    db.executemany(
        "INSERT INTO index_valuation_history(index_code,trade_date,name,kind,close,pe,pb,"
        "pe_equal,pe_median,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(index_code,trade_date) DO UPDATE SET "
        "name=excluded.name, "
        "close=COALESCE(excluded.close, index_valuation_history.close), "
        "pe=COALESCE(excluded.pe, index_valuation_history.pe), "
        "pb=COALESCE(excluded.pb, index_valuation_history.pb), "
        "pe_equal=COALESCE(excluded.pe_equal, index_valuation_history.pe_equal), "
        "pe_median=COALESCE(excluded.pe_median, index_valuation_history.pe_median), "
        "updated_at=excluded.updated_at",
        [(code, r["date"], name, kind, r.get("close"), r.get("pe"), r.get("pb"),
          r.get("pe_equal"), r.get("pe_median"), stamp) for r in raw])


def refresh_item(item: dict) -> dict:
    """抓一个指数的估值历史并 upsert；返回 {code,name,rows,error}"""
    code, name, kind = item["code"], item["name"], item["kind"]
    try:
        if kind == "market":
            raw = registry.market_valuation(item["market_id"])
        else:
            raw = registry.index_valuation(code)
    except ProviderError as exc:
        return {"code": code, "name": name, "rows": 0, "error": exc.message}
    if not raw:
        return {"code": code, "name": name, "rows": 0,
                "error": "上游没有这个代码的估值序列（乐咕只覆盖部分宽基）"}
    _upsert(code, name, kind, raw)
    return {"code": code, "name": name, "rows": len(raw), "error": None}


def refresh_all(trigger: str = "manual") -> dict:
    """整轮重建：16 个对象 × 2 次请求，被上游限流拖成 1 分多钟，所以只在后台线程跑"""
    with _refresh_lock:
        set_status(running=True, done=0, total=len(UNIVERSE), errors=[],
                   trigger=trigger, started_at=db.now())
        done = 0
        errors: list[str] = []
        for item in UNIVERSE:
            out = refresh_item(item)
            done += 1
            if out["error"]:
                errors.append(f'{out["name"]}：{out["error"]}')
            set_status(done=done, errors=errors[-8:])
        set_status(running=False, done=done, errors=errors, last_at=db.now())
        invalidate()
        return {"ok": not errors, "objects": done, "errors": errors,
                "message": f"重建 {done} 个估值序列，{len(errors)} 个失败"}


def export_snapshot() -> dict:
    """导出成 JSON 给 GitHub Actions 回写；本机以外的环境靠这份文件续数据"""
    out = {}
    for item in UNIVERSE:
        rows = _rows_of(item["code"])
        if not rows:
            continue
        out[item["code"]] = {
            "name": item["name"], "kind": item["kind"],
            "rows": [{"date": r["trade_date"], "close": r["close"], "pe": r["pe"],
                      "pb": r["pb"], "pe_equal": r["pe_equal"],
                      "pe_median": r["pe_median"]} for r in rows],
        }
    return {"generatedAt": db.now(), "objects": out}


def sync_from_github() -> dict:
    """乐咕整站 504 时不再干等：读 GitHub 上 Actions 每天回写的估值快照"""
    try:
        resp = requests.get(config.GITHUB_SNAPSHOT_URL, timeout=30,
                            headers={"User-Agent": "biaoge-local/1.0"})
        if resp.status_code != 200:
            return {"ok": False,
                    "message": f"云端估值快照读不到：HTTP {resp.status_code}（仓库还没跑过定时任务？）"}
        snap = resp.json()
    except (requests.RequestException, ValueError) as exc:
        return {"ok": False, "message": f"云端估值快照读不到：{type(exc).__name__}"}
    codes = written = 0
    for code, blob in (snap.get("objects") or {}).items():
        item = BY_CODE.get(code)
        rows = (blob or {}).get("rows") or []
        if not item or not rows:
            continue
        _upsert(code, item["name"], item["kind"], rows)
        codes += 1
        written += len(rows)
    invalidate()
    if not codes:
        return {"ok": False, "message": "云端快照里没有任何估值对象"}
    return {"ok": True, "objects": codes, "rows": written,
            "generatedAt": snap.get("generatedAt"),
            "message": f"从云端补了 {codes} 个对象 / {written} 行，快照生成于 {snap.get('generatedAt')}"}


def ensure(code: str) -> dict | None:
    """库里没有这个代码就现抓一次（首屏点开没归档的指数用得上）"""
    item = BY_CODE.get(code)
    if not item:
        return None
    if not db.query_one("SELECT 1 AS x FROM index_valuation_history WHERE index_code=? LIMIT 1",
                        (code,)):
        # 上游被限流时别每次开页面都重试，留 10 分钟冷却
        if time.time() - _ensure_guard.get(code, 0.0) < 600:
            return item
        _ensure_guard[code] = time.time()
        refresh_item(item)
    return item


def _stats(values: list[float]) -> dict:
    if not values:
        return {"count": 0}
    s = sorted(values)

    def q(p: float) -> float:
        if len(s) == 1:
            return s[0]
        idx = p * (len(s) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(s) - 1)
        return s[lo] + (s[hi] - s[lo]) * (idx - lo)

    return {"count": len(s), "min": round(s[0], 2), "max": round(s[-1], 2),
            "avg": round(sum(s) / len(s), 2), "p25": round(q(0.25), 2),
            "median": round(q(0.5), 2), "p75": round(q(0.75), 2),
            "p10": round(q(0.1), 2), "p90": round(q(0.9), 2), "sorted": s}


def _verdict(percentile: float | None) -> dict | None:
    if percentile is None:
        return None
    for v in VERDICTS:
        if percentile < v["hi"]:
            return dict(v)
    return dict(VERDICTS[-1])


def _percentile(sorted_vals: list[float], cur: float | None) -> float | None:
    if cur is None or not sorted_vals:
        return None
    return round(bisect_right(sorted_vals, cur) / len(sorted_vals), 4)


def _metric_block(rows: list[dict], key: str, begin: str | None = None,
                  end: str | None = None) -> dict:
    pairs = [(r["trade_date"], r.get(key)) for r in rows
             if isinstance(r.get(key), (int, float))
             and r.get(key) and r[key] > 0
             and (begin is None or r["trade_date"] >= begin)
             and (end is None or r["trade_date"] <= end)]
    vals = [v for _d, v in pairs]
    st = _stats(vals)
    cur = pairs[-1][1] if pairs else None
    date = pairs[-1][0] if pairs else None
    s = st.get("sorted") or []
    pct = _percentile(s, cur)
    span = {"years": None, "begin": None, "end": None}
    if pairs:
        begin, end = pairs[0][0], pairs[-1][0]
        span = {"begin": begin, "end": end,
                "years": round((datetime.fromisoformat(end)
                                - datetime.fromisoformat(begin)).days / 365.25, 1)}
    out = {"value": cur, "date": date, "percentile": pct, "verdict": _verdict(pct),
           "window": span, "series": [{"x": d, "y": v} for d, v in pairs],
           "low": st.get("min"), "high": st.get("max"), "avg": st.get("avg"),
           "p25": st.get("p25"), "median": st.get("median"), "p75": st.get("p75"),
           "p10": st.get("p10"), "p90": st.get("p90"), "points": st.get("count", 0)}
    # 区间位置：当前值在过去多少个点之上/之下，给进度条用
    if s and cur is not None and out["low"] is not None and out["high"] is not None:
        rng = out["high"] - out["low"]
        out["position"] = round((cur - out["low"]) / rng, 4) if rng > 0 else None
    else:
        out["position"] = None
    return out


def _window(rows: list[dict], years: float | None, start: str | None,
            end: str | None) -> tuple[str | None, str | None, str]:
    """手动区间优先；没给区间就按年数回推；都没有就是全部历史"""
    if not rows:
        return start, end, "无数据"
    if start or end:
        begin = start or rows[0]["trade_date"]
        stop = end or rows[-1]["trade_date"]
        return begin, stop, f"{begin} ~ {stop}"
    if years:
        last = datetime.fromisoformat(rows[-1]["trade_date"])
        begin = last.replace(year=int(last.year - int(years))).strftime("%Y-%m-%d")
        return begin, None, f"近{int(years)}年"
    return None, None, "全部历史"


def _relative_block(rows: list[dict], begin: str | None, end: str | None,
                    code: str) -> dict | None:
    """和沪深300 的 PE 比价：纵向便宜之外，再看横向贵不贵（按月对齐，容忍两边月末日期不同）"""
    if code == BENCHMARK_CODE:
        return None
    ensure(BENCHMARK_CODE)
    base = _rows_of(BENCHMARK_CODE)
    if not base:
        return None
    by_month: dict[str, float] = {}
    for r in base:
        v = r.get("pe")
        if isinstance(v, (int, float)) and v and v > 0:
            by_month[r["trade_date"][:7]] = v
    pairs = []
    for r in rows:
        d = r["trade_date"]
        v, b = r.get("pe"), by_month.get(d[:7])
        if not (isinstance(v, (int, float)) and v and v > 0 and b):
            continue
        if (begin is None or d >= begin) and (end is None or d <= end):
            pairs.append((d, round(v / b, 3)))
    if len(pairs) < 8:
        return None
    st = _stats([v for _d, v in pairs])
    cur = pairs[-1][1]
    pct = _percentile(st["sorted"], cur)
    return {"benchmark": BY_CODE[BENCHMARK_CODE]["name"], "benchmarkCode": BENCHMARK_CODE,
            "ratio": cur, "percentile": pct, "verdict": _verdict(pct),
            "low": st["min"], "median": st["median"], "high": st["max"],
            "avg": st["avg"], "points": st["count"], "date": pairs[-1][0],
            "series": [{"x": d, "y": v} for d, v in pairs]}


def panel(code: str, years: float | None = None, refresh: bool = False,
          start: str | None = None, end: str | None = None) -> dict:
    """单指数估值面板：当前值 + 窗口分位 + 区间带 + 月度序列 + 相对沪深300 的比价"""
    item = ensure(code)
    if not item:
        return {"ok": False, "code": code,
                "error": f"{code} 不在估值序列覆盖范围内（乐咕只给部分宽基，"
                         f"科创50、北证50、上证综指都没有长历史）"}
    if refresh:
        refresh_item(item)
        invalidate()
    rows = _rows_of(code)
    if not rows:
        st = status()
        return {"ok": False, "code": code, "name": item["name"],
                "error": "估值历史库还没有这个指数"
                         + ("（首次建立中，约 1 分钟）" if st["running"] else "，点重建或等定时任务")}
    begin, stop, label = _window(rows, years, start, end)
    pe = _metric_block(rows, "pe", begin, stop)
    pb = _metric_block(rows, "pb", begin, stop)
    if pe["points"] < 2:
        return {"ok": False, "code": code, "name": item["name"],
                "error": f"所选区间里没有估值点：这个指数只有 {rows[0]['trade_date']} ~ "
                         f"{rows[-1]['trade_date']} 的数据",
                "windowLabel": label}
    pcts = [m["percentile"] for m in (pe, pb) if m.get("percentile") is not None]
    mixed = round(sum(pcts) / len(pcts), 4) if pcts else None
    bands = []
    if pe["points"] >= 8 and pe.get("p25") is not None and pe.get("p75") is not None:
        bands = [{"from": pe["low"], "to": pe["p25"], "tone": "low", "label": "便宜区"},
                 {"from": pe["p25"], "to": pe["p75"], "tone": "mid", "label": "合理区"},
                 {"from": pe["p75"], "to": pe["high"], "tone": "high", "label": "偏贵区"}]
    ref = []
    for v, label_ in ((pe.get("p25"), "低估线"), (pe.get("median"), "中位"), (pe.get("p75"), "高估线")):
        if v is not None:
            ref.append({"value": v, "label": label_})
    return {"ok": True, "code": code, "name": item["name"], "kind": item["kind"],
            "years": years, "start": start, "end": end,
            "windowLabel": label, "window": {"begin": begin, "end": stop,
                                             "first": rows[0]["trade_date"],
                                             "last": rows[-1]["trade_date"]},
            "pe": pe, "pb": pb, "percentile": mixed, "verdict": _verdict(mixed),
            "relative": _relative_block(rows, begin, stop, code),
            "bands": bands, "refLines": ref, "verdicts": VERDICTS,
            "rows": len(rows), "error": None, "source": "乐咕乐股", "note": SOURCE_NOTE,
            "status": status()}


def overview() -> dict:
    """宽基估值一览：每个对象一行，按 PE 分位从低到高排"""
    def load():
        out = []
        for item in UNIVERSE:
            rows = _rows_of(item["code"])
            if not rows:
                out.append({"code": item["code"], "name": item["name"], "kind": item["kind"],
                            "ready": False})
                continue
            pe = _metric_block(rows, "pe", None)
            pb = _metric_block(rows, "pb", None)
            rel = _relative_block(rows, None, None, item["code"])
            pcts = [m["percentile"] for m in (pe, pb) if m.get("percentile") is not None]
            out.append({"code": item["code"], "name": item["name"], "kind": item["kind"],
                        "ready": True, "date": pe["date"], "close": rows[-1].get("close"),
                        "pe": pe["value"], "pb": pb["value"],
                        "pePercentile": pe["percentile"], "pbPercentile": pb["percentile"],
                        "peMedian": pe["median"], "pbMedian": pb["median"],
                        "peLow": pe["low"], "peHigh": pe["high"],
                        "peRatio": rel["ratio"] if rel else None,
                        "peRatioPercentile": rel["percentile"] if rel else None,
                        "years": pe["window"]["years"], "begin": pe["window"]["begin"],
                        "verdict": _verdict(round(sum(pcts) / len(pcts), 4) if pcts else None),
                        "points": pe["points"]})
        ready = [r for r in out if r.get("ready")]
        ready.sort(key=lambda r: (r["pePercentile"] is None, r["pePercentile"]))
        pending = [r for r in out if not r.get("ready")]
        return ready + pending

    data = _cached("valuation:overview", load)
    return {"rows": data, "count": len(data), "note": SOURCE_NOTE,
            "verdicts": VERDICTS, "status": status(), "generatedAt": db.now()}
