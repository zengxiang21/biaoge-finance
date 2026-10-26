"""仪表盘与全局调度：/dashboard/*"""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, Query

from .. import db, scheduler, security
from ..services import dashboard, market

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview")
def overview(refresh: bool = Query(False), user: dict = Depends(security.current_user)) -> dict:
    return dashboard.overview(refresh=refresh)


@router.get("/global-schedule")
def get_schedule(user: dict = Depends(security.current_user)) -> dict:
    return scheduler.status()


@router.put("/global-schedule")
def update_schedule(body: dict, user: dict = Depends(security.current_user)) -> dict:
    cfg = db.get_setting("global_schedule", {}) or {}
    for key in ("enabled", "daily_time", "intraday_interval_min", "tasks", "note"):
        if key in body:
            cfg[key] = body[key]
    db.set_setting("global_schedule", cfg)
    db.audit(user["id"], "dashboard:schedule:update", str(cfg.get("daily_time")))
    applied = scheduler.apply_settings()
    return {"config": cfg, "scheduler": applied, "status": scheduler.status()}


@router.post("/snapshot/build")
def build_snapshot(date: str | None = Query(None), user: dict = Depends(security.current_user)) -> dict:
    """重建全市场收盘快照：全市场 5500+ 只要翻页，放后台线程跑"""
    if market.progress()["state"] == "running":
        return {"ok": False, "message": "已经有任务在跑", "progress": market.progress()}
    t = threading.Thread(target=market.build_snapshot, kwargs={"date_yyyymmdd": date,
                                                               "trigger": "api"}, daemon=True)
    t.start()
    return {"ok": True, "message": "快照任务已启动，轮询 /dashboard/snapshot/progress 看进度",
            "progress": market.progress()}


@router.get("/snapshot/progress")
def snapshot_progress(user: dict = Depends(security.current_user)) -> dict:
    return market.progress()


@router.get("/daily")
def daily(user: dict = Depends(security.current_user)) -> dict:
    return market.latest_daily() or {}


@router.get("/ladder")
def ladder(date: str | None = Query(None), board: str = Query(""),
           keyword: str = Query(""), full: bool = Query(False),
           user: dict = Depends(security.current_user)) -> dict:
    """涨停梯队页要 full=true（三池 + 一字板/标签 + 昨日晋级），仪表盘只要分层"""
    from ..providers import registry
    return market.ladder(date or registry.trade_date_hint(),
                         board=board, keyword=keyword, full=full)


@router.get("/intraday")
def intraday(symbol: str = Query("sh000001"), user: dict = Depends(security.current_user)) -> dict:
    from ..providers import registry
    try:
        return {"symbol": symbol, "points": registry.minute_trend(symbol)}
    except Exception as exc:  # noqa: BLE001
        return {"symbol": symbol, "points": [], "error": str(exc)[:200]}
