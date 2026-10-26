"""个股分析：把行情、K线、技术特征、支撑压力、资金与消息面合成一次给前端"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .. import db
from ..providers import registry, sina
from ..providers.base import ProviderError, norm_symbol
from . import indicators, market


def _levels(price: float, feat: dict, piv: dict) -> list[dict]:
    """枢轴点 / 均线 / 区间高低 / 布林轨汇成一串价位，按价格从高到低排"""
    cand = [
        ("压力 R2", piv.get("r2"), "压力"), ("压力 R1", piv.get("r1"), "压力"),
        ("枢轴 P", piv.get("pivot"), None),
        ("支撑 S1", piv.get("s1"), "支撑"), ("支撑 S2", piv.get("s2"), "支撑"),
        ("60 日高", feat.get("h60"), None), ("20 日高", feat.get("h20"), None),
        ("布林上轨", feat.get("boll_up"), None), ("MA20", feat.get("ma20"), None),
        ("MA60", feat.get("ma60"), None), ("布林下轨", feat.get("boll_low"), None),
        ("20 日低", feat.get("l20"), None), ("60 日低", feat.get("l60"), None),
    ]
    out = []
    for label, v, forced in cand:
        if not v or v <= 0:
            continue
        kind = forced or ("压力" if v > price else "支撑" if v < price else "轴")
        out.append({"label": label, "price": round(v, 2), "kind": kind,
                    "distance": round((v - price) / price * 100, 2)})
    out.sort(key=lambda x: -x["price"])
    return out


def _alerts(price: float, feat: dict, levels: list[dict], limit_rate: float) -> list[dict]:
    """点位提醒：只报离现价 6% 以内的，远处的支撑人够不着"""
    near = [l for l in levels if abs(l["distance"]) <= 6 and l["kind"] != "轴"]
    out = [{"kind": l["kind"], "label": l["label"], "price": l["price"],
            "distance": l["distance"],
            "text": f"{'上行' if l['distance'] > 0 else '下行'} {abs(l['distance'])}% 到{l['label']}"
                    f"（{l['price']}）"} for l in near[:6]]
    for key, label, kind in (("h60", "60 日新高", "压力"), ("l60", "60 日新低", "支撑")):
        v = feat.get(key)
        if v and price and abs((v - price) / price * 100) <= 6:
            out.append({"kind": kind, "label": label, "price": round(v, 2),
                        "distance": round((v - price) / price * 100, 2),
                        "text": f"距{label} {abs((v - price) / price * 100):.2f}%"})
    up = round(price * (1 + limit_rate) + 1e-9, 2)
    down = round(price * (1 - limit_rate) + 1e-9, 2)
    out.append({"kind": "limit", "label": "明日涨停/跌停价", "price": up,
                "distance": round(limit_rate * 100, 1),
                "text": f"按 {limit_rate * 100:.0f}% 涨跌幅，次日涨停 {up} / 跌停 {down}"})
    return out


def detail(symbol: str, days: int = 120) -> dict:
    try:
        n = norm_symbol(symbol)
    except ValueError as exc:
        return {"ok": False, "message": str(exc), "symbol": symbol}
    sym, code = n["symbol"], n["code"]
    errors: dict[str, str] = {}

    quote: dict[str, Any] | None = None
    try:
        rows = registry.realtime([sym])
        quote = rows[0] if rows else None
    except ProviderError as exc:
        errors["realtime"] = exc.message

    snap = market.snapshot_row(sym) or {}
    bars: list[dict] = []
    try:
        bars = registry.kline_daily(sym, days)
    except ProviderError as exc:
        errors["kline"] = exc.message
    minute: list[dict] = []
    try:
        minute = registry.minute_trend(sym)
    except ProviderError as exc:
        errors["minute"] = exc.message

    feat = indicators.build_features(bars, spot=quote or snap, symbol=sym,
                                     limit_rate=snap.get("limit_rate")) or {}
    piv = indicators.pivot(bars[-1]) if bars else None
    price = quote.get("price") if quote else None
    price = price or feat.get("close") or snap.get("price")
    levels = _levels(price, feat, piv or {}) if price else []
    name = (quote or {}).get("name") or snap.get("name") or code
    limit_rate = snap.get("limit_rate") or (quote or {}).get("limit_rate") \
        or market._limit_rate(name, n["prefix"], code)

    boards = [dict(r) for r in db.query(
        "SELECT kind,board_code,board_name FROM stock_board WHERE symbol=? "
        "ORDER BY kind DESC, board_name", (sym,))]
    limit_hist = [dict(r) for r in db.query(
        "SELECT trade_date,kind,lbc,fund,fbt,zb_count,sector,stat FROM limit_pool "
        "WHERE symbol=? ORDER BY trade_date DESC LIMIT 12", (sym,))]
    fund: list[dict] = []
    try:
        fund = sina.money_flow_stock(sym)
    except Exception as exc:  # noqa: BLE001
        errors["fund_flow"] = f"{type(exc).__name__}: {exc}"[:160]

    return {
        "ok": bool(bars or quote),
        "symbol": sym, "code": code,
        "name": name,
        "quote": quote, "snapshot": snap, "bars": bars, "minute": minute,
        "features": feat, "pivot": piv, "levels": levels,
        "price": price, "limitRate": limit_rate,
        "nearest": {"resistance": next((l for l in levels if l["kind"] == "压力"), None),
                    "support": next((l for l in reversed(levels) if l["kind"] == "支撑"), None)},
        "alerts": _alerts(price, feat, levels, limit_rate) if price else [],
        "boards": boards, "limitHistory": limit_hist, "fundFlow": fund,
        "tradeDate": snap.get("trade_date"), "errors": errors,
    }


def news(symbol: str) -> dict:
    """消息面：个股公告 + 7x24 快讯里点名这只票的 + 龙虎榜 + 人气榜排名"""
    try:
        n = norm_symbol(symbol)
    except ValueError as exc:
        return {"ok": False, "message": str(exc), "symbol": symbol}
    sym, code = n["symbol"], n["code"]
    d = detail(sym, days=30)
    name = d["name"]
    errors: dict[str, str] = dict(d["errors"])

    def safe(key, fn, default):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            errors[key] = f"{type(exc).__name__}: {exc}"[:160]
            return default

    ann = safe("announcements", lambda: registry.announcements(size=15, stock_code=code), [])
    flash_all = safe("news_flash", lambda: registry.news_flash(size=120), [])
    flash = [x for x in flash_all
             if any(str(s).endswith(code) for s in (x.get("stocks") or []))
             or (name and name in f"{x.get('title')}{x.get('summary')}")]
    roll = [x for x in safe("news_roll", lambda: registry.news_roll(60), [])
            if name and name in f"{x.get('title')}{x.get('summary')}"]
    day0 = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    board = [r for r in safe("billboard", lambda: registry.billboard(day0), [])
             if str(r.get("symbol")) == code]
    hot = safe("hot_rank", lambda: registry.hot_rank(100), [])
    rank = next((h.get("rank") for h in hot if h.get("symbol") == sym), None)

    return {"ok": True, "symbol": sym, "code": code, "name": name,
            "announcements": ann, "news": (flash or roll)[:20], "newsCount": len(flash),
            "billboard": board[:10], "hotRank": rank,
            "hotTotal": len(hot), "errors": errors}
