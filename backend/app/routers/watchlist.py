"""自选股：/watchlists/*"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .. import db, security
from ..services import watchlist

router = APIRouter(prefix="/watchlists", tags=["watchlist"])


class ItemBody(BaseModel):
    keyword: str
    note: str | None = None


@router.get("/default")
def default_list(user: dict = Depends(security.require_perm("menu:watchlist"))) -> dict:
    return watchlist.default_list(user["id"])


@router.get("/default/quotes")
def default_quotes(refresh: bool = Query(False),
                   user: dict = Depends(security.require_perm("menu:watchlist"))) -> dict:
    return watchlist.quotes(user["id"])


@router.post("/items", status_code=201)
def add_item(body: ItemBody, user: dict = Depends(security.require_perm("watchlist:item_create"))) -> dict:
    try:
        row = watchlist.add(user["id"], body.keyword.strip(), body.note or "")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "BAD_SYMBOL", "message": str(exc)})
    db.audit(user["id"], "watchlist:add", body.keyword)
    return {"ok": True, **row}


@router.delete("/items/{item_id}")
def remove_item(item_id: int, user: dict = Depends(security.require_perm("watchlist:item_delete"))) -> dict:
    if not watchlist.remove(user["id"], item_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "NOT_FOUND", "message": "自选里没有这条记录"})
    db.audit(user["id"], "watchlist:delete", str(item_id))
    return {"ok": True}
