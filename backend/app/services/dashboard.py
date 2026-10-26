"""仪表盘聚合：大盘全景（对应拆解文档 3.2）"""
from __future__ import annotations

import threading
import time
from datetime import datetime

from .. import db
from ..permissions import emotion_label
from ..providers import registry
from ..providers.base import ProviderError
from . import market

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
TTL = 30.0


def _cached(key: str, fn, ttl: float = TTL) -> dict:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def _safe(fn, default):
    try:
        return fn()
    except ProviderError as exc:
        return {**(default if isinstance(default, dict) else {}), "_error": exc.message} \
            if isinstance(default, dict) else default
    except Exception as exc:  # noqa: BLE001
        return {**(default if isinstance(default, dict) else {}), "_error": f"{type(exc).__name__}: {exc}"} \
            if isinstance(default, dict) else default


def overview(refresh: bool = False) -> dict:
    if refresh:
        with _cache_lock:
            _cache.clear()
    daily = market.latest_daily()
    date = (daily or {}).get("trade_date") or registry.trade_date_hint()

    indexes = _cached("indexes", lambda: registry.index_quotes(), 20)
    total_amount = round(sum(r["amount"] for r in indexes if isinstance(r.get("amount"), (int, float))) / 1e8, 2) \
        if isinstance(indexes, list) else None

    phase = market.market_phase()
    dims = (daily or {}).get("dims") or market.compute_dims(
        index_change=market.live_index_avg(), up=None, down=None, amount_vs_prev=None,
        limit_up=None, blown=None, ma20_above_ratio=None, new_high=None, new_low=None)
    score = (daily or {}).get("score")
    if score is None:
        score = market.composite_score(dims)

    breadth = None
    if daily:
        up, down = daily["up"], daily["down"]
        breadth = {
            "total": daily["total"], "up": up, "down": down, "flat": daily["flat"],
            "limitUp": daily["limit_up"], "limitDown": daily["limit_down"],
            "blown": daily["blown"],
            "upRatio": round(up / daily["total"] * 100, 1) if daily["total"] else None,
            "advanceDeclineRatio": round(up / down, 2) if down else None,
            "sealRate": round(daily["limit_up"] / (daily["limit_up"] + daily["blown"]) * 100, 1)
                if daily["limit_up"] and daily["blown"] is not None and (daily["limit_up"] + daily["blown"]) else None,
            "amount": daily["amount"], "amountVsPrev": daily["amount_vs_prev"],
            "tradeDate": daily["trade_date"], "builtAt": daily["built_at"],
        }
    else:
        breadth = {**market.breadth_from_live(), "total": None, "up": None, "down": None,
                   "flat": None, "tradeDate": date, "builtAt": None}

    emotion_rows = []
    for key, label, weight, how in market.DIM_META:
        v = dims.get(key)
        emotion_rows.append({"key": key, "label": label, "weight": weight, "score": v,
                             "how": how, "state": "ok" if v is not None else "pending"})

    dim_view = {k: dims.get(k) for k, _l, _w, _h in market.DIM_META}

    ladder = market.ladder(date)
    boards_ind = market.board_heat("industry", 10)
    boards_con = market.board_heat("concept", 10)
    buckets = _cached("buckets", lambda: market.breadth_buckets(date), 60)
    trend = _cached("trend", lambda: market.trend_strength(), 120)
    global_row = _cached("global", lambda: market.global_snapshot(), 120)
    spark_syms = [i["symbol"] for i in indexes if isinstance(i, dict)][:6] if isinstance(indexes, list) else []
    sparks = _cached("sparks:" + ",".join(spark_syms),
                     lambda: market.index_sparklines(spark_syms), 300 if not phase["trading"] else 120)
    rankings = _cached("rankings", lambda: market.rankings(15),
                       30 if phase["trading"] else 300)
    intraday = _cached("intraday", lambda: _intraday(), 120)

    return {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "tradeDate": date,
        "phase": phase,
        "indexes": [{**i, "spark": (sparks.get(i["symbol"]) or {}).get("values") or []}
                    for i in indexes] if isinstance(indexes, list) else [],
        "indexAmountTotal": total_amount,
        "breadth": {**(breadth or {}), "buckets": buckets.get("buckets") or [],
                    "bucketTotal": buckets.get("total"),
                    "limitUpFromBuckets": buckets.get("limitUp"),
                    "limitDownFromBuckets": buckets.get("limitDown")},
        "emotion": {
            "score": score, "label": emotion_label(score)["label"],
            "meaning": emotion_label(score)["meaning"], "band": emotion_label(score)["key"],
            "dims": dim_view, "dimList": emotion_rows,
            "source": "market_daily" if daily else "live_partial",
        },
        "ladder": {"maxLbc": ladder["max_lbc"], "total": ladder["total"],
                   "firstBoardCount": ladder["first_board_count"],
                   "tiers": [{"level": t["level"], "count": t["count"],
                              "stocks": [{"symbol": s["symbol"], "name": s["name"],
                                          "price": s["price"], "changePercent": s["change_percent"],
                                          "sealFund": s["fund"], "firstSeal": s["fbt"],
                                          "sector": s["sector"]} for s in t["stocks"][:6]]}
                             for t in ladder["tiers"][:6]]},
        "boards": {"industry": _board_view(boards_ind), "concept": _board_view(boards_con)},
        "trend": trend,
        "global": global_row,
        "rankings": rankings,
        "intraday": intraday,
        "schedule": db.get_setting("global_schedule", {}),
        "dataSources": registry.summary(),
        "snapshotProgress": market.progress(),
        "dailyRaw": {"sourceNote": (daily or {}).get("source_note"),
                    "ma20AboveRatio": (daily or {}).get("ma20_above_ratio"),
                    "newHigh": (daily or {}).get("new_high_count"),
                    "newLow": (daily or {}).get("new_low_count"),
                    "sampleSize": config_sample_size()},
        "degraded": not bool(daily),
        "degradedReason": None if daily else "还没有收盘快照，六维情绪只用到实时可得的部分；点右上角「重建快照」补齐",
    }


