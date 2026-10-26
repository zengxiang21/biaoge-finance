"""模拟交易 /simulation/*（拆解文档 3.14）"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, security
from ..services import simulation

router = APIRouter(tags=["simulation"])
VIEW = security.require_perm("simulation:view")
TRADE = security.require_perm("simulation:trade")


@router.get("/simulation/accounts")
def accounts(user: dict = Depends(VIEW)) -> dict:
    rows = simulation.accounts(user["id"])
    return {"rows": rows, "meta": {"statusLabels": simulation.STATUS_LABEL,
                                   "fee": {"rate": simulation.FEE_RATE,
                                           "min": simulation.FEE_MIN,
                                           "stamp": simulation.STAMP_RATE}}}


@router.post("/simulation/accounts")
def create_account(body: dict, user: dict = Depends(TRADE)) -> dict:
    try:
        row = simulation.create_account(user["id"], body or {})
    except ValueError as exc:
        raise HTTPException(400, detail={"code": "BAD_ACCOUNT", "message": str(exc)}) from exc
    db.audit(user["id"], "sim:account:create", row["name"])
    return {"row": row}


@router.delete("/simulation/accounts/{account_id}")
def delete_account(account_id: int, user: dict = Depends(TRADE)) -> dict:
    if not simulation.delete_account(user["id"], account_id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "账户不存在"})
    db.audit(user["id"], "sim:account:delete", str(account_id))
    return {"ok": True}


@router.get("/simulation/orders")
def orders(accountId: int | None = Query(None), status: str = Query(""),
           limit: int = Query(300, le=1000), user: dict = Depends(VIEW)) -> dict:
    out = simulation.orders(user["id"], accountId, status, limit)
    out["statusLabels"] = simulation.STATUS_LABEL
    return out


@router.post("/simulation/orders")
def place_order(body: dict, user: dict = Depends(TRADE)) -> dict:
    try:
        row = simulation.place_order(user["id"], body or {})
    except ValueError as exc:
        raise HTTPException(400, detail={"code": "BAD_ORDER", "message": str(exc)}) from exc
    db.audit(user["id"], "sim:order:place", f"{row['side']} {row['symbol']} {row['status']}")
    return {"row": row}


@router.post("/simulation/orders/{order_id}/cancel")
def cancel_order(order_id: int, user: dict = Depends(TRADE)) -> dict:
    try:
        row = simulation.cancel_order(user["id"], order_id)
    except ValueError as exc:
        raise HTTPException(400, detail={"code": "BAD_CANCEL", "message": str(exc)}) from exc
    db.audit(user["id"], "sim:order:cancel", str(order_id))
    return {"row": row}


@router.get("/simulation/positions")
def positions(accountId: int | None = Query(None), user: dict = Depends(VIEW)) -> dict:
    return simulation.positions(user["id"], accountId)


@router.get("/simulation/summary")
def summary(accountId: int | None = Query(None), user: dict = Depends(VIEW)) -> dict:
    return simulation.summary(user["id"], accountId)
