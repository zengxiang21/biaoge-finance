"""全球指数 / 原油黄金 / 指数概览 / 指数成分（拆解文档 3.8 / 3.9 / 路由 43、44）"""
from __future__ import annotations

import threading
import time
from typing import Any

from .. import db
from ..permissions import EMOTION_BANDS, emotion_label
from ..providers import registry, sina
from ..providers.base import ProviderError
from . import market

_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()
TTL = 60.0


def _cached(key: str, fn, ttl: float = TTL):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def _force(*keys: str) -> None:
    """手点「刷新」时跳过缓存，自动轮询不用（VIX 历史 CSV 有 470KB）"""
    with _lock:
        for k in keys:
            _cache.pop(k, None)


# 指数成分：TYPE 是东财报表里的指数编号，条数与成分实测对上才写死
INDEX_BOARDS = [
    {"key": "hs300", "type": "1", "label": "沪深300", "code": "000300", "expected": 300},
    {"key": "sz50", "type": "2", "label": "上证50", "code": "000016", "expected": 50},
    {"key": "zz500", "type": "3", "label": "中证500", "code": "000905", "expected": 500},
    {"key": "kc50", "type": "4", "label": "科创50", "code": "000688", "expected": 50},
    {"key": "bse50", "type": "10", "label": "北证50", "code": "899050", "expected": 50},
    {"key": "sse180", "type": "11", "label": "上证180", "code": "000010", "expected": 180},
]
INDEX_BY_KEY = {i["key"]: i for i in INDEX_BOARDS}

GLOBAL_GROUP_ORDER = ["美股", "港股", "亚太", "欧洲", "汇率", "中国"]

# VIX 分档：CBOE 官方口径没有统一说法，这里按历史分布的常用刻度切，
# 每档给白话含义，界面只按现价落一档
FEAR_BANDS = [
    {"lo": 0, "hi": 12, "label": "极度平静", "meaning": "保险便宜到历史低位，通常是慢牛或自满阶段"},
    {"lo": 12, "hi": 18, "label": "平静", "meaning": "正常偏乐观，市场对后市的顾虑不大"},
    {"lo": 18, "hi": 25, "label": "略有戒心", "meaning": "开始有人买保护，常伴随高位放量或事件担忧"},
    {"lo": 25, "hi": 32, "label": "紧张", "meaning": "进入风险区，美股单日振幅经常放大到 2% 以上"},
    {"lo": 32, "hi": 45, "label": "恐慌", "meaning": "系统性抛售特征，历史上多对应急跌段"},
    {"lo": 45, "hi": 999, "label": "极端恐慌", "meaning": "2008/2020 级别，历史上也常是阶段性底部区域"},
]
FEAR_REF_LINES = [{"value": 15, "label": "平静"}, {"value": 20, "label": "警戒"}, {"value": 30, "label": "恐慌"}]


def _fear_band(price: float | None) -> dict | None:
    if price is None:
        return None
    for b in FEAR_BANDS:
        if b["lo"] <= price < b["hi"]:
            return dict(b)
    return dict(FEAR_BANDS[-1])


def fear_panel(days: int = 90) -> dict:
    """恐慌指数 VIX：现价（CBOE 延时，盘中实时）+ 最近 days 个交易日收盘序列"""
    def load_quote():
        try:
            return {"quote": registry.fear_index(), "error": None}
        except ProviderError as exc:
            return {"quote": None, "error": exc.message}

    def load_hist():
        try:
            return {"rows": registry.fear_index_history(days), "error": None}
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}

    q = _cached("global:fear:quote", load_quote, 120)
    h = _cached("global:fear:hist", load_hist, 6 * 3600)
    quote, error = q["quote"], q["error"] or h["error"]
    series = list(h["rows"])
    # 当天的收盘价要等美股收盘才进 CSV，用实时价把最后一根补上，折线才不会缺今天
    if quote and quote.get("price") and quote.get("date"):
        if not series or series[-1]["date"] < quote["date"]:
            series.append({"date": quote["date"], "close": quote["price"],
                           "high": quote.get("high"), "low": quote.get("low")})
    closes = [r["close"] for r in series if isinstance(r.get("close"), (int, float))]
    price = (quote or {}).get("price")
    window = {"high": max(closes) if closes else None, "low": min(closes) if closes else None,
              "avg": round(sum(closes) / len(closes), 2) if closes else None}
    below = len([c for c in closes if price is not None and c <= price])
    change_5 = (round(price - closes[-6], 2) if (price is not None and len(closes) >= 6) else None)
    return {"quote": quote, "error": error, "series": series, "bands": FEAR_BANDS,
            "refLines": FEAR_REF_LINES, "band": _fear_band(price), "window": window,
            "percentile": round(below / len(closes) * 100, 1) if (closes and price is not None) else None,
            "change5": change_5, "days": len(series),
            "note": "VIX 衡量的是标普500 未来 30 天预期波动，越高说明海外越怕跌；"
                    "A 股自己的恐慌看下面的大盘情绪分"}


