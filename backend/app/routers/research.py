"""Phase H 路由：全球指数 / 原油黄金 / 板块热度 / 指数 / 市场环境 / 基础数据 / 财务（文档 2.1 路由 9-12、30、39-44）"""
from __future__ import annotations

import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import db, scheduler, security
from ..providers.base import ProviderError
from ..services import academy, fundamentals, global_market, info, market, market_env, valuation

router = APIRouter(tags=["research"])
_backfill_state: dict = {"running": False, "startedAt": None, "finishedAt": None, "result": None}


def _ymd(value: str | None, label: str) -> str | None:
    """手动估值区间的日期校验：只认 YYYY-MM-DD，错了他返回中文说明而不是 422"""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{label}格式要是 YYYY-MM-DD")


def board_viewer(user: dict = Depends(security.current_user)) -> dict:
    """概念分析和行业分析共用一个接口，两个菜单权限有其一就能看"""
    if not (security.has_perm(user, "menu:concept-analysis")
            or security.has_perm(user, "menu:industry-analysis")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "PERMISSION_DENIED", "message": "缺少概念/行业分析权限"})
    return user


GLOBAL_VIEW = security.require_perm("global-index:view")
CN_INDEX_VIEW = security.require_perm("menu:index:overview")
CN_COMPONENT_VIEW = security.require_perm("menu:index:components")


def index_viewer(user: dict = Depends(security.current_user)) -> dict:
    """估值接口在概览页和成分页都要用，两个菜单权限有其一就能看"""
    if not (security.has_perm(user, "menu:index:overview")
            or security.has_perm(user, "menu:index:components")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "PERMISSION_DENIED", "message": "缺少指数估值权限"})
    return user
ENV_VIEW = security.require_perm("menu:market-env:overview")
ENV_HISTORY_VIEW = security.require_perm("menu:market-env:history")
FUNDAMENTAL_VIEW = security.require_perm("menu:market-data:fundamentals")
STATEMENT_VIEW = security.require_perm("menu:finance:statements")
INDICATOR_VIEW = security.require_perm("menu:finance:indicators")


@router.get("/global-market/index")
def global_index(refresh: bool = Query(False), user: dict = Depends(GLOBAL_VIEW)) -> dict:
    return global_market.global_index(refresh)


@router.get("/global-market/commodity")
def oil_gold(user: dict = Depends(security.require_perm("menu:oil-gold"))) -> dict:
    return global_market.oil_gold()


@router.get("/market-data/boards/heat")
def boards_heat(kind: str = Query("industry", pattern="^(industry|concept)$"),
                limit: int = Query(30, le=100), with_flow: bool = Query(True),
                user: dict = Depends(board_viewer)) -> dict:
    """板块热度榜：本地收盘快照口径 + 主力资金流按板块名合并"""
    heat = market.board_heat(kind, limit)
    out = {**heat, "rows": (heat.get("top") or [])}
    if with_flow:
        flow = info.sector_flow(kind, 100)
        by_name = {r["name"]: r for r in flow.get("rows") or []}
        for r in out["rows"]:
            hit = by_name.get(r["name"])
            if hit:
                r["netAmount"] = round((hit.get("netAmount") or 0) / 1e8, 2)
                r["netRatio"] = hit.get("netRatio")
                r["turnoverSrc"] = hit.get("turnover")
                r["flowCode"] = hit.get("code")
        out["flowError"] = flow.get("error")
        out["flowDate"] = flow.get("date")
        out["sumNet"] = flow.get("sumNet")
    return out


@router.get("/market-data/boards/flow")
def boards_flow(kind: str = Query("concept", pattern="^(industry|concept|region)$"),
                limit: int = Query(60, le=100), user: dict = Depends(board_viewer)) -> dict:
    return info.sector_flow(kind, limit)


@router.get("/market-data/boards/members")
def boards_members(kind: str = Query("concept", pattern="^(industry|concept)$"),
                   code: str = Query(...), name: str = Query(""),
                   limit: int = Query(100, le=300),
                   user: dict = Depends(board_viewer)) -> dict:
    """板块成分股列表（文档 3.7）"""
    return market.board_members(kind, code, name, limit)


@router.get("/index/overview")
def index_overview(user: dict = Depends(CN_INDEX_VIEW)) -> dict:
    return global_market.index_overview()


@router.get("/index/components")
def index_components(index: str = Query("hs300"), user: dict = Depends(CN_COMPONENT_VIEW)) -> dict:
    """成分名单 + 这个指数有没有对应的估值长序列（没有就不画）"""
    code = valuation.COMPONENT_VALUATION.get(index)
    return {**global_market.index_component(index),
            "valuationCode": code,
            "valuationNote": valuation.COMPONENT_VALUATION_NOTE.get(index)
            if code else None}


@router.get("/index/valuation/overview")
def index_valuation_overview(refresh: bool = Query(False),
                             user: dict = Depends(index_viewer)) -> dict:
    """宽基估值一览 + 覆盖清单（页面按 universe 选指数，成分页要估值代码走 /index/components）"""
    if refresh:
        valuation.invalidate()
    out = valuation.overview()
    return {**out, "universe": [{"code": i["code"], "name": i["name"], "kind": i["kind"]}
                                for i in valuation.UNIVERSE]}


