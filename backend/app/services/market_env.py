"""市场环境（六维情绪 + 历史归档，拆解文档 2.1 路由 41、42 / 附录 B 情绪评分）"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from .. import db
from ..permissions import EMOTION_BANDS, emotion_label
from ..providers import registry
from ..providers.base import ProviderError
from . import market

INDEX_WEIGHTS = {"sh000001": 0.40, "sz399001": 0.25, "sz399006": 0.20, "sh000688": 0.10}
# 历史回填只用本地日线缓存，不再打外部接口：kline_cache 有全市场约 120 个交易日的数据
BACKFILL_MIN_ROWS = 15


def sync_history() -> int:
    """把 market_daily 的六维与结论落到历史表，历史页才有连续序列"""
    rows = db.query("SELECT * FROM market_daily ORDER BY trade_date")
    written = 0
    for r in rows:
        d = dict(r)
        dims = json.loads(d.get("dims") or "{}")
        db.execute(
            "INSERT OR REPLACE INTO market_env_history(trade_date,score,label,trend,breadth,"
            "activity,seal,moving_avg,high_low,amount,limit_up,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (d["trade_date"], d.get("score"), emotion_label(d.get("score"))["label"],
             dims.get("trend"), dims.get("breadth"), dims.get("activity"), dims.get("seal"),
             dims.get("ma"), dims.get("hl"), d.get("amount"), d.get("limit_up"),
             d.get("source_note")))
        written += 1
    return written


def backfill(days: int = 40, force: bool = False) -> dict:
    """用本地日线缓存回算历史六维：涨跌广度、MA20 分布、60 日新高新低、成交额环比，
    涨停/炸板来自 limit_pool 历史，指数趋势来自指数日线。只补没有的日子，不动已有结论。"""
    have = db.query_one("SELECT COUNT(*) c FROM market_env_history")["c"] or 0
    if have >= BACKFILL_MIN_ROWS and not force:
        return {"ok": True, "skipped": True, "rows": have,
                "message": f"历史表已有 {have} 天，够用了；要重算传 force"}

    start = (datetime.now() - timedelta(days=int(days * 2.2) + 90)).strftime("%Y-%m-%d")
    bars = db.rows_of("SELECT symbol,trade_date,close,high,low,amount FROM kline_cache "
                      "WHERE trade_date>=? AND close IS NOT NULL ORDER BY symbol,trade_date",
                     (start,))
    if not bars:
        return {"ok": False, "message": "本地日线缓存是空的，先跑一次 kline 刷新", "rows": 0}

    by_symbol: dict[str, list[tuple]] = {}
    for sym, day, close, high, low, amount in bars:
        by_symbol.setdefault(sym, []).append((day, close, high, low, amount or 0))

    index_change: dict[str, float] = {}
    errors: dict[str, str] = {}
    for sym, weight in INDEX_WEIGHTS.items():
        try:
            rows = registry.kline_daily(sym, days * 2 + 60)
        except ProviderError as exc:
            errors[f"kline_{sym}"] = exc.message
            continue
        closes = [(r.get("day") or r.get("date"), r["close"]) for r in rows]
        for i in range(1, len(closes)):
            d, c, prev = closes[i][0], closes[i][1], closes[i - 1][1]
            if not d or not prev:
                continue
            index_change[d] = index_change.get(d, 0.0) + (c / prev - 1) * 100 * weight

    totals: dict[str, dict] = {}
    for sym, seq in by_symbol.items():
        if len(seq) < 2:
            continue
        for i in range(1, len(seq)):
            day, close, high, low, amount = seq[i]
            it = totals.setdefault(day, {"total": 0, "up": 0, "down": 0, "flat": 0,
                                         "maAbove": 0, "maN": 0, "newHigh": 0, "newLow": 0,
                                         "amount": 0.0})
            it["total"] += 1
            prev_close = seq[i - 1][1]
            if close > prev_close:
                it["up"] += 1
            elif close < prev_close:
                it["down"] += 1
            else:
                it["flat"] += 1
            it["amount"] += amount
            window = seq[max(0, i - 19):i + 1]
            if len(window) >= 20:
                it["maN"] += 1
                if close >= sum(w[1] for w in window) / len(window):
                    it["maAbove"] += 1
            look = seq[max(0, i - 60):i]
            if len(look) >= 20:
                if high >= max(w[2] for w in look):
                    it["newHigh"] += 1
                if low <= min(w[3] for w in look):
                    it["newLow"] += 1

    # 下面要 pool.get(...)，sqlite3.Row 没有 .get，这里先转成 dict
    pools = {r["trade_date"]: dict(r) for r in db.query(
        "SELECT trade_date, "
        "SUM(CASE WHEN kind='up' THEN 1 ELSE 0 END) up, "
        "SUM(CASE WHEN kind='blown' THEN 1 ELSE 0 END) blown, "
        "SUM(CASE WHEN kind='down' THEN 1 ELSE 0 END) dn "
        "FROM limit_pool GROUP BY trade_date")}

    dates = sorted(totals)
    written = 0
    prev_amount = None
    for day in dates:
        key = day.replace("-", "")
        if db.query_one("SELECT trade_date FROM market_env_history WHERE trade_date=?", (key,)):
            prev_amount = totals[day]["amount"]
            continue
        t = totals[day]
        avp = round((t["amount"] / prev_amount - 1) * 100, 2) if prev_amount else None
        pool = pools.get(key) or {}
        dims = market.compute_dims(
            index_change=index_change.get(day),
            up=t["up"], down=t["down"], amount_vs_prev=avp,
            limit_up=pool.get("up"), blown=pool.get("blown"),
            ma20_above_ratio=(t["maAbove"] / t["maN"]) if t["maN"] else None,
            new_high=t["newHigh"] or None, new_low=t["newLow"] or None)
        score = market.composite_score(dims)
        db.execute(
            "INSERT OR REPLACE INTO market_env_history(trade_date,score,label,trend,breadth,"
            "activity,seal,moving_avg,high_low,amount,limit_up,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (key, score, emotion_label(score)["label"], dims.get("trend"), dims.get("breadth"),
             dims.get("activity"), dims.get("seal"), dims.get("ma"), dims.get("hl"),
             round(t["amount"] / 1e8, 2), pool.get("up"),
             f"本地回算：{t['total']} 只个股日线 + limit_pool 历史，指数趋势按上证/深成/创业/科创加权"))
        written += 1
        prev_amount = t["amount"]
    return {"ok": True, "skipped": False, "written": written, "dates": len(dates),
            "errors": errors, "at": db.now()}



def overview() -> dict:
    daily = market.latest_daily()
    errors: dict[str, str] = {}
    score = (daily or {}).get("score")
    dims = (daily or {}).get("dims") or {}
    if not dims:
        dims = market.compute_dims(index_change=market.live_index_avg(), up=None, down=None,
                                   amount_vs_prev=None, limit_up=None, blown=None,
                                   ma20_above_ratio=None, new_high=None, new_low=None)
        score = market.composite_score(dims)

    trend = market.trend_strength()
    buckets = market.breadth_buckets()
    pools: dict[str, Any] = {}
    try:
        pools = registry.limit_pools(registry.trade_date_hint())["counts"]
    except Exception as exc:  # noqa: BLE001
        errors["limit_pools"] = f"{type(exc).__name__}: {exc}"[:160]

    dims_out = []
    for key, label, weight, how in market.DIM_META:
        v = dims.get(key)
        dims_out.append({"key": key, "label": label, "weight": weight, "how": how,
                         "value": v, "band": emotion_label(v)["label"] if v is not None else "缺数据"})

    history = [dict(r) for r in db.query(
        "SELECT trade_date,score,label,trend,breadth,activity,seal,moving_avg,high_low,amount,limit_up "
        "FROM market_env_history ORDER BY trade_date DESC LIMIT 30")]
    history.reverse()

    try:
        boards = registry.boards("industry")[:8]
    except ProviderError as exc:
        boards = []
        errors["boards"] = exc.message

    return {
        "available": bool(daily),
        "tradeDate": (daily or {}).get("trade_date"),
        "builtAt": (daily or {}).get("built_at"),
        "score": score,
        "emotion": emotion_label(score),
        "bands": [{"lo": lo, "hi": hi, "label": label, "meaning": meaning}
                  for lo, hi, label, meaning in EMOTION_BANDS],
        "dims": dims_out,
        "breadth": {k: (daily or {}).get(k) for k in
                    ("total", "up", "down", "flat", "limit_up", "limit_down", "blown", "amount")},
        "histogram": buckets,
        "trend": trend,
        "livePools": pools,
        "topBoards": boards,
        "scoreHistory": history,
        "phase": market.market_phase(),
        "errors": errors,
        "note": "六维分数只在收盘快照建成后更新；盘中看到的是上一交易日的结论，实时涨停数另列",
        "generatedAt": db.now(),
    }


def history(days: int = 60) -> dict:
    sync_history()
    rows = [dict(r) for r in db.query(
        "SELECT * FROM market_env_history ORDER BY trade_date DESC LIMIT ?", (max(1, min(days, 500)),))]
    rows.reverse()
    if rows:
        # 环比与分档变化，历史页要能看出情绪是往上走还是往下掉
        prev = None
        for r in rows:
            r["scoreChange"] = round(r["score"] - prev, 1) if (prev is not None
                                                               and r.get("score") is not None) else None
            prev = r.get("score") if r.get("score") is not None else prev
            r["emotion"] = emotion_label(r.get("score"))
    dist: dict[str, int] = {}
    for r in rows:
        dist[r.get("label") or "待更新"] = dist.get(r.get("label") or "待更新", 0) + 1
    return {"rows": rows, "total": len(rows),
            "avgScore": round(sum(r["score"] for r in rows if r.get("score") is not None)
                              / max(1, len([r for r in rows if r.get("score") is not None])), 1)
                              if rows else None,
            "labelDist": dist,
            "max": max((r for r in rows if r.get("score") is not None),
                       key=lambda x: x["score"], default=None),
            "min": min((r for r in rows if r.get("score") is not None),
                       key=lambda x: x["score"], default=None)}