def emotion_panel(days: int = 60) -> dict:
    """大盘情绪折线：直接读 market_env_history（收盘快照与补跑任务会同步这张表）"""
    limit = max(2, min(days, 500))
    rows = [dict(r) for r in db.query(
        "SELECT trade_date,score,label FROM market_env_history ORDER BY trade_date DESC LIMIT ?",
        (limit,))]
    rows.reverse()
    out = [{"date": f"{str(r['trade_date'])[:4]}-{str(r['trade_date'])[4:6]}-{str(r['trade_date'])[6:8]}",
            "score": r.get("score"), "label": r.get("label")} for r in rows]
    scores = [r["score"] for r in out if isinstance(r.get("score"), (int, float))]
    latest = out[-1] if out else None
    change5 = (round(latest["score"] - scores[-6], 1)
               if latest and latest.get("score") is not None and len(scores) >= 6 else None)
    return {"rows": out,
            "bands": [{"lo": lo, "hi": hi, "label": label, "meaning": meaning}
                      for lo, hi, label, meaning in EMOTION_BANDS],
            "refLines": [{"value": lo, "label": label}
                         for lo, _hi, label, _m in EMOTION_BANDS if lo > 0],
            "latest": latest, "avg": round(sum(scores) / len(scores), 1) if scores else None,
            "high": max(scores) if scores else None, "low": min(scores) if scores else None,
            "change5": change5,
            "error": None if out else "市场环境历史是空的，先去「市场环境历史」页回算或等收盘快照落库"}


def _group_rows(rows: list[dict], spec: list[tuple[str, str, str]], order: list[str]) -> list[dict]:
    """按源表的分组字段聚成 [{key,label,rows,avgChange}]，源没给的组不硬造"""
    meta = {code: (name, grp) for code, name, grp in spec}
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        grp = meta.get(r.get("code"), (None, "其他"))[1] or "其他"
        buckets.setdefault(grp, []).append(r)
    keys = [g for g in order if g in buckets] + [g for g in buckets if g not in order]
    out = []
    for g in keys:
        items = sorted(buckets[g], key=lambda x: (x.get("change_percent") is None,
                                                  -(x.get("change_percent") or 0)))
        vals = [x["change_percent"] for x in items if isinstance(x.get("change_percent"), (int, float))]
        out.append({"key": g, "label": g, "rows": items,
                    "avgChange": round(sum(vals) / len(vals), 2) if vals else None})
    return out


def global_index(refresh: bool = False) -> dict:
    if refresh:
        _force("global:index", "global:fear:quote")

    def load():
        errors: dict[str, str] = {}
        rows: list[dict] = []
        try:
            rows = registry.global_quotes("index")
        except ProviderError as exc:
            errors["global_index"] = exc.message
        return {"rows": rows, "errors": errors}

    data = _cached("global:index", load)
    errors = dict(data["errors"])
    fear = fear_panel()
    if fear.get("error"):
        errors["fear_index"] = fear["error"]
    sina_rows = data["rows"]
    quote = fear.get("quote")
    # VIX 是波动率不是方向性指数：进明细表，但不进分组卡片，也不参与「全球均值」
    rows = ([*sina_rows, {**quote, "amount": None}] if quote else list(sina_rows))
    # A股自家指数放最前面做对照，全球涨跌一目了然
    try:
        a_share = [{**q, "name": q.get("label") or q["name"]} for q in registry.index_quotes()]
    except ProviderError as exc:
        a_share = []
        errors["cn_index"] = exc.message
    vals = [r["change_percent"] for r in sina_rows if isinstance(r.get("change_percent"), (int, float))]
    return {"groups": _group_rows(sina_rows, sina.GLOBAL_INDEXES, GLOBAL_GROUP_ORDER),
            "rows": rows, "errors": errors, "aShare": a_share, "fear": fear,
            "emotion": emotion_panel(),
            "riskOn": (round(sum(vals) / len(vals), 2) if vals else None),
            "note": "行情来自新浪外围接口，休市的海外市场显示最后收盘价与最近交易日；恐慌指数取自 CBOE 官方",
            "generatedAt": db.now()}


def oil_gold() -> dict:
    def load():
        errors: dict[str, str] = {}
        rows: list[dict] = []
        try:
            rows = registry.commodity_quotes()
        except ProviderError as exc:
            errors["commodity"] = exc.message
        fx: list[dict] = []
        try:
            fx = [r for r in registry.global_quotes("index")
                  if r.get("code") in ("DINIW", "fx_susdcnh", "hf_CHA50CFD")]
        except ProviderError as exc:
            errors["fx"] = exc.message
        return {"groups": _group_rows(rows, sina.COMMODITIES, ["能源", "贵金属", "有色"]),
                "rows": rows, "fx": fx, "errors": errors}

    data = _cached("global:commodity", load)
    by = {r["code"]: r for r in data["rows"]}
    gold, oil = by.get("hf_GC"), by.get("hf_CL")
    ratio = round(gold["price"] / oil["price"], 2) if gold and oil and oil.get("price") else None
    cn = []
    try:
        cn = registry.index_quotes()
    except ProviderError:
        cn = []
    return {**data, "goldOilRatio": ratio, "aShare": cn,
            "note": "油价/金价以纽约期货为口径，伦敦金现货单独列出；富时A50 与离岸人民币用来对照外围对 A 股的传导",
            "generatedAt": db.now()}


