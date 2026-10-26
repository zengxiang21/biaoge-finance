"""系统：数据源矩阵 / 健康探测 / 菜单权限 / 审计 / 用户"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db, scheduler, security
from ..permissions import (ALL_PERMISSIONS, MENU_PERMISSIONS, NAV_GROUPS,
                          OPERATION_PERMISSIONS, ROLE_GRANTS, ROLE_LABELS, ROUTE_PERMISSIONS)
from ..providers import registry
from ..providers.base import ProviderError

router = APIRouter(tags=["system"])


@router.get("/system/data-sources")
def data_sources(user: dict = Depends(security.current_user)) -> dict:
    return {"matrix": registry.matrix(), "summary": registry.summary(),
            "config": db.get_setting("data_sources", {}),
            "note": "本机实测：东财 push2 实时列表、push2his 的 K线/分时都被中间设备掐断（HTTP 502），"
                    "实时快照与日线主源为新浪，分时用腾讯兜底，东财只保留涨跌停池"}


@router.put("/system/data-sources")
def update_data_sources(body: dict,
                        user: dict = Depends(security.require_perm("system:data-source:update"))) -> dict:
    cfg = db.get_setting("data_sources", {}) or {}
    for provider, patch in (body or {}).items():
        if provider not in registry.PROVIDER_LABELS:
            continue
        cfg.setdefault(provider, {})
        if isinstance(patch, dict):
            cfg[provider].update({k: v for k, v in patch.items() if k in ("enabled", "priority")})
    db.set_setting("data_sources", cfg)
    db.audit(user["id"], "system:data-source:update", str(cfg))
    return {"config": cfg, "matrix": registry.matrix()}


@router.post("/system/data-sources/probe")
def probe_sources(capability: str | None = Query(None),
                  user: dict = Depends(security.require_perm("menu:settings:data-source"))) -> dict:
    """主动打一遍各能力主源，写入健康表"""
    probes = {
        "index": registry.index_quotes,
        "spot": lambda: sina_spot(),
        "kline_daily": lambda: registry.kline_daily("sh000001", 30),
        "minute_trend": lambda: registry.minute_trend("sh000001"),
        "board_industry": lambda: registry.boards("industry"),
        "limit_up_pool": lambda: registry.limit_pools(registry.trade_date_hint()),
    }
    results = []
    targets = [capability] if capability else list(probes)
    for cap in targets:
        try:
            value = probes[cap]()
            n = len(value) if isinstance(value, (list, dict)) else 1
            results.append({"capability": cap, "ok": True, "count": n})
        except ProviderError as exc:
            results.append({"capability": cap, "ok": False, "error": exc.message[:300]})
        except Exception as exc:  # noqa: BLE001
            results.append({"capability": cap, "ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]})
    db.audit(user["id"], "system:data-sources:probe",
             "; ".join(f"{r['capability']}={'ok' if r['ok'] else 'fail'}" for r in results))
    return {"results": results, "matrix": registry.matrix(), "summary": registry.summary()}


def sina_spot() -> list:
    from ..providers import sina
    return sina.spot_ranking("changepercent", True, 10)


@router.get("/permissions/menus")
def menus(user: dict = Depends(security.current_user)) -> dict:
    perms = set(security.permissions_of(user["id"], user["role"]))
    groups = []
    for g in NAV_GROUPS:
        items = [dict(i, granted=(i["perm"] in perms)) for i in g["items"] if i["perm"] in perms]
        if items:
            groups.append({"key": g["key"], "label": g["label"], "items": items})
    return {"groups": groups, "routePermissions": ROUTE_PERMISSIONS}


@router.get("/system/permissions")
def permissions(user: dict = Depends(security.require_perm("menu:system:permission"))) -> dict:
    """角色 × 权限矩阵，外加每个角色的在册账号数"""
    counts = {r["role"]: r["n"] for r in db.query("SELECT role, COUNT(*) n FROM users GROUP BY role")}
    granted = {}
    for role, codes in ROLE_GRANTS.items():
        for code in codes:
            granted.setdefault(code, []).append(role)
    return {"all": ALL_PERMISSIONS, "menus": MENU_PERMISSIONS, "operations": OPERATION_PERMISSIONS,
            "roles": {r: sorted(c) for r, c in ROLE_GRANTS.items()},
            "roleLabels": ROLE_LABELS, "roleCounts": counts,
            "grantedBy": granted, "routePermissions": ROUTE_PERMISSIONS,
            "stored": [dict(x) for x in db.query("SELECT role, code FROM role_permissions ORDER BY role")]}


@router.get("/system/audit-logs")
def audit_logs(limit: int = Query(50, le=200), offset: int = Query(0, ge=0),
               user_id: int | None = Query(None), action: str = "", keyword: str = "",
               user: dict = Depends(security.require_perm("menu:system:audit"))) -> dict:
    where, params = [], []
    if user_id:
        where.append("a.user_id=?")
        params.append(user_id)
    if action:
        where.append("a.action=?")
        params.append(action)
    if keyword:
        where.append("(a.action LIKE ? OR a.target LIKE ? OR u.username LIKE ?)")
        params += [f"%{keyword}%"] * 3
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    total = db.query_one(f"SELECT COUNT(*) n FROM audit_logs a {clause}", tuple(params))
    rows = db.query(
        f"SELECT a.id,a.user_id,a.action,a.target,a.created_at,u.username,u.display_name "
        f"FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id {clause} "
        f"ORDER BY a.id DESC LIMIT ? OFFSET ?", tuple(params) + (limit, offset))
    actions = [{"action": r["action"], "count": r["n"]} for r in db.query(
        "SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 40")]
    return {"rows": [dict(r) for r in rows], "total": int(total["n"] if total else 0),
            "limit": limit, "offset": offset, "actions": actions,
            "users": [{"id": r["id"], "name": r["display_name"] or r["username"]}
                      for r in db.query("SELECT id,username,display_name FROM users ORDER BY id")]}


@router.get("/system/overview")
def system_overview(user: dict = Depends(security.require_perm("menu:workbench:monitor"))) -> dict:
    return {
        "users": [dict(r) for r in db.query(
            "SELECT id,username,display_name,role,status,created_at,last_login_at FROM users ORDER BY id")],
        "scheduler": scheduler.status(),
        "dataSources": registry.summary(),
        "market": db.query_one("SELECT trade_date,total,up,down,limit_up,score,built_at "
                               "FROM market_daily ORDER BY trade_date DESC LIMIT 1"),
        "ai": db.query_one("SELECT COUNT(*) n, MAX(created_at) last FROM ai_calls"),
    }