@router.get("/index/valuation")
def index_valuation(code: str = Query("000300.SH"), years: float = Query(0, ge=0, le=40),
                    start: str | None = Query(None), end: str | None = Query(None),
                    refresh: bool = Query(False),
                    user: dict = Depends(index_viewer)) -> dict:
    """单个指数的长历史估值区间：当前值、窗口分位、便宜/合理/偏贵三档区间带与月度序列

    窗口三种给法：start/end 手动区间（优先）> years 回推 > 全部历史
    """
    begin, stop = _ymd(start, "开始日期"), _ymd(end, "结束日期")
    if begin and stop and begin > stop:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "开始日期不能晚于结束日期")
    return valuation.panel(code, years or None, refresh, begin, stop)


@router.post("/index/valuation/rebuild")
def index_valuation_rebuild(user: dict = Depends(index_viewer)) -> dict:
    """整轮重建估值历史库：16 个对象要打约 32 次上游请求（限流后 1 分多钟），放后台线程"""
    if valuation.status()["running"]:
        return {"ok": True, "started": False, "message": "已经在重建中，等它跑完"}
    threading.Thread(target=scheduler.valuation_rebuild, name="valuation-rebuild",
                     daemon=True).start()
    return {"ok": True, "started": True,
            "message": "开始重建宽基估值历史（乐咕乐股，约 1 分钟），进度看返回的 status"}


@router.post("/index/valuation/sync")
def index_valuation_sync(user: dict = Depends(index_viewer)) -> dict:
    """读 GitHub Actions 每天回写的估值快照：乐咕整站挂了时的第二条数据来源"""
    return valuation.sync_from_github()


@router.get("/market-env")
def market_env_view(user: dict = Depends(ENV_VIEW)) -> dict:
    return market_env.overview()


@router.get("/market-env/history")
def market_env_history(days: int = Query(60, le=500), user: dict = Depends(ENV_HISTORY_VIEW)) -> dict:
    return market_env.history(days)


@router.post("/market-env/backfill")
def market_env_backfill(days: int = Query(60, le=240), force: bool = Query(False),
                        user: dict = Depends(ENV_HISTORY_VIEW)) -> dict:
    """历史六维用本地日线缓存回算，放后台线程跑，页面轮询 history 看结果"""
    if _backfill_state["running"]:
        return {"ok": False, "message": "回填任务正在跑", **_backfill_state}
    _backfill_state.update({"running": True, "startedAt": db.now(), "result": None})

    def run():
        try:
            result = market_env.backfill(days=days, force=force)
        except Exception as exc:  # noqa: BLE001
            result = {"ok": False, "message": f"{type(exc).__name__}: {exc}"[:200]}
        _backfill_state.update({"running": False, "result": result, "finishedAt": db.now()})
        db.audit(user["id"], "market-env:backfill", f"days={days} force={force}")

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "message": "回填已启动，稍后刷新历史页", **_backfill_state}


@router.get("/data/fundamentals")
def fundamentals_profile(symbol: str = Query(...), user: dict = Depends(FUNDAMENTAL_VIEW)) -> dict:
    return fundamentals.profile(symbol)


@router.get("/data/fundamentals/events")
def fundamentals_events(kind: str = Query("lockup", pattern="^(lockup|survey|holder_change)$"),
                        days: int = Query(60, le=180), keyword: str = Query(""),
                        limit: int = Query(80, le=300),
                        user: dict = Depends(FUNDAMENTAL_VIEW)) -> dict:
    return fundamentals.events(kind, days, keyword, limit)


@router.get("/finance/statements")
def finance_statements(symbol: str = Query("600519"),
                       user: dict = Depends(STATEMENT_VIEW)) -> dict:
    return fundamentals.statements(symbol)


@router.get("/finance/indicators")
def finance_indicators(symbol: str = Query("600519"), days: int = Query(250, le=500),
                       user: dict = Depends(INDICATOR_VIEW)) -> dict:
    return fundamentals.technical(symbol, days)


@router.get("/research/search")
def research_search(keyword: str = Query(""), limit: int = Query(15, le=30),
                    user: dict = Depends(security.current_user)) -> dict:
    """财务/指数类页面共用的股票搜索，避免每个页面各打一次接口"""
    if not keyword.strip():
        return {"keyword": keyword, "rows": []}
    try:
        return {"keyword": keyword.strip(), "rows": market.search_stocks(keyword.strip(), limit)}
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "PROVIDER_ERROR", "message": exc.message}) from exc


@router.get("/academy/basics")
def academy_basics(user: dict = Depends(security.require_perm("menu:academy:basics"))) -> dict:
    return academy.basics()


@router.get("/academy/books")
def academy_books(user: dict = Depends(security.require_perm("menu:academy:books"))) -> dict:
    return academy.books()