def config_sample_size() -> int | None:
    from .. import config
    return config.SNAPSHOT_SAMPLE_K_LINES


def _board_view(b: dict) -> dict:
    def row(x):
        return {"code": x["code"], "name": x["name"], "changePercent": x["change_percent"],
                "stockCount": x["stock_count"], "amount": x.get("amount"),
                "leaderName": x.get("leader_name"), "leaderChange": x.get("leader_change"),
                "leaderLocal": bool(x.get("leader_local")),
                "moversNote": x.get("movers_note"),
                "movers": x.get("movers") or {"up": [], "down": []}}
    return {"kind": b["kind"], "kindLabel": b["kindLabel"], "tradeDate": b["trade_date"],
            "count": b["count"], "upCount": b["upCount"], "downCount": b["downCount"],
            "top": [row(x) for x in b["top"][:5]],
            "bottom": [row(x) for x in b["bottom"][:5]]}


def _intraday() -> dict:
    try:
        points = registry.minute_trend("sh000001")
    except ProviderError as exc:
        return {"symbol": "sh000001", "points": [], "error": exc.message}
    prev = None
    try:
        prev = next((i["prev_close"] for i in registry.index_quotes()
                     if i["symbol"] == "sh000001"), None)
    except ProviderError:
        pass
    # 腾讯分时的 volume/amount 是累计值，先差分回单分钟量，再用「价×量」加权算均价线
    prev_vol = cum_vol = cum_wv = 0.0
    enriched: list[dict] = []
    for p in points:
        v = p.get("volume") or 0.0
        dv = max(0.0, v - prev_vol if v >= prev_vol else v)
        prev_vol = max(prev_vol, v)
        cum_vol += dv
        cum_wv += dv * p["price"]
        avg = p.get("avg_price")
        if avg is None:
            avg = round(cum_wv / cum_vol, 2) if cum_vol else None
        enriched.append({"t": (p["time"][-5:] if len(p["time"]) > 5 else p["time"]),
                         "price": p["price"], "avg": avg, "volume": dv})
    step = max(1, len(enriched) // 90)
    sampled = []
    for i in range(0, len(enriched), step):
        grp = enriched[i:i + step]
        point = dict(grp[-1])
        point["t"] = grp[0]["t"]
        point["volume"] = round(sum(g["volume"] for g in grp), 2)
        sampled.append(point)
    return {"symbol": "sh000001", "name": "上证指数", "prevClose": prev,
            "points": sampled}
