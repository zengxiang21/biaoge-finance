"""自选股服务"""
from __future__ import annotations

from .. import db
from ..providers import registry, tencent
from ..providers.base import ProviderError, norm_symbol
from . import market


def list_items(user_id: int) -> list[dict]:
    rows = db.query("SELECT id,symbol,name,market,note,created_at FROM watchlist_items "
                    "WHERE user_id=? ORDER BY created_at DESC", (user_id,))
    return [dict(r) for r in rows]


def default_list(user_id: int) -> dict:
    items = list_items(user_id)
    return {"id": 1, "name": "默认自选", "count": len(items), "items": items}


def add(user_id: int, keyword: str, note: str = "") -> dict:
    n = norm_symbol(keyword)
    exists = db.query_one("SELECT id FROM watchlist_items WHERE user_id=? AND symbol=?",
                          (user_id, n["symbol"]))
    if exists:
        return {"id": exists["id"], "symbol": n["symbol"], "duplicated": True}

    name = keyword
    try:
        q = tencent.quote_one(n["symbol"])
        if q:
            name = q["name"]
    except ProviderError:
        pass
    if name == keyword:
        snap = market.snapshot_row(n["symbol"])
        name = snap["name"] if snap else keyword
    db.execute("INSERT OR IGNORE INTO watchlist_items(user_id,symbol,name,market,note,created_at) "
               "VALUES(?,?,?,?,?,?)", (user_id, n["symbol"], name, n["prefix"], note, db.now()))
    row = db.query_one("SELECT id,symbol,name FROM watchlist_items WHERE user_id=? AND symbol=?",
                       (user_id, n["symbol"]))
    return dict(row) if row else {"symbol": n["symbol"], "name": name}


def remove(user_id: int, item_id: int) -> bool:
    cur = db.execute("DELETE FROM watchlist_items WHERE id=? AND user_id=?", (item_id, user_id))
    return bool(cur)


def quotes(user_id: int) -> dict:
    items = list_items(user_id)
    if not items:
        return {"items": [], "asOf": db.now(), "source": "none"}
    symbols = [i["symbol"] for i in items]
    merged: dict[str, dict] = {i["symbol"]: {**i} for i in items}
    errors = []
    try:
        for q in registry.realtime(symbols):
            base = merged.get(q["symbol"])
            if base is not None:
                base.update({k: q.get(k) for k in
                             ("price", "change_price", "change_percent", "open", "high", "low",
                              "prev_close", "volume", "amount", "turnover_ratio", "name")})
    except ProviderError as exc:
        errors.append(exc.message)
        # 实时全挂时降级到最近一次收盘快照
        for sym, base in merged.items():
            snap = market.snapshot_row(sym)
            if snap:
                base.update({k: snap.get(k) for k in
                             ("price", "change_percent", "open", "high", "low", "amount",
                              "turnover_ratio")})
                base["stale"] = True
    order = {s: idx for idx, s in enumerate(symbols)}
    rows = sorted(merged.values(), key=lambda x: order.get(x["symbol"], 999))
    return {"items": rows, "asOf": db.now(), "source": "realtime" if not errors else "degraded",
            "errors": errors}
