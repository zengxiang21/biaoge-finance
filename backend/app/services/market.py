"""市场数据服务：全市场快照、涨跌分布、六维情绪、板块热度、榜单、涨停梯队"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, time as dtime
from typing import Any

from .. import config, db
from ..permissions import emotion_label
from ..providers import registry, sina, tencent
from ..providers.base import ProviderError

_progress_lock = threading.Lock()
PROGRESS: dict[str, Any] = {"state": "idle", "step": "", "done": 0, "total": 0,
                            "started_at": None, "finished_at": None, "error": None}
_live_date_cache: tuple[float, str | None] | None = None

UP_SORTS = {"amount": "amount", "turnoverratio": "turnoverratio",
            "changepercent": "changepercent", "pricechange": "pricechange"}


def _set_progress(**kw: Any) -> None:
    with _progress_lock:
        PROGRESS.update(kw)


def progress() -> dict:
    with _progress_lock:
        return dict(PROGRESS)


# ---------------------------------------------------------------- 交易时段
def market_phase(now: datetime | None = None) -> dict:
    now = now or datetime.now()
    hhmm = now.time()
    weekend = now.weekday() >= 6
    if weekend:
        phase, label = "closed_weekend", "周末休市"
    elif hhmm < dtime(9, 15):
        phase, label = "pre_open", "盘前"
    elif hhmm < dtime(9, 25):
        phase, label = "auction", "集合竞价"
    elif hhmm < dtime(9, 30):
        phase, label = "auction_end", "竞价结束待开盘"
    elif hhmm < dtime(11, 30):
        phase, label = "morning", "早盘交易中"
    elif hhmm < dtime(13, 0):
        phase, label = "lunch", "午间休市"
    elif hhmm < dtime(15, 0):
        phase, label = "afternoon", "午盘交易中"
    elif hhmm < dtime(15, 35):
        phase, label = "after_close", "盘后数据结算"
    else:
        phase, label = "closed", "已收盘"
    return {"phase": phase, "label": label, "trading": phase in ("morning", "afternoon"),
            "is_weekend": weekend, "now": now.strftime("%Y-%m-%d %H:%M:%S")}


def refresh_boards(date: str) -> list[str]:
    """板块热度 + 板块资金流。用新浪板块资金流做主源：它自带龙头股与涨跌停家数，
    比 oldSinaHy 热度表少 100 次逐板块抓龙头。fenlei 1=概念 2=行业"""
    notes: list[str] = []
    for kind, fenlei in (("concept", 1), ("industry", 2)):
        _set_progress(step=f"{'概念' if kind == 'concept' else '行业'}板块")
        # 资金流接口给的是 8 字短名（「装卸搬运和运输代」），板块列表接口才是完整分类名
        try:
            meta = {b["code"]: b for b in sina.board_list(kind)}
        except Exception:  # noqa: BLE001
            meta = {}
        try:
            rows = sina.money_flow_boards(fenlei=fenlei, num=100)
        except ProviderError as exc:
            notes.append(f"{kind} 板块资金流失败：{exc.message}")
            continue
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{kind} 板块资金流失败：{type(exc).__name__}")
            continue
        if not rows:
            notes.append(f"{kind} 板块资金流返回空")
            continue
        rows.sort(key=lambda b: b["avgChangePercent"], reverse=True)
        db.execute("DELETE FROM board_daily WHERE trade_date=? AND kind=?", (date, kind))
        db.execute("DELETE FROM board_fund_flow WHERE trade_date=? AND kind=?", (date, kind))
        for b in rows:
            chg = b["avgChangePercent"]
            name = meta.get(b["code"], {}).get("name") or b["name"]
            count = meta.get(b["code"], {}).get("stock_count")
            db.execute(
                "INSERT OR REPLACE INTO board_daily(trade_date,kind,code,name,change_percent,"
                "stock_count,amount,leader_name,leader_change) VALUES(?,?,?,?,?,?,?,?,?)",
                (date, kind, b["code"], name, chg, count,
                 round((b.get("inAmount") or 0) / 1e8, 3), b.get("leaderName"),
                 b.get("leaderChangePercent")))
            db.execute(
                "INSERT OR REPLACE INTO board_fund_flow(trade_date,kind,code,name,change_percent,"
                "net_amount,in_amount,out_amount,net_ratio,turnover,leader_name,leader_change) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (date, kind, b["code"], name, chg, b.get("netAmount"), b.get("inAmount"),
                 b.get("outAmount"), b.get("netRatio"), b.get("turnover"),
                 b.get("leaderName"), b.get("leaderChangePercent")))
    return notes


# ---------------------------------------------------------------- 快照构建
def build_snapshot(date_yyyymmdd: str | None = None, trigger: str = "manual",
                   with_sample_kline: bool = True) -> dict:
    """全市场快照 + 涨停池 + 板块 + 抽样均线，落到 market_daily"""
    if PROGRESS["state"] == "running":
        return {"ok": False, "message": "已有快照任务在跑，请等待", **PROGRESS}

    started = datetime.now()
    _set_progress(state="running", step="准备", done=0, total=0,
                  started_at=started.strftime("%Y-%m-%d %H:%M:%S"), finished_at=None, error=None)
    job_id = db.execute("INSERT INTO job_runs(job,status,trigger,started_at) VALUES(?,?,?,?)",
                        ("daily_snapshot", "running", trigger, started.strftime("%Y-%m-%d %H:%M:%S")))
    notes: list[str] = []
    try:
        # 1) 全市场快照
        _set_progress(step="全市场快照")
        rows: list[dict] = []
        try:
            for r in sina.spot_all(max_pages=config.SNAPSHOT_PAGES):
                rows.append(r)
                with _progress_lock:
                    PROGRESS["done"] = len(rows)
                    PROGRESS["total"] = 5600
        except ProviderError as exc:
            notes.append(f"全市场快照中断：{exc.message}")
        stocks = _normalize_spot(rows)
        date = date_yyyymmdd or live_quote_date() or registry.trade_date_hint()

        if stocks:
            _store_stocks(date, stocks)

        up = sum(1 for s in stocks if s["change_percent"] > 0)
        down = sum(1 for s in stocks if s["change_percent"] < 0)
        flat = max(len(stocks) - up - down, 0)
        amount = sum(s["amount"] or 0 for s in stocks) / 1e8      # 亿元
        volume = sum(s["volume"] or 0 for s in stocks) / 1e8      # 亿股

        # 2) 涨停/炸板/跌停池
        _set_progress(step="涨停池")
        pools = registry.limit_pools(date)
        stored = _store_limit_pool(date, pools)
        if pools["errors"]:
            notes.append("涨停池部分失败：" + ", ".join(pools["errors"].keys()))
        # 昨日晋级要拿前一交易日的池子比，历史不满一周就顺手补几天
        filled = backfill_limit_pools(before=date)
        for f in filled:
            if f["errors"]:
                notes.append(f"{f['date']} 池补齐部分失败：{','.join(f['errors'])}")
        limit_up = pools["counts"]["limit_up"] or sum(1 for s in stocks if _at_limit(s, 1))
        blown = pools["counts"]["blown"]
        limit_down = pools["counts"]["limit_down"] or sum(1 for s in stocks if _at_limit(s, -1))

        # 3) 板块热度：行业 + 概念，首尾各 5 个板块补龙头股
        _set_progress(step="板块热度")
        notes += refresh_boards(date)

        # 4) 均线/新高新低：优先用本地日线缓存全量算（5576 只），缓存没覆盖才退回抽样
        trend = {"ma5": None, "ma20": None, "ma60": None, "new_high": None, "new_low": None,
                 "total": 0}
        if with_sample_kline and stocks:
            from . import kline as kline_svc
            trend = kline_svc.trend_breadth(date)
            if not trend.get("total"):
                _set_progress(step=f"抽样K线（前{config.SNAPSHOT_SAMPLE_K_LINES}只）")
                trend = _sample_kline_stats(
                    sorted(stocks, key=lambda s: s["amount"] or 0, reverse=True)
                    [:config.SNAPSHOT_SAMPLE_K_LINES])
                notes.append(f"均线 breadth 来自 {trend['total']} 只抽样，全市场缓存未覆盖")
        ma_ratio = trend["ma20"]
        high_cnt, low_cnt = trend["new_high"], trend["new_low"]

        # 5) 成交额环比：基准来自历史成交额表（每天收盘把全市场成交额存下来）
        from . import kline as kline_svc
        kline_svc.backfill_amount_baseline(date)
        prev_row = db.query_one("SELECT trade_date, amount FROM amount_baseline WHERE trade_date<? "
                                "ORDER BY trade_date DESC LIMIT 1", (date,))
        amount_vs_prev = round((amount / prev_row["amount"] - 1) * 100, 2) \
            if prev_row and prev_row["amount"] else None
        if amount_vs_prev is None:
            notes.append("成交额环比待更新：历史基准不足一个交易日，下一个交易日自动补上")

        dims = compute_dims(
            index_change=live_index_avg(),
            up=up, down=down,
            amount_vs_prev=amount_vs_prev,
            limit_up=limit_up, blown=blown,
            ma20_above_ratio=ma_ratio, new_high=high_cnt, new_low=low_cnt,
        )
        score = composite_score(dims)
        finished = datetime.now()
        db.execute(
            "INSERT OR REPLACE INTO market_daily(trade_date,total,up,down,flat,limit_up,limit_down,"
            "blown,amount,volume,ma20_above_ratio,new_high_count,new_low_count,amount_vs_prev,"
            "dims,score,built_at,source_note,ma5_above_ratio,ma60_above_ratio,sample_total) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (date, len(stocks), up, down, flat, limit_up, limit_down, blown, round(amount, 2),
             round(volume, 3), ma_ratio, high_cnt, low_cnt, amount_vs_prev,
             json.dumps(dims, ensure_ascii=False), score,
             finished.strftime("%Y-%m-%d %H:%M:%S"), "; ".join(notes) or "sina+eastmoney",
             trend["ma5"], trend["ma60"], trend["total"]))
        db.execute("INSERT OR REPLACE INTO amount_baseline(trade_date,amount,source) VALUES(?,?,?)",
                   (date, round(amount, 2), "market_daily_total"))
        db.execute("UPDATE job_runs SET status='ok',finished_at=?,detail=? WHERE id=?",
                   (finished.strftime("%Y-%m-%d %H:%M:%S"),
                    f"{date} 股票{len(stocks)}只 涨停{limit_up} 炸板{blown} 池{stored} 情绪{score}", job_id))
        _set_progress(state="done", step="完成", done=len(stocks), total=len(stocks),
                      finished_at=finished.strftime("%Y-%m-%d %H:%M:%S"), error=None)
        bust_date_cache()
        return {"ok": True, "trade_date": date, "stocks": len(stocks), "score": score,
                "seconds": round((finished - started).total_seconds(), 1), "notes": notes}
    except Exception as exc:  # noqa: BLE001
        _set_progress(state="error", error=f"{type(exc).__name__}: {exc}",
                      finished_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        db.execute("UPDATE job_runs SET status='error',finished_at=?,detail=? WHERE id=?",
                   (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), str(exc), job_id))
        raise
    finally:
        _set_progress(step="空闲")


def bust_date_cache() -> None:
    """快照重建后让行情日期与特征表缓存失效"""
    global _live_date_cache
    _live_date_cache = None
    from . import kline
    kline.invalidate()


def live_quote_date() -> str | None:
    """行情服务器给出的交易日，形如 20261023；周末/节假日不会误标成今天"""
    global _live_date_cache
    now = time.time()
    if _live_date_cache and now - _live_date_cache[0] < 120:
        return _live_date_cache[1]
    value: str | None = None
    try:
        for r in registry.index_quotes():
            d = str(r.get("date") or "")
            if len(d) == 10:
                value = d.replace("-", "")
                break
    except ProviderError:
        value = None
    if not value:
        row = db.query_one("SELECT trade_date FROM market_daily ORDER BY trade_date DESC LIMIT 1")
        value = row["trade_date"] if row else None
    _live_date_cache = (now, value)
    return value


def _normalize_spot(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        try:
            code = str(r["code"])
            prefix = str(r["symbol"])[:2]
            price = float(r["trade"])
            out.append({
                "symbol": r["symbol"], "code": code, "name": r["name"],
                "market": prefix,
                "price": price, "prev_close": float(r.get("settlement") or 0),
                "change_price": float(r.get("pricechange") or 0),
                "change_percent": round(float(r.get("changepercent") or 0), 2),
                "open": float(r.get("open") or 0), "high": float(r.get("high") or 0),
                "low": float(r.get("low") or 0),
                "volume": float(r.get("volume") or 0), "amount": float(r.get("amount") or 0),
                "turnover_ratio": float(r.get("turnoverratio") or 0),
                "pe": float(r.get("per") or 0), "pb": float(r.get("pb") or 0),
                "mkt_cap": float(r.get("mktcap") or 0) * 1e4,
                "nmc_cap": float(r.get("nmc") or 0) * 1e4,
                "ticktime": r.get("ticktime"),
                "is_st": 1 if ("ST" in str(r["name"]).upper()) else 0,
                "limit_rate": _limit_rate(str(r["name"]), prefix, code),
            })
        except (KeyError, ValueError, TypeError):
            continue
    return out


def _limit_rate(name: str, prefix: str, code: str) -> float:
    """主板 10% / 创业科创 20% / 北交所 30% / ST 5%"""
    if "ST" in name.upper():
        return 0.05
    if prefix == "bj":
        return 0.30
    if code.startswith(("30", "68")):
        return 0.20
    return 0.10


def _at_limit(s: dict, direction: int) -> bool:
    rate = s["limit_rate"] or 0.1
    prev = s["prev_close"] or 0
    if not prev:
        return False
    return abs(s["change_percent"] - direction * rate * 100) <= 0.6


def _store_stocks(date: str, stocks: list[dict]) -> None:
    db.execute("DELETE FROM snapshot_stocks WHERE trade_date=?", (date,))
    rows = [(date, s["symbol"], s["name"], s["price"], s["change_price"], s["change_percent"],
             s["open"], s["high"], s["low"], s["prev_close"], s["volume"], s["amount"],
             s["turnover_ratio"], s["pe"], s["pb"], s["mkt_cap"], s["nmc_cap"], s["ticktime"],
             s["is_st"], s["limit_rate"]) for s in stocks]
    db.executemany(
        "INSERT OR REPLACE INTO snapshot_stocks(trade_date,symbol,name,price,change_price,"
        "change_percent,open,high,low,prev_close,volume,amount,turnover_ratio,pe,pb,mkt_cap,"
        "nmc_cap,ticktime,is_st,limit_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)


def _store_limit_pool(date: str, pools: dict) -> int:
    """涨停/炸板/跌停三池分开存。哪个池这次没取到就留着原来的行，
    免得接口抽风把「今天有 12 只炸板」写成「今天 0 只」。"""
    specs = (
        ("up", pools.get("limit_up") or [],
         lambda i: (i["lbc"], i["first_seal"], i["last_seal"], i["seal_fund"], i["blown_times"],
                    i.get("stat") or "")),
        ("blown", pools.get("blown") or [],
         lambda i: (0, i["first_seal"], None, None, i["blown_times"], "")),
        ("down", pools.get("limit_down") or [],
         lambda i: (i["consecutive_down"], None, i["last_seal"], i["seal_fund"],
                    i.get("open_times") or 0, "")),
    )
    written = 0
    for kind, pool, pick in specs:
        if not pool:
            continue
        rows = []
        for i in pool:
            lbc, fbt, lbt, fund, zbc, stat = pick(i)
            rows.append((date, kind, f"{_pfx(i['code'])}{i['code']}", i["name"], i["price"],
                         i["change_percent"], lbc, fbt, lbt, fund, zbc, i["amount"],
                         i["turnover"], i["sector"], stat))
        db.execute("DELETE FROM limit_pool WHERE trade_date=? AND kind=?", (date, kind))
        db.executemany(
            "INSERT OR REPLACE INTO limit_pool(trade_date,kind,symbol,name,price,change_percent,"
            "lbc,fbt,lbt,fund,zb_count,amount,turnover,sector,stat) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            rows)
        written += len(rows)
    return written


def backfill_limit_pools(want_days: int = 6, before: str | None = None,
                         only_missing: bool = True) -> list[dict]:
    """补历史涨停/炸板/跌停三池。昨日晋级要对比前一交易日，梯队页至少要两天的池子才有意义。
    交易日历用 amount_baseline（每天收盘存全市场成交额，天然是交易日序列）。
    only_missing=True 时跳过已有 up 行的日期（补完 up 不会回头补炸板/跌停）。"""
    if only_missing:
        have = {r["trade_date"] for r in db.query(
            "SELECT DISTINCT trade_date FROM limit_pool WHERE kind='up'")}
    else:
        have = set()
    need = max(want_days - len(have), 0)
    sql = "SELECT trade_date FROM amount_baseline WHERE trade_date<? " \
          "ORDER BY trade_date DESC LIMIT ?"
    params = [before or latest_daily()["trade_date"], need]
    if have:
        sql = sql.replace("ORDER BY", f"AND trade_date NOT IN ({','.join('?' * len(have))}) ORDER BY")
        params = params[:1] + list(have) + params[1:]
    out = []
    for d in [r["trade_date"] for r in db.query(sql, tuple(params))]:
        pools = registry.limit_pools(d)
        n = _store_limit_pool(d, pools)
        out.append({"date": d, "stored": n, "counts": pools["counts"], "errors": list(pools["errors"])})
    return out


def _pfx(code: str) -> str:
    return "sh" if code.startswith(("5", "6", "9")) else ("bj" if code.startswith(("4", "8")) else "sz")


def _sample_kline_stats(sample: list[dict]) -> dict:
    """抽样若干只，统计站上 MA5/MA20/MA60 的比例与 60 日新高/新低"""
    above = {5: 0, 20: 0, 60: 0}
    total = high = low = 0
    for s in sample:
        try:
            bars = registry.kline_daily(s["symbol"], 70)
        except ProviderError:
            break
        if len(bars) < 21:
            continue
        closes = [b["close"] for b in bars]
        last = closes[-1]
        for n in (5, 20, 60):
            if len(closes) >= n and last > sum(closes[-n:]) / n:
                above[n] += 1
        total += 1
        window = bars[-60:] if len(bars) >= 60 else bars
        if last >= max(b["high"] for b in window[:-1]):
            high += 1
        if last <= min(b["low"] for b in window[:-1]):
            low += 1
        time.sleep(0.02)
    if not total:
        return {"ma5": None, "ma20": None, "ma60": None, "new_high": None,
                "new_low": None, "total": 0}
    return {"ma5": round(above[5] / total, 4), "ma20": round(above[20] / total, 4),
            "ma60": round(above[60] / total, 4), "new_high": high, "new_low": low,
            "total": total}


def live_index_avg() -> float | None:
    try:
        rows = registry.index_quotes()
    except ProviderError:
        return None
    if not rows:
        return None
    w = {"sh000001": 0.4, "sz399001": 0.25, "sz399006": 0.2, "sh000688": 0.1, "bj899050": 0.05}
    return sum(r["change_percent"] * w.get(r["symbol"], 0.1) for r in rows)


# ---------------------------------------------------------------- 情绪六维
DIM_META = [
    ("trend", "趋势强度", 0.20, "三大指数加权涨跌幅，-3%~+3% 线性映射"),
    ("breadth", "涨跌广度", 0.25, "上涨家数占比，50% 对应 50 分"),
    ("activity", "成交活跃", 0.15, "两市成交额环比上一交易日，±50% 对应 0/100 分（需要至少 2 个交易日的快照）"),
    ("seal", "封板率", 0.15, "涨停 /(涨停+炸板)"),
    ("ma", "均线分布", 0.15, "抽样成交额前列个股站上 MA20 的比例"),
    ("hl", "新高新低", 0.10, "抽样个股 60 日新高占新高+新低之比"),
]


def _clamp(v: float) -> float:
    return round(max(0.0, min(100.0, v)), 1)


def compute_dims(*, index_change: float | None, up: int | None, down: int | None,
                 amount_vs_prev: float | None, limit_up: int | None, blown: int | None,
                 ma20_above_ratio: float | None, new_high: int | None,
                 new_low: int | None) -> dict:
    d: dict[str, Any] = {}
    d["trend"] = _clamp(50 + (index_change or 0) * 50 / 3) if index_change is not None else None
    if up is not None and down is not None and (up + down) > 0:
        d["breadth"] = _clamp(50 + (up / (up + down) - 0.5) * 400)
    else:
        d["breadth"] = None
    d["activity"] = _clamp(50 + (amount_vs_prev or 0)) if amount_vs_prev is not None else None
    if limit_up is not None and (limit_up + (blown or 0)) > 0:
        d["seal"] = _clamp(limit_up / (limit_up + (blown or 0)) * 100)
    else:
        d["seal"] = None
    d["ma"] = _clamp(ma20_above_ratio * 100) if ma20_above_ratio is not None else None
    if new_high is not None and new_low is not None and (new_high + new_low) > 0:
        d["hl"] = _clamp(new_high / (new_high + new_low) * 100)
    elif new_high is not None:
        d["hl"] = _clamp(50 + new_high)
    else:
        d["hl"] = None
    for key, label, weight, how in DIM_META:
        d[f"{key}Label"], d[f"{key}Weight"], d[f"{key}How"] = label, weight, how
    return d


def composite_score(dims: dict) -> float | None:
    total_w = acc = 0.0
    for key, _label, weight, _how in DIM_META:
        v = dims.get(key)
        if isinstance(v, (int, float)):
            acc += v * weight
            total_w += weight
    return round(acc / total_w, 1) if total_w else None


# ---------------------------------------------------------------- 对外视图
def latest_daily() -> dict | None:
    row = db.query_one("SELECT * FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    if not row:
        return None
    import json
    dims = json.loads(row["dims"] or "{}")
    return {**dict(row), "dims": dims}


def breadth_from_live() -> dict:
    """无收盘快照时，用实时指数 + 涨停池给出可得部分"""
    counts = {}
    try:
        date = registry.trade_date_hint()
        counts = registry.limit_pools(date)["counts"]
    except Exception:  # noqa: BLE001
        pass
    return {"limit_up": counts.get("limit_up"), "limit_down": counts.get("limit_down"),
            "blown": counts.get("blown")}


BOARD_LABELS = {"sh_main": "沪主板", "sz_main": "深主板", "chinext": "创业板",
                "star": "科创板", "bse": "北交所"}


def board_of(symbol: str) -> str:
    code = symbol[2:] if symbol[:2] in ("sh", "sz", "bj") else symbol
    if symbol.startswith("bj") or code.startswith(("43", "83", "87", "92")):
        return "bse"
    if code.startswith("68"):
        return "star"
    if code.startswith("30"):
        return "chinext"
    return "sh_main" if symbol.startswith("sh") else "sz_main"


def _pool_rows(date: str, kind: str) -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT symbol,name,price,change_percent,lbc,fbt,lbt,fund,zb_count,amount,turnover,sector,stat "
        "FROM limit_pool WHERE trade_date=? AND kind=? ORDER BY lbc DESC, fund DESC", (date, kind))]


def _limit_price(prev_close: float | None, rate: float | None) -> float | None:
    return round(prev_close * (1 + (rate or 0.1)) + 1e-9, 2) if prev_close else None


def ladder(date: str, *, board: str = "", keyword: str = "", full: bool = False) -> dict:
    """涨停梯队：连板分层 + 三池 + 昨日连板今日晋级。full=True 时补齐一字板/标签/炸板跌停池，
    仪表盘只用分层，个股页和梯队页要全量。"""
    rows = _pool_rows(date, "up")
    snap: dict[str, dict] = {}
    tags: dict[str, list[str]] = {}
    if full and rows:
        snap = {r["symbol"]: dict(r) for r in db.query(
            "SELECT symbol,open,high,low,prev_close,turnover_ratio,is_st,limit_rate "
            "FROM snapshot_stocks WHERE trade_date=?", (date,))}
        symbols = [r["symbol"] for r in rows]
        ph = ",".join("?" * len(symbols))
        for r in db.query(f"SELECT symbol,kind,board_name FROM stock_board WHERE symbol IN ({ph})",
                          tuple(symbols)):
            tags.setdefault(r["symbol"], []).append(f"{r['kind']}:{r['board_name']}")

    def keep(r: dict) -> bool:
        if board and board_of(r["symbol"]) != board:
            return False
        if keyword:
            kw = keyword.strip().lower()
            if kw and kw not in r["name"].lower() and kw not in r["symbol"].lower():
                return False
        return True

    picked = [r for r in rows if keep(r)]

    def decorate(r: dict) -> dict:
        s = snap.get(r["symbol"]) or {}
        lp = _limit_price(s.get("prev_close"), s.get("limit_rate"))
        out = {**r, "board": board_of(r["symbol"]), "boardLabel": BOARD_LABELS[board_of(r["symbol"])],
               "limitPrice": lp, "isSt": bool(s.get("is_st")),
               "oneWord": bool(lp and s.get("open") and s["open"] >= lp - 0.005),
               "reseal": (r.get("zb_count") or 0) > 0,
               "tags": [t.split(":", 1)[1] for t in tags.get(r["symbol"], [])][:6]}
        return out

    tiers_map: dict[int, list] = {}
    for r in picked:
        tiers_map.setdefault(int(r["lbc"] or 1), []).append(r)
    ordered = sorted(tiers_map, reverse=True)
    per_tier = None if full else 8
    out = {"trade_date": date, "max_lbc": ordered[0] if ordered else 0,
           "total": len(picked), "tiers": [], "first_board_count": len(tiers_map.get(1, []))}
    for level in ordered:
        items = sorted(tiers_map[level], key=lambda x: -(x["fund"] or 0))
        shown = [decorate(it) for it in items] if full else items
        out["tiers"].append({
            "level": level, "count": len(items),
            "sealFund": round(sum(it["fund"] or 0 for it in items) / 1e8, 2),
            "stocks": [{**it, "label": f"{level}板"}
                       for it in (shown if per_tier is None else shown[:per_tier])],
        })
    out["stats"] = _ladder_stats(date)
    if full:
        out["blown"] = [decorate(r) for r in _pool_rows(date, "blown") if keep(r)]
        out["down"] = [decorate(r) for r in _pool_rows(date, "down") if keep(r)]
        out["yesterday"] = _yesterday_ladder(date)
        out["boards"] = [{"key": k, "label": v,
                          "count": sum(1 for r in rows if board_of(r["symbol"]) == k)}
                         for k, v in BOARD_LABELS.items()]
    return out


def _ladder_stats(date: str) -> dict:
    d = db.query_one("SELECT limit_up,limit_down,blown,up,down,total,amount,score "
                     "FROM market_daily WHERE trade_date=?", (date,))
    d = dict(d) if d else {}
    counts = {r["kind"]: r["c"] for r in db.query(
        "SELECT kind,COUNT(*) c FROM limit_pool WHERE trade_date=? GROUP BY kind", (date,))}
    lu = d.get("limit_up") or counts.get("up") or 0
    lb = d.get("limit_down") or counts.get("down") or 0
    zb = d.get("blown") if d.get("blown") is not None else counts.get("blown")
    seal = round(lu / (lu + zb) * 100, 1) if zb is not None and (lu + zb) else None
    return {"limitUp": lu, "limitDown": lb, "blown": zb, "sealRate": seal,
            "poolRows": counts, "up": d.get("up"), "down": d.get("down"),
            "total": d.get("total"), "amount": d.get("amount"), "score": d.get("score"),
            "stored": bool(counts.get("up"))}


def _yesterday_ladder(date: str) -> dict:
    """昨日连板股今天的去向：晋级（连板数 +1）还是断板。
    首板→二板和二板以上→再上一档分开算，打板的人盯的是这两条晋级率。"""
    prev = db.query_one("SELECT MAX(trade_date) d FROM limit_pool WHERE trade_date<? AND kind='up'",
                        (date,))
    pdate = prev["d"] if prev and prev["d"] else None
    if not pdate:
        return {"date": None}
    today = {r["symbol"]: r for r in _pool_rows(date, "up")}
    rows = _pool_rows(pdate, "up")
    chg = {r["symbol"]: r["change_percent"] for r in db.query(
        "SELECT symbol,change_percent FROM snapshot_stocks WHERE trade_date=?", (date,))}
    promoted: list[dict] = []
    broken: list[dict] = []
    first_t = first_p = cont_t = cont_p = 0
    for r in rows:
        level = int(r["lbc"] or 1)
        cur = today.get(r["symbol"])
        ok = bool(cur) and int(cur["lbc"] or 1) > level
        item = {"symbol": r["symbol"], "name": r["name"], "lbc": level,
                "newLbc": int(cur["lbc"] or 1) if cur else 0,
                "todayChange": chg.get(r["symbol"]),
                "fund": (cur or {}).get("fund"), "sector": r.get("sector")}
        (promoted if ok else broken).append(item)
        if level == 1:
            first_t += 1
            first_p += 1 if ok else 0
        else:
            cont_t += 1
            cont_p += 1 if ok else 0
    promoted.sort(key=lambda x: -(x["fund"] or 0))
    broken.sort(key=lambda x: (x["todayChange"] if x["todayChange"] is not None else 0))
    rate = lambda a, b: round(a / b * 100, 1) if b else None  # noqa: E731
    return {"date": pdate, "total": len(rows), "promoted": len(promoted),
            "promotionRate": rate(len(promoted), len(rows)),
            "firstTotal": first_t, "firstPromoted": first_p, "firstRate": rate(first_p, first_t),
            "contTotal": cont_t, "contPromoted": cont_p, "contRate": rate(cont_p, cont_t),
            "promotedList": promoted[:30], "brokenList": broken[:30]}


def _ensure_board_members(kind: str, code: str, name: str) -> None:
    """板块成分：本地有就用，没有按热度源的代码抓一次存下来（行业 hangye_* 已就位，概念 gn_* 缺）"""
    have = db.query_one("SELECT COUNT(*) c FROM stock_board WHERE kind=? AND board_code=?",
                        (kind, code))
    if have and have["c"]:
        return
    try:
        rows = sina.board_stocks(code, num=120)
    except Exception:  # noqa: BLE001
        return
    members = [(r["symbol"], kind, code, name) for r in rows if r.get("symbol")]
    if members:
        db.executemany("INSERT OR IGNORE INTO stock_board(symbol,kind,board_code,board_name)"
                       " VALUES(?,?,?,?)", members)


def board_stock_counts(kind: str) -> dict[str, int]:
    """板块成分家数：热度源没给就退到本地板块成分表"""
    return {r["board_code"]: r["c"] for r in db.query(
        "SELECT board_code,COUNT(*) c FROM stock_board WHERE kind=? GROUP BY board_code", (kind,))}


def suspect_industry_boards() -> set[str]:
    """证监会行业下一只票只该属于一个行业，所以哪个行业的成分名单有 60% 以上和另一个行业重合，
    这份名单就是新浪 node 给错了（实测 hangye_ZC31「黑色金属冶炼」里全是造纸和乳制品股）。
    这类板块不显示本地领涨领跌，也不覆盖热度源的龙头。87 个板块两两求交集，几十毫秒，不缓存。"""
    mem: dict[str, set[str]] = {}
    names: dict[str, str] = {}
    for r in db.query("SELECT board_code,board_name,symbol FROM stock_board WHERE kind='industry'"):
        mem.setdefault(r["board_code"], set()).add(r["symbol"])
        names[r["board_code"]] = r["board_name"]
    codes = list(mem)
    bad: set[str] = set()
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            A, B = mem[a], mem[b]
            if not A or not B:
                continue
            if len(A & B) / min(len(A), len(B)) >= 0.6:
                bad.add(min((a, b), key=lambda c: len(mem[c])))
    if bad:
        print("[board] 行业成分名单不可用的板块 "
              f"{len(bad)} 个: " + ", ".join(names.get(c, c) for c in list(bad)[:6]))
    return bad


def board_movers(kind: str, boards: list[tuple[str, str]], date: str) -> dict[str, dict]:
    """板块内领涨/领跌 TOP5：成分表 ⋈ 当日快照，一次窗口查询搞定"""
    if not boards or not date:
        return {}
    codes = [c for c, _n in boards]
    for code, name in boards:
        _ensure_board_members(kind, code, name)
    marks = ",".join("?" * len(codes))
    out: dict[str, dict] = {c: {"up": [], "down": []} for c in codes}
    for direction, order in (("up", "DESC"), ("down", "ASC")):
        sql = (
            "SELECT board_code,name,change_percent,price,amount FROM ("
            " SELECT b.board_code,s.name,s.change_percent,s.price,s.amount,"
            f"        ROW_NUMBER() OVER (PARTITION BY b.board_code ORDER BY s.change_percent {order}) rn"
            "   FROM stock_board b JOIN snapshot_stocks s ON s.symbol=b.symbol"
            f"  WHERE b.kind=? AND s.trade_date=? AND b.board_code IN ({marks})) WHERE rn<=5"
            " ORDER BY board_code,change_percent " + order)
        for r in db.query(sql, (kind, date, *codes)):
            chg = r["change_percent"] or 0
            if direction == "down" and chg >= 0:
                continue  # 领跌只列真跌的，板块全红就别硬凑
            out[r["board_code"]][direction].append(
                {"name": r["name"], "changePercent": chg,
                 "price": r["price"], "amount": r["amount"]})
    return out


def board_heat(kind: str = "industry", limit: int = 10) -> dict:
    date = db.query_one("SELECT trade_date FROM board_daily WHERE kind=? "
                        "ORDER BY trade_date DESC LIMIT 1", (kind,))
    rows = []
    if date:
        rows = [dict(r) for r in db.query(
            "SELECT code,name,change_percent,stock_count,amount,leader_name,leader_change "
            "FROM board_daily WHERE kind=? AND trade_date=? ORDER BY change_percent DESC",
            (kind, date["trade_date"]))]
        counts = board_stock_counts(kind)
        # 板块成交额加权换手率：本地成分名单 ⋈ 当日快照算得，口径=板块成交额/板块流通市值。
        # 新浪资金流接口的 turnover 字段口径不明（股权激励给到 232），不用它
        local = {r["code"]: r for r in db.query(
            "SELECT b.board_code code, SUM(s.amount)/NULLIF(SUM(s.nmc_cap),0)*100 turnover,"
            "       SUM(s.amount)/1e8 amount_yi, COUNT(*) members "
            "FROM stock_board b JOIN snapshot_stocks s ON s.symbol=b.symbol "
            "WHERE b.kind=? AND s.trade_date=? GROUP BY b.board_code",
            (kind, date["trade_date"]))}
        for r in rows:
            r["stock_count"] = r.get("stock_count") or counts.get(r["code"])
            hit = local.get(r["code"])
            if hit:
                r["turnover_local"] = round(hit["turnover"], 2) if hit["turnover"] else None
                r["amount_local"] = round(hit["amount_yi"], 2) if hit["amount_yi"] else None
                r["members_local"] = hit["members"]
        hot = [(r["code"], r["name"]) for r in rows[:limit]]
        hot += [(r["code"], r["name"]) for r in sorted(
            rows, key=lambda x: x["change_percent"])[:limit]]
        movers = board_movers(kind, list(dict.fromkeys(hot)), date["trade_date"])
        bad = suspect_industry_boards() if kind == "industry" else set()
        for r in rows:
            mv = movers.get(r["code"]) or {"up": [], "down": []}
            if r["code"] in bad:
                mv = {"up": [], "down": []}
                r["movers_note"] = "新浪给这个行业的成分名单和另一个行业大面积重合，本地不采信"
            r["movers"] = mv
            # 源给的龙头股涨幅来自资金流接口，节假日会漂到上一交易日；本地算得出人就用本地的
            top = mv["up"][0] if mv["up"] else None
            if top and (top["name"] != r.get("leader_name")
                        or abs((top["changePercent"] or 0) - (r.get("leader_change") or 0)) > 0.05):
                r["leader_name_src"] = r.get("leader_name")
                r["leader_change_src"] = r.get("leader_change")
                r["leader_name"] = top["name"]
                r["leader_change"] = top["changePercent"]
                r["leader_local"] = True
    return {"kind": kind, "kindLabel": "概念热度" if kind == "concept" else "行业热度",
            "trade_date": date["trade_date"] if date else None,
            "top": rows[:limit], "bottom": sorted(rows, key=lambda x: x["change_percent"])[:limit],
            "count": len(rows),
            "upCount": sum(1 for r in rows if (r["change_percent"] or 0) > 0),
            "downCount": sum(1 for r in rows if (r["change_percent"] or 0) < 0)}


def board_members(kind: str, code: str, name: str = "", limit: int = 100) -> dict:
    """板块成分股列表：成分名单落库后与当日快照 join，按涨跌幅倒序"""
    date_row = db.query_one("SELECT trade_date FROM board_daily WHERE kind=? "
                            "ORDER BY trade_date DESC LIMIT 1", (kind,))
    date = date_row["trade_date"] if date_row else None
    meta = db.query_one("SELECT code,name,change_percent,stock_count,amount,leader_name,leader_change "
                        "FROM board_daily WHERE kind=? AND code=?", (kind, code))
    board_name = name or (meta["name"] if meta else code)
    _ensure_board_members(kind, code, board_name)
    rows = [dict(r) for r in db.query(
        "SELECT s.symbol,s.name,s.price,s.change_percent,s.amount,s.turnover_ratio,"
        "       s.pe,s.pb,s.mkt_cap,s.nmc_cap,s.is_st,s.ticktime "
        "FROM stock_board b JOIN snapshot_stocks s ON s.symbol=b.symbol "
        "WHERE b.kind=? AND b.board_code=? AND s.trade_date=? "
        "ORDER BY s.change_percent DESC LIMIT ?", (kind, code, date, limit))] if date else []
    source = "local"
    if not rows:
        # 名单没落库（板块太新/新浪热度接口没给），现抓一次
        try:
            rows = _normalize_spot(sina.board_stocks(code, num=limit))
            source = "sina"
        except ProviderError:
            rows = []
    out = []
    for r in rows:
        out.append({
            "symbol": r.get("symbol"), "name": r.get("name"),
            "price": r.get("price"), "changePercent": r.get("change_percent"),
            "amount": r.get("amount"), "turnoverRatio": r.get("turnover_ratio"),
            "pe": r.get("pe"), "pb": r.get("pb"),
            "mktCap": r.get("mkt_cap"), "nmcCap": r.get("nmc_cap"),
            "isSt": r.get("is_st"),
        })
    up = sum(1 for r in out if (r["changePercent"] or 0) > 0)
    down = sum(1 for r in out if (r["changePercent"] or 0) < 0)
    return {"kind": kind, "code": code, "name": board_name, "trade_date": date,
            "source": source, "board": dict(meta) if meta else None,
            "rows": out, "count": len(out), "upCount": up, "downCount": down,
            "avgChange": round(sum(r["changePercent"] or 0 for r in out) / len(out), 3) if out else None,
            "totalAmount": round(sum(r["amount"] or 0 for r in out) / 1e8, 2) if out else None,
            "limitUp": sum(1 for r in out if (r["changePercent"] or 0) >= 9.8)}


def breadth_buckets(date: str | None = None) -> dict:
    """11 档涨跌分布直方图（对齐原站：跌幅≥10 … 涨幅≥10，含平盘）"""
    if not date:
        d = db.query_one("SELECT trade_date FROM snapshot_stocks ORDER BY trade_date DESC LIMIT 1")
        date = d["trade_date"] if d else None
    if not date:
        return {"trade_date": None, "buckets": [], "total": 0}
    rows = db.query("SELECT change_percent FROM snapshot_stocks WHERE trade_date=?", (date,))
    edges = [(-100, -10, "跌停附近"), (-10, -7, "跌7-10"), (-7, -5, "跌5-7"), (-5, -3, "跌3-5"),
             (-3, -1, "跌1-3"), (-1, 0, "微跌"), (0, 0, "平盘"), (0, 1, "微涨"),
             (1, 3, "涨1-3"), (3, 5, "涨3-5"), (5, 7, "涨5-7"), (7, 10, "涨7-10"),
             (10, 100, "涨停附近")]
    counts = [0] * len(edges)
    for r in rows:
        v = r["change_percent"]
        if v is None:
            continue
        for i, (lo, hi, _l) in enumerate(edges):
            if lo == hi == 0:
                if -0.005 < v < 0.005:
                    counts[i] += 1
                    break
            elif lo == 0 and hi > 0:
                if 0.005 <= v < hi:
                    counts[i] += 1
                    break
            elif lo < 0 and hi == 0:
                if lo < v <= -0.005:
                    counts[i] += 1
                    break
            elif lo <= v < hi:
                counts[i] += 1
                break
    total = sum(counts)
    limit_up = db.query_one("SELECT COUNT(*) c FROM snapshot_stocks WHERE trade_date=? AND change_percent>=9.7",
                            (date,))["c"]
    limit_down = db.query_one("SELECT COUNT(*) c FROM snapshot_stocks WHERE trade_date=? AND change_percent<=-9.7",
                              (date,))["c"]
    return {"trade_date": date, "total": total, "limitUp": limit_up, "limitDown": limit_down,
            "buckets": [{"label": l, "lo": lo, "hi": hi, "count": counts[i],
                         "ratio": round(counts[i] / total * 100, 1) if total else 0}
                        for i, (lo, hi, l) in enumerate(edges)]}


def trend_strength(date: str | None = None) -> dict:
    """趋势强度：全市场站上 5/20/60 日线比例 + 新高新低（缓存已补齐时走全量，否则抽样）"""
    d = db.query_one("SELECT * FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    if not d:
        return {"available": False, "note": "还没有收盘快照"}
    d = dict(d)
    if not d.get("ma5_above_ratio") or not d.get("sample_total"):
        from . import kline as kline_svc
        full = kline_svc.trend_breadth(d["trade_date"])
        if full.get("total"):
            kline_svc.backfill_amount_baseline(d["trade_date"])
            avp = _amount_vs_prev(d["trade_date"])
            old_dims = json.loads(d.get("dims") or "{}")
            idx = (old_dims["trend"] - 50) * 3 / 50 if isinstance(old_dims.get("trend"), (int, float)) else None
            dims = compute_dims(index_change=idx, up=d.get("up"), down=d.get("down"),
                                amount_vs_prev=avp, limit_up=d.get("limit_up"),
                                blown=d.get("blown"), ma20_above_ratio=full["ma20"],
                                new_high=full["new_high"], new_low=full["new_low"])
            score = composite_score(dims)
            db.execute("UPDATE market_daily SET ma5_above_ratio=?,ma20_above_ratio=?,"
                       "ma60_above_ratio=?,new_high_count=?,new_low_count=?,sample_total=?,"
                       "amount_vs_prev=?,dims=?,score=? WHERE trade_date=?",
                       (full["ma5"], full["ma20"], full["ma60"], full["new_high"], full["new_low"],
                        full["total"], avp, json.dumps(dims, ensure_ascii=False), score,
                        d["trade_date"]))
            d.update({"ma5_above_ratio": full["ma5"], "ma20_above_ratio": full["ma20"],
                      "ma60_above_ratio": full["ma60"], "new_high_count": full["new_high"],
                      "new_low_count": full["new_low"], "sample_total": full["total"],
                      "amount_vs_prev": avp, "score": score})
    st = d.get("sample_total") or 0
    tot = d.get("total") or 0
    if st and tot and st / tot >= 0.8:
        note = f"站上均线比例基于本地日线缓存全量 {st} 只，60 日新高/新低同口径"
    else:
        note = f"均线/新高新低基于 {st} 只抽样标的估算"
    score = d.get("score") or 0
    return {"available": True, "trade_date": d["trade_date"],
            "ma5AboveRatio": d.get("ma5_above_ratio"), "ma20AboveRatio": d.get("ma20_above_ratio"),
            "ma60AboveRatio": d.get("ma60_above_ratio"),
            "newHigh": d.get("new_high_count"), "newLow": d.get("new_low_count"),
            "sampleTotal": d.get("sample_total"),
            "amountVsPrev": d.get("amount_vs_prev"),
            "score": score, "label": emotion_label(score)["label"],
            "meaning": emotion_label(score)["meaning"],
            "note": note}


def _amount_vs_prev(date: str) -> float | None:
    """成交额环比（%）：与上一个有基准的交易日比"""
    row = db.query_one("SELECT amount FROM amount_baseline WHERE trade_date<? "
                       "ORDER BY trade_date DESC LIMIT 1", (date,))
    cur = db.query_one("SELECT amount FROM amount_baseline WHERE trade_date=?", (date,))
    if not row or not cur or not row["amount"]:
        return None
    return round((cur["amount"] / row["amount"] - 1) * 100, 2)


def index_sparklines(symbols: list[str], points: int = 30) -> dict:
    """指数分时/日线小图：盘中有分时，收盘后回退到最近 N 根日线的收盘序列"""
    out: dict[str, dict] = {}
    for s in symbols:
        try:
            bars = sina.kline_daily(s, datalen=points)
            out[s] = {"kind": "daily",
                      "values": [round(float(b["close"]), 2) for b in bars],
                      "dates": [b["day"] for b in bars]}
        except Exception as exc:  # noqa: BLE001
            out[s] = {"kind": "none", "values": [], "error": f"{type(exc).__name__}"}
    return out


def global_snapshot() -> dict:
    out: dict[str, Any] = {"errors": {}}
    try:
        out["indexes"] = registry.global_quotes("index")
    except ProviderError as exc:
        out["errors"]["global_index"] = exc.message
    try:
        out["commodities"] = registry.commodity_quotes()
    except ProviderError as exc:
        out["errors"]["commodity"] = exc.message
    return out


def fund_flow_overview() -> dict:
    out: dict[str, Any] = {"errors": {}}
    try:
        out["stocks"] = registry.stock_fund_flow(num=20)
    except ProviderError as exc:
        out["errors"]["stock_fund_flow"] = exc.message
    for kind, fenlei in (("industry", 2), ("concept", 1)):
        try:
            out[f"boards_{kind}"] = registry.board_fund_flow(fenlei=fenlei, num=20)
        except ProviderError as exc:
            out["errors"][f"board_fund_flow_{kind}"] = exc.message
    return out


def rankings(num: int = 20) -> dict:
    specs = [("gainers", "changepercent", True), ("losers", "changepercent", False),
             ("amount", "amount", True), ("turnover", "turnoverratio", True)]
    out: dict[str, Any] = {"errors": {}}
    for key, sort, desc in specs:
        try:
            rows = sina.spot_ranking(sort, desc, num)
            out[key] = [{
                "symbol": r["symbol"], "code": r["code"], "name": r["name"],
                "price": float(r["trade"]), "change_percent": round(float(r["changepercent"]), 2),
                "amount": float(r["amount"]), "turnover_ratio": float(r["turnoverratio"]),
                "high": float(r["high"]), "low": float(r["low"]), "open": float(r["open"]),
                "prev_close": float(r["settlement"] or 0),
            } for r in rows]
        except ProviderError as exc:
            out[key] = []
            out["errors"][key] = exc.message
    return out


def snapshot_row(symbol: str) -> dict | None:
    date = db.query_one("SELECT trade_date FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    if not date:
        return None
    r = db.query_one("SELECT * FROM snapshot_stocks WHERE trade_date=? AND symbol=?",
                     (date["trade_date"], symbol))
    return dict(r) if r else None


def search_stocks(keyword: str, limit: int = 20) -> list[dict]:
    kw = (keyword or "").strip()
    if not kw:
        return []
    like = f"%{kw}%"
    rows = db.query(
        "SELECT symbol,name,price,change_percent,amount,turnover_ratio FROM snapshot_stocks "
        "WHERE name LIKE ? OR symbol LIKE ? "
        "ORDER BY amount DESC LIMIT ?", (like, like, limit))
    if rows:
        return [{**dict(r), "code": dict(r)["symbol"][2:]} for r in rows]
    # 快照还没建时用腾讯suggest兜底
    try:
        from ..providers.base import fetch
        raw = fetch("https://suggest3.sinajs.cn/suggest/type=11,15,20,34&key=" + kw,
                    provider="sina", capability="search", referer=sina.REFERER,
                    encoding="gbk", expect_json=False, retries=1)
        out = []
        for line in raw.strip().splitlines():
            f = line.split(",")
            if len(f) >= 5:
                out.append({"symbol": f[4] if f[4].startswith(("sh", "sz", "bj")) else f[2],
                            "name": f[4], "code": f[2][-6:], "price": None, "change_percent": None})
        return out[:limit]
    except Exception:  # noqa: BLE001
        return []
