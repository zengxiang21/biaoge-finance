"""行情数据 / 搜索：/market-data/*、/stock-analysis/search"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import security
from ..providers import registry, sina
from ..providers.base import ProviderError, norm_symbol
from ..services import indicators, market, stock_analysis

router = APIRouter(tags=["market-data"])
VIEW = security.require_perm("menu:market-data:quotes")


@router.get("/market-data/summary")
def summary(user: dict = Depends(VIEW)) -> dict:
    daily = market.latest_daily()
    try:
        indexes = registry.index_quotes()
    except ProviderError as exc:
        indexes = []
        daily = {**(daily or {}), "_error": exc.message}
    return {"indexes": indexes, "daily": daily, "phase": market.market_phase(),
            "emotion": (daily or {}).get("dims"), "score": (daily or {}).get("score")}


@router.get("/market-data/breadth")
def breadth(user: dict = Depends(VIEW)) -> dict:
    daily = market.latest_daily()
    if not daily:
        return {"available": False, **market.breadth_from_live()}
    return {"available": True, **{k: daily[k] for k in
            ("trade_date", "total", "up", "down", "flat", "limit_up", "limit_down",
             "blown", "amount", "volume", "score", "built_at")}}


@router.get("/market-data/rankings")
def rankings(sort: str = Query("changepercent"), desc: bool = Query(True),
             num: int = Query(30, le=100), user: dict = Depends(VIEW)) -> dict:
    try:
        return {"sort": sort, "desc": desc, "rows": sina.spot_ranking(sort, desc, num)}
    except ProviderError as exc:
        return {"sort": sort, "desc": desc, "rows": [], "error": exc.message}


@router.get("/market-data/quotes/daily")
def quotes_daily(symbol: str = Query(...), days: int = Query(120, le=500),
                 user: dict = Depends(VIEW)) -> dict:
    try:
        bars = registry.kline_daily(symbol, days)
    except ProviderError as exc:
        return {"symbol": symbol, "bars": [], "error": exc.message}
    closes = [b["close"] for b in bars]
    last = bars[-1] if bars else {}

    def ma(n: int) -> float | None:
        return round(sum(closes[-n:]) / n, 3) if len(closes) >= n else None

    return {
        "symbol": norm_symbol(symbol)["symbol"], "bars": bars, "count": len(bars),
        "indicators": {
            "ma5": ma(5), "ma10": ma(10), "ma20": ma(20), "ma60": ma(60),
            "boll": _boll(closes),
            "pivot": _pivot(last),
            "high_60": max((b["high"] for b in bars[-60:]), default=None),
            "low_60": min((b["low"] for b in bars[-60:]), default=None),
        },
    }


@router.get("/market-data/quotes/realtime")
def quotes_realtime(symbols: str = Query(..., description="逗号分隔"),
                    user: dict = Depends(VIEW)) -> dict:
    try:
        return {"rows": registry.realtime([s for s in symbols.split(",") if s])}
    except ProviderError as exc:
        return {"rows": [], "error": exc.message}


@router.get("/market-data/minute")
def minute(symbol: str = Query("sh000001"), user: dict = Depends(VIEW)) -> dict:
    try:
        return {"symbol": symbol, "points": registry.minute_trend(symbol)}
    except ProviderError as exc:
        return {"symbol": symbol, "points": [], "error": exc.message}


@router.get("/market-data/boards")
def boards(kind: str = Query("industry", pattern="^(industry|concept)$"), limit: int = Query(30, le=100),
           user: dict = Depends(VIEW)) -> dict:
    try:
        rows = registry.boards(kind)
    except ProviderError as exc:
        return {"kind": kind, "rows": [], "error": exc.message}
    return {"kind": kind, "rows": rows[:limit], "total": len(rows)}


@router.get("/market-data/boards/stocks")
def board_stocks(code: str = Query(...), num: int = Query(50, le=200),
                 user: dict = Depends(VIEW)) -> dict:
    try:
        return {"board": code, "rows": sina.board_stocks(code, num)}
    except ProviderError as exc:
        return {"board": code, "rows": [], "error": exc.message}


@router.get("/market-data/securities/search")
@router.get("/stock-analysis/search")
def search(keyword: str = Query("", alias="keyword"), limit: int = Query(20, le=50),
           user: dict = Depends(security.current_user)) -> dict:
    kw = keyword.strip()
    if not kw:
        return {"keyword": kw, "rows": []}
    rows = market.search_stocks(kw, limit)
    if not rows:
        try:
            rows = [{"symbol": norm_symbol(kw)["symbol"], "code": norm_symbol(kw)["code"],
                     "name": kw, "price": None, "change_percent": None, "matched": "code-guess"}]
        except ValueError:
            rows = []
    return {"keyword": kw, "rows": rows, "snapshotReady": bool(market.latest_daily())}


@router.get("/stock-analysis/detail")
def analysis_detail(symbol: str = Query(...), days: int = Query(120, le=500),
                    user: dict = Depends(VIEW)) -> dict:
    return stock_analysis.detail(symbol, days)


@router.get("/stock-analysis/news")
def analysis_news(symbol: str = Query(...), user: dict = Depends(VIEW)) -> dict:
    return stock_analysis.news(symbol)


def _boll(closes: list[float], n: int = 20) -> dict | None:
    mid, up, low, width = indicators.boll(closes, n)
    if mid is None:
        return None
    return {"mid": mid, "upper": up, "lower": low, "width": width}


_pivot = indicators.pivot