def index_overview() -> dict:
    """指数概览：五大核心指数 + 分时 + 日线走势 + 市场宽度"""
    def load():
        errors: dict[str, str] = {}
        try:
            quotes = registry.index_quotes()
        except ProviderError as exc:
            quotes = []
            errors["index"] = exc.message
        trend = {}
        for q in quotes[:1]:
            try:
                trend[q["symbol"]] = registry.minute_trend(q["symbol"])
            except ProviderError as exc:
                errors["minute"] = exc.message
        spark = market.index_sparklines([q["symbol"] for q in quotes], 30)
        return {"quotes": quotes, "minute": trend, "spark": spark, "errors": errors}

    data = _cached("index:overview", load)
    daily = market.latest_daily() or {}
    boards = {}
    for kind in ("industry", "concept"):
        try:
            boards[kind] = registry.boards(kind)[:10]
        except ProviderError as exc:
            boards[kind] = []
            boards[f"{kind}Error"] = exc.message
    return {**data,
            "daily": {k: daily.get(k) for k in ("trade_date", "total", "up", "down", "flat",
                                                "limit_up", "limit_down", "blown", "amount", "score")},
            "emotion": emotion_label(daily.get("score")),
            "boards": boards,
            "indexes": [{**i, "count": i["expected"]} for i in INDEX_BOARDS],
            "generatedAt": db.now()}


def index_component(key: str) -> dict:
    meta = INDEX_BY_KEY.get(key)
    if not meta:
        return {"ok": False, "message": f"没有这个指数：{key}",
                "indexes": INDEX_BOARDS}

    def load():
        try:
            rows = registry.index_components(meta["type"])
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}
        date = rows[0]["date"] if rows else registry.trade_date_hint()
        db.executemany(
            "INSERT OR REPLACE INTO index_constituent(index_code,trade_date,symbol,name,weight,"
            "price,change_percent,amount) VALUES(?,?,?,?,?,?,?,NULL)",
            [(meta["code"], date, r["symbol"], r["name"], r["weight"], r["price"],
              r["changePercent"]) for r in rows])
        return {"rows": rows, "error": None, "date": date}

    data = _cached(f"index:comp:{key}", load, 300)
    rows = data["rows"]
    ups = [r for r in rows if (r.get("changePercent") or 0) > 0]
    downs = [r for r in rows if (r.get("changePercent") or 0) < 0]
    wsum = sum(r["weight"] or 0 for r in rows)
    weighted = (round(sum((r["changePercent"] or 0) * (r["weight"] or 0) for r in rows) / wsum, 3)
                if wsum else None)
    industries: dict[str, dict] = {}
    for r in rows:
        name = r.get("industry") or "未分类"
        it = industries.setdefault(name, {"industry": name, "count": 0, "weight": 0.0,
                                          "sumChange": 0.0, "n": 0})
        it["count"] += 1
        it["weight"] += r.get("weight") or 0
        if isinstance(r.get("changePercent"), (int, float)):
            it["sumChange"] += r["changePercent"]
            it["n"] += 1
    dist = []
    for it in industries.values():
        dist.append({"industry": it["industry"], "count": it["count"],
                     "weight": round(it["weight"], 2),
                     "avgChange": round(it["sumChange"] / it["n"], 2) if it["n"] else None})
    dist.sort(key=lambda x: -x["count"])
    priced = [r for r in rows if isinstance(r.get("changePercent"), (int, float))]
    return {
        "ok": True, "index": meta, "date": data.get("date"), "error": data["error"],
        "rows": rows,
        "stats": {
            "count": len(rows), "expected": meta["expected"],
            "up": len(ups), "down": len(downs), "flat": len(rows) - len(ups) - len(downs),
            "avgChange": round(sum(r["changePercent"] or 0 for r in priced) / len(priced), 2) if priced else None,
            "weightedChange": weighted,
            "hasWeight": bool(wsum),
            "topWeight": sorted(rows, key=lambda x: -(x.get("weight") or 0))[:10],
            "gainers": sorted(priced, key=lambda x: -(x["changePercent"] or 0))[:10],
            "losers": sorted(priced, key=lambda x: (x["changePercent"] or 0))[:10],
            "industryDist": dist[:15],
            "covered": round(wsum, 2) if wsum else None,
        },
        "indexes": INDEX_BOARDS,
        "generatedAt": db.now(),
    }
