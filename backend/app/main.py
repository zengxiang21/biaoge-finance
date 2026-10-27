"""FastAPI 入口"""
from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, scheduler
from .routers import (admin, ai, anomaly, auth, dashboard, holdings, info, market_data, review,
                      research, settings as settings_router, simulation, strategies, system,
                      watchlist)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    scheduler.start()
    threading.Thread(target=_probe_all, name="probe-sources", daemon=True).start()
    threading.Thread(target=_warm_strategy_data, name="warm-strategy", daemon=True).start()
    print(f"[start] 后端 http://{config.HOST}:{config.PORT}/api  文档 /docs  DB {config.DB_PATH}")
    yield
    if scheduler.scheduler:
        scheduler.scheduler.shutdown(wait=False)


def _warm_strategy_data() -> None:
    """启动后补齐策略依赖：当天日线缓存增量 + 板块成分映射"""
    import time

    from .db import execute, query_one
    from .services import kline, strategy_engine as eng
    time.sleep(3)
    try:
        n = query_one("SELECT COUNT(*) c FROM strategy_pick WHERE run_id NOT IN (SELECT id FROM strategy_run)")
        if n and n["c"]:
            execute("DELETE FROM strategy_pick WHERE run_id NOT IN (SELECT id FROM strategy_run)")
            print(f"[warm] 清理孤立选股结果 {n['c']} 行")
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 孤立结果清理失败: {type(exc).__name__}: {exc}")
    try:
        kline.refresh(workers=8)
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 日线缓存刷新失败: {type(exc).__name__}: {exc}")
    try:
        eng.ensure_board_map()
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 板块映射构建失败: {type(exc).__name__}: {exc}")
    # Phase H：市场环境历史页 + 并购重组事件页首次打开就要有数据
    from .services import events, market_env
    try:
        st = market_env.backfill(days=60)
        print(f"[warm] 市场环境历史回算: {st}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 市场环境历史回算失败: {type(exc).__name__}: {exc}")
    try:
        print(f"[warm] 并购重组扫描: {events.refresh(6)}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 并购重组扫描失败: {type(exc).__name__}: {exc}")
    # 宽基估值历史库里没数据就先建一次，指数页打开才有区间可画
    from .services import valuation
    try:
        have = query_one("SELECT COUNT(*) c FROM index_valuation_history")
        if not have or not have["c"]:
            print("[warm] 估值历史库为空，开始重建（失败会自动补试）")
            scheduler.valuation_rebuild()
        else:
            print(f"[warm] 估值历史已有 {have['c']} 行")
        # 16 个对象没齐说明有代码被上游挡过（乐咕 504、科创板/中证800 缺行），补读云端快照
        missing = len(valuation.UNIVERSE) - int(
            query_one("SELECT COUNT(DISTINCT index_code) c FROM index_valuation_history")["c"])
        if missing > 0:
            print(f"[warm] 估值历史还缺 {missing} 个对象: {valuation.sync_from_github()}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warm] 估值历史重建失败: {type(exc).__name__}: {exc}")


def _probe_all() -> None:
    """启动后主动打一遍各能力主源，数据源矩阵页首次打开就有状态"""
    import time

    from .providers import registry
    from .providers.base import ProviderError
    from .services import global_market as gm
    probes = {
        "index": registry.index_quotes,
        "kline_daily": lambda: registry.kline_daily("sh000001", 30),
        "minute_trend": lambda: registry.minute_trend("sh000001"),
        "board_industry": lambda: registry.boards("industry"),
        "limit_up_pool": lambda: registry.limit_pools(registry.trade_date_hint()),
        # 全球指数页首屏要 5 秒（CBOE 历史有 470KB），启动先把服务缓存焐热
        "fear_index": lambda: gm.fear_panel(),
        "global_index": lambda: gm.global_index(),
    }
    for cap, fn in probes.items():
        try:
            fn()
        except ProviderError:
            pass
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.2)


app = FastAPI(title="曾老师", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:4173", "http://127.0.0.1:4173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

for r in (auth.router, dashboard.router, watchlist.router, market_data.router,
          strategies.router, ai.router, system.router, info.router, anomaly.router,
          holdings.router, simulation.router, review.router, research.router,
          admin.router, admin.user_feedback_router, settings_router.router):
    app.include_router(r, prefix="/api")

# 通用设置页上传的 Logo / 收款码
config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": {
        "code": "INTERNAL", "message": f"{type(exc).__name__}: {exc}"[:400]}})


@app.get("/api/health")
def health() -> dict:
    from .services import market
    row = db.query_one("SELECT trade_date, built_at FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    return {"ok": True, "time": db.now(), "db": str(config.DB_PATH),
            "snapshotDate": row["trade_date"] if row else None,
            "snapshotBuiltAt": row["built_at"] if row else None,
            "phase": market.market_phase()}
