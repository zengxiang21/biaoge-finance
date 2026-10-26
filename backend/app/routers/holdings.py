"""持仓管理 /holdings/*（拆解文档 3.13）"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, security
from ..services import holdings

router = APIRouter(tags=["holdings"])
VIEW = security.require_perm("holdings:view")
MANAGE = security.require_perm("holdings:manage")


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(400, detail={"code": "BAD_HOLDING", "message": str(exc)})


@router.get("/holdings/accounts")
def accounts(user: dict = Depends(VIEW)) -> dict:
    rows = holdings.accounts(user["id"])
    return {"rows": rows, "meta": {"ruleTypes": [{"key": k, **v} for k, v in
                                                 holdings.RULE_TYPES.items()]}}


@router.post("/holdings/accounts")
def create_account(body: dict, user: dict = Depends(MANAGE)) -> dict:
    try:
        row = holdings.create_account(user["id"], body or {})
    except ValueError as exc:
        raise _bad(exc) from exc
    db.audit(user["id"], "holding:account:create", row["name"])
    return {"row": row}


@router.delete("/holdings/accounts/{account_id}")
def delete_account(account_id: int, user: dict = Depends(MANAGE)) -> dict:
    if not holdings.delete_account(user["id"], account_id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "账户不存在"})
    db.audit(user["id"], "holding:account:delete", str(account_id))
    return {"ok": True}


@router.get("/holdings/trades")
def trades(accountId: int | None = Query(None), symbol: str = Query(""),
           user: dict = Depends(VIEW)) -> dict:
    return {"rows": holdings.trades(user["id"], accountId, symbol)}


@router.post("/holdings/trades")
def add_trade(body: dict, user: dict = Depends(MANAGE)) -> dict:
    try:
        row = holdings.add_trade(user["id"], body or {})
    except ValueError as exc:
        raise _bad(exc) from exc
    db.audit(user["id"], "holding:trade:add", f"{row['side']} {row['symbol']}")
    return {"row": row}


@router.delete("/holdings/trades/{trade_id}")
def delete_trade(trade_id: int, user: dict = Depends(MANAGE)) -> dict:
    if not holdings.delete_trade(user["id"], trade_id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "交易记录不存在"})
    db.audit(user["id"], "holding:trade:delete", str(trade_id))
    return {"ok": True}


@router.get("/holdings/positions")
def positions(accountId: int | None = Query(None), user: dict = Depends(VIEW)) -> dict:
    return holdings.positions(user["id"], accountId)


@router.get("/holdings/summary")
def summary(accountId: int | None = Query(None), user: dict = Depends(VIEW)) -> dict:
    return holdings.summary(user["id"], accountId)


@router.get("/holdings/rules")
def rules(user: dict = Depends(VIEW)) -> dict:
    return {"rows": holdings.list_rules(user["id"]),
            "meta": {"ruleTypes": [{"key": k, **v} for k, v in holdings.RULE_TYPES.items()],
                     "accounts": [{"id": a["id"], "name": a["name"]}
                                  for a in db.query("SELECT id,name FROM holdings_account WHERE user_id=?",
                                                    (user["id"],))]}}


@router.post("/holdings/rules")
def create_rule(body: dict, user: dict = Depends(MANAGE)) -> dict:
    try:
        row = holdings.create_rule(user["id"], body or {})
    except ValueError as exc:
        raise _bad(exc) from exc
    db.audit(user["id"], "holding:rule:create", row["rule_type"])
    return {"row": row}


@router.patch("/holdings/rules/{rule_id}")
def update_rule(rule_id: int, body: dict, user: dict = Depends(MANAGE)) -> dict:
    row = holdings.update_rule(user["id"], rule_id, body or {})
    if not row:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "规则不存在"})
    db.audit(user["id"], "holding:rule:update", str(rule_id))
    return {"row": row}


@router.delete("/holdings/rules/{rule_id}")
def delete_rule(rule_id: int, user: dict = Depends(MANAGE)) -> dict:
    if not holdings.delete_rule(user["id"], rule_id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "规则不存在"})
    db.audit(user["id"], "holding:rule:delete", str(rule_id))
    return {"ok": True}


@router.post("/holdings/rules/{rule_id}/test")
def test_rule(rule_id: int, user: dict = Depends(VIEW)) -> dict:
    return holdings.test_rule(user["id"], rule_id)


@router.post("/holdings/scan")
def scan(accountId: int | None = Query(None), user: dict = Depends(VIEW)) -> dict:
    out = holdings.scan(user["id"], accountId)
    db.audit(user["id"], "holding:scan", f"{out['hits']}/{out['checked']}")
    return out


@router.get("/holdings/triggers")
def triggers(limit: int = Query(200, le=500), user: dict = Depends(VIEW)) -> dict:
    rows = holdings.triggers(user["id"], limit)
    return {"rows": rows, "total": len(rows),
            "suppressed": sum(1 for r in rows if r["suppressed"])}


@router.get("/holdings/notifications")
def notifications(limit: int = Query(200, le=500), user: dict = Depends(VIEW)) -> dict:
    rows = holdings.notifications(user["id"], limit)
    return {"rows": rows, "total": len(rows), "unread": holdings.unread(user["id"])}


@router.patch("/holdings/notifications/read")
def mark_read(body: dict, user: dict = Depends(VIEW)) -> dict:
    return holdings.mark_read(user["id"], body.get("id"))
