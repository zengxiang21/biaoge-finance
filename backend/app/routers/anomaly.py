"""异常监控 /anomaly/*：实时异动事件 + 自定义规则（拆解文档 3.12）"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, security
from ..services import anomaly

router = APIRouter(tags=["anomaly"])
VIEW = security.require_perm("anomaly:view")


@router.get("/anomaly/events")
def events(event_type: str = Query(""), symbol: str = Query(""), date: str = Query(""),
           limit: int = Query(200, le=500), user: dict = Depends(VIEW)) -> dict:
    rows = anomaly.events(event_type, symbol, date, limit)
    return {"rows": rows, "total": len(rows),
            "meta": {"types": [{"key": k, **v} for k, v in anomaly.ANOMALY_TYPES.items()],
                    "scopes": [{"key": k, "label": v} for k, v in anomaly.SCOPES.items()]}}


@router.get("/anomaly/summary")
def summary(hours: int = Query(24, le=168), user: dict = Depends(VIEW)) -> dict:
    return anomaly.summary(hours)


@router.post("/anomaly/scan")
def scan(mode: str = Query("live", pattern="^(live|close)$"),
         user: dict = Depends(VIEW)) -> dict:
    if mode == "close":
        out = anomaly.scan_close_basis(user["id"])
        db.audit(user["id"], "anomaly:scan:close", str(out.get("new_events")))
        return out
    out = anomaly.scan("manual", user["id"])
    db.audit(user["id"], "anomaly:scan:live", str(out.get("new_events")))
    return out


@router.get("/anomaly/rules")
def rules(user: dict = Depends(VIEW)) -> dict:
    return {"rows": anomaly.list_rules(),
            "meta": {"types": [{"key": k, **v} for k, v in anomaly.ANOMALY_TYPES.items()],
                    "scopes": [{"key": k, "label": v} for k, v in anomaly.SCOPES.items()]}}


@router.post("/anomaly/rules")
def create_rule(body: dict, user: dict = Depends(VIEW)) -> dict:
    try:
        row = anomaly.create_rule(body or {}, user["id"])
    except ValueError as exc:
        raise HTTPException(400, detail={"code": "BAD_RULE", "message": str(exc)}) from exc
    db.audit(user["id"], "anomaly:rule:create", row["event_type"])
    return {"row": row}


@router.patch("/anomaly/rules/{rule_id}")
def update_rule(rule_id: int, body: dict, user: dict = Depends(VIEW)) -> dict:
    row = anomaly.update_rule(rule_id, body or {})
    if not row:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "规则不存在"})
    db.audit(user["id"], "anomaly:rule:update", str(rule_id))
    return {"row": row}


@router.delete("/anomaly/rules/{rule_id}")
def delete_rule(rule_id: int, user: dict = Depends(VIEW)) -> dict:
    row = db.query_one("SELECT * FROM anomaly_rule WHERE id=?", (rule_id,))
    if not row:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "规则不存在"})
    if row["user_id"] is None and user["role"] != "admin":
        raise HTTPException(403, detail={"code": "SYSTEM_RULE",
                                         "message": "内置规则不能删除，可以新建自己的规则或先停用"})
    anomaly.delete_rule(rule_id)
    db.audit(user["id"], "anomaly:rule:delete", str(rule_id))
    return {"ok": True}
