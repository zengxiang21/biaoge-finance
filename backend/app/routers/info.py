"""资讯中心 /info/*：快讯、新闻雷达、热搜、资金流（拆解文档 3.11）"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db, security
from ..services import events, info

router = APIRouter(tags=["info"])
VIEW = security.require_perm("info:view")


@router.get("/info/news-flash")
def news_flash(size: int = Query(80, le=200), keyword: str = Query(""),
               source: str = Query(""), stock: str = Query(""),
               only_radar: bool = Query(False), user: dict = Depends(VIEW)) -> dict:
    return info.news_flash(size, keyword, source, only_radar, stock)


@router.get("/info/news-radar")
def news_radar(user: dict = Depends(VIEW)) -> dict:
    return info.radar_config()


@router.put("/info/news-radar")
def save_radar(body: dict, user: dict = Depends(VIEW)) -> dict:
    cfg = info.save_radar_config(body or {})
    db.audit(user["id"], "info:news-radar:update", str(cfg)[:200])
    return {"config": cfg}


@router.get("/info/hot-search")
def hot_search(num: int = Query(30, le=60), user: dict = Depends(VIEW)) -> dict:
    return info.hot_search(num)


@router.get("/info/fund-flow/sectors")
def fund_flow_sectors(kind: str = Query("industry", pattern="^(industry|concept|region)$"),
                      limit: int = Query(60, le=100), user: dict = Depends(VIEW)) -> dict:
    return info.sector_flow(kind, limit)


@router.get("/info/fund-flow/stocks")
def fund_flow_stocks(limit: int = Query(60, le=100),
                     direction: str = Query("in", pattern="^(in|out)$"),
                     user: dict = Depends(VIEW)) -> dict:
    return info.stock_flow(limit, direction)


@router.get("/info/fund-flow/stock")
def fund_flow_stock(symbol: str = Query(...), days: int = Query(20, le=60),
                    user: dict = Depends(VIEW)) -> dict:
    return info.stock_flow_daily(symbol, days)


@router.get("/info/fund-flow/market")
def fund_flow_market(user: dict = Depends(VIEW)) -> dict:
    return info.market_flow()


# ---------------------------------------------------------------- 并购重组（文档 3.10）
MERGER = security.require_perm("merger:view")


@router.get("/info/merger")
def merger_list(keyword: str = Query(""), days: int = Query(120, le=365),
                stage: str = Query(""), symbol: str = Query(""),
                limit: int = Query(200, le=500), user: dict = Depends(MERGER)) -> dict:
    return events.list_events(keyword, days, limit, stage, symbol)


@router.post("/info/merger/scan")
def merger_scan(pages: int = Query(6, le=20), user: dict = Depends(MERGER)) -> dict:
    """公告流 + 本地快讯双路扫描，命中的并购重组事件入 event_item"""
    out = events.refresh(pages)
    db.audit(user["id"], "info:merger:scan", f"pages={pages} total={out.get('total')}")
    return out
