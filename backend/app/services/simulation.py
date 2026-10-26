"""模拟交易 /simulation/*：虚拟资金按实时价撮合，支持限价挂单与撤单（拆解文档 3.14）"""
from __future__ import annotations

from typing import Any

from .. import db
from ..providers import registry
from ..providers.base import ProviderError, norm_symbol

FEE_RATE = 0.0003      # 万三佣金
FEE_MIN = 5.0          # 单笔最低 5 元
STAMP_RATE = 0.001     # 卖出印花税


def _fee(amount: float, side: str) -> float:
    return round(max(FEE_MIN, amount * FEE_RATE) + (amount * STAMP_RATE if side == "sell" else 0), 2)


def _quote(symbol: str) -> dict | None:
    try:
        rows = registry.realtime([symbol])
    except ProviderError:
        return None
    if rows:
        return rows[0]
    r = db.query_one("SELECT symbol,name,price,change_percent FROM snapshot_stocks WHERE symbol=?",
                     (symbol,))
    return dict(r) if r else None


# ---------------------------------------------------------------- 账户
def accounts(user_id: int) -> list[dict]:
    out = []
    for a in db.query("SELECT * FROM sim_account WHERE user_id=? ORDER BY id", (user_id,)):
        m = _assets(a["id"], user_id)
        out.append({**dict(a), **m})
    return out


def create_account(user_id: int, body: dict) -> dict:
    name = str(body.get("name") or "").strip() or "模拟账户"
    capital = float(body.get("initialCapital") or 1_000_000)
    if capital <= 0:
        raise ValueError("初始资金要大于 0")
    aid = db.execute("INSERT INTO sim_account(user_id,name,cash,initial_capital,status,created_at) "
                     "VALUES(?,?,?,?,?,?)", (user_id, name[:40], capital, capital, "active", db.now()))
    return dict(db.query_one("SELECT * FROM sim_account WHERE id=?", (aid,)))


def delete_account(user_id: int, account_id: int) -> bool:
    if not db.execute("DELETE FROM sim_account WHERE id=? AND user_id=?", (account_id, user_id)):
        return False
    db.executemany("DELETE FROM sim_order WHERE account_id=?", [(account_id,)])
    return True


def _default_account(user_id: int, account_id: Any = None) -> dict | None:
    if account_id:
        return db.query_one("SELECT * FROM sim_account WHERE id=? AND user_id=?",
                            (int(account_id), user_id))
    return db.query_one("SELECT * FROM sim_account WHERE user_id=? ORDER BY id LIMIT 1", (user_id,))


# ---------------------------------------------------------------- 持仓与资产
def positions(user_id: int, account_id: Any = None) -> dict:
    acc = _default_account(user_id, account_id)
    if not acc:
        return {"rows": [], "accountId": None, "note": "还没有模拟账户"}
    rows, _ = _book(acc["id"])
    return {"rows": rows, "accountId": acc["id"], "accountName": acc["name"],
            "cash": round(acc["cash"], 2), "initialCapital": acc["initial_capital"]}


def _book(account_id: int) -> tuple[list[dict], float]:
    """只按已成交订单算持仓；realized 为已实现盈亏合计"""
    realized = 0.0
    book: dict[str, dict] = {}
    for o in db.query("SELECT * FROM sim_order WHERE account_id=? AND status='filled' "
                      "ORDER BY id", (account_id,)):
        qty = float(o["filled_quantity"] or o["quantity"])
        price = float(o["filled_price"] or o["price"])
        fee = float(o["fee"] or 0)
        p = book.setdefault(o["symbol"], {"symbol": o["symbol"], "name": o["name"],
                                          "qty": 0.0, "cost": 0.0})
        p["name"] = o["name"] or p["name"]
        if o["side"] == "buy":
            p["qty"] += qty
            p["cost"] += qty * price + fee
        else:
            avg = p["cost"] / p["qty"] if p["qty"] else price
            sold = min(qty, p["qty"])
            p["qty"] -= qty
            p["cost"] -= avg * sold
            realized += (price - avg) * sold - fee
    out = []
    for s, p in book.items():
        if p["qty"] <= 0:
            continue
        q = _quote(s) or {}
        price = float(q.get("price") or 0)
        value = price * p["qty"]
        out.append({"symbol": s, "name": q.get("name") or p["name"] or s, "quantity": p["qty"],
                    "costPrice": round(p["cost"] / p["qty"], 3), "costValue": round(p["cost"], 2),
                    "price": price, "changePercent": q.get("change_percent"),
                    "marketValue": round(value, 2),
                    "unrealized": round(value - p["cost"], 2),
                    "profitRate": round((value - p["cost"]) / p["cost"] * 100, 2) if p["cost"] else None})
    out.sort(key=lambda r: r["marketValue"], reverse=True)
    total = sum(r["marketValue"] for r in out) or 1
    for r in out:
        r["weight"] = round(r["marketValue"] / total * 100, 2)
    return out, round(realized, 2)


def _assets(account_id: int, user_id: int) -> dict:
    acc = db.query_one("SELECT * FROM sim_account WHERE id=?", (account_id,))
    rows, realized = _book(account_id)
    value = sum(r["marketValue"] for r in rows)
    assets = float(acc["cash"]) + value
    initial = float(acc["initial_capital"] or 0)
    sells = db.query("SELECT * FROM sim_order WHERE account_id=? AND side='sell' AND status='filled'",
                     (account_id,))
    wins = sum(1 for s in sells if _sell_profit(account_id, s) is True)
    return {"cash": round(float(acc["cash"]), 2), "marketValue": round(value, 2),
            "totalAssets": round(assets, 2), "initialCapital": initial,
            "profit": round(assets - initial, 2),
            "profitRate": round((assets - initial) / initial * 100, 2) if initial else None,
            "realized": realized, "positionCount": len(rows),
            "orderCount": db.query_one("SELECT COUNT(*) n FROM sim_order WHERE account_id=?",
                                       (account_id,))["n"],
            "sellCount": len(sells), "winCount": wins,
            "winRate": round(wins / len(sells) * 100, 1) if sells else None}


def _sell_profit(account_id: int, sell: dict) -> bool | None:
    """卖出是否赚钱：与该股当前剩余持仓成本比，纯卖出的按最早买入成本估"""
    r = db.query_one("SELECT SUM(CASE WHEN side='buy' THEN price*quantity ELSE 0 END) b,"
                     "SUM(CASE WHEN side='buy' THEN quantity ELSE 0 END) q FROM sim_order "
                     "WHERE account_id=? AND symbol=? AND status='filled'",
                     (account_id, sell["symbol"]))
    if not r or not r["q"]:
        return None
    avg = r["b"] / r["q"]
    price = float(sell["filled_price"] or sell["price"] or 0)
    return price * float(sell["quantity"]) - float(sell["fee"] or 0) > avg * float(sell["quantity"])


def summary(user_id: int, account_id: Any = None) -> dict:
    acc = _default_account(user_id, account_id)
    if not acc:
        return {"accountId": None, "rows": [], "note": "还没有模拟账户，先建一个再下单"}
    rows, _ = _book(acc["id"])
    return {"accountId": acc["id"], "accountName": acc["name"], "rows": rows, **_assets(acc["id"], user_id)}


# ---------------------------------------------------------------- 订单
def orders(user_id: int, account_id: Any = None, status: str = "", limit: int = 300) -> dict:
    acc = _default_account(user_id, account_id)
    if not acc:
        return {"rows": [], "total": 0, "note": "还没有模拟账户"}
    match_pending(acc)
    acc = db.query_one("SELECT * FROM sim_account WHERE id=?", (acc["id"],))
    sql = "SELECT * FROM sim_order WHERE account_id=?"
    args: list[Any] = [acc["id"]]
    if status:
        sql += " AND status=?"
        args.append(status)
    rows = [dict(r) for r in db.query(sql + " ORDER BY id DESC LIMIT ?", tuple(args + [limit]))]
    return {"rows": rows, "total": len(rows), "accountId": acc["id"],
            "accountName": acc["name"], "cash": round(float(acc["cash"]), 2)}


STATUS_LABEL = {"pending": "待成交", "filled": "已成交", "cancelled": "已撤单", "rejected": "废单"}


def place_order(user_id: int, body: dict) -> dict:
    acc = _default_account(user_id, body.get("accountId"))
    if not acc:
        raise ValueError("还没有模拟账户")
    symbol = norm_symbol(str(body.get("symbol") or ""))["symbol"]
    side = str(body.get("side") or "").lower()
    qty = float(body.get("quantity") or 0)
    limit = float(body.get("price") or 0)
    if side not in ("buy", "sell"):
        raise ValueError("方向只能是买入或卖出")
    if qty <= 0 or qty != int(qty):
        raise ValueError("数量必须是正整数")
    if int(qty) % 100:
        raise ValueError("A 股一手 100 股，数量得是 100 的整数倍")
    q = _quote(symbol)
    if not q or not q.get("price"):
        raise ValueError("取不到该股实时价格，先确认代码或稍后重试")
    name = str(q.get("name") or symbol)[:32]
    market_price = float(q["price"])
    if limit and limit < market_price and side == "buy":
        status, fill_price = "pending", limit
    elif limit and limit > market_price and side == "sell":
        status, fill_price = "pending", limit
    else:
        status, fill_price = "filled", market_price
    amount = round(fill_price * qty, 2)
    fee = _fee(amount, side)
    if status == "filled":
        reason = _apply_fill(acc, side, symbol, qty, amount, fee)
        if reason:
            oid = db.execute("INSERT INTO sim_order(account_id,user_id,symbol,name,side,price,"
                             "quantity,status,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (acc["id"], user_id, symbol, name, side, market_price, qty,
                              "rejected", reason, db.now()))
            return {**dict(db.query_one("SELECT * FROM sim_order WHERE id=?", (oid,))),
                    "statusLabel": STATUS_LABEL["rejected"]}
    oid = db.execute("INSERT INTO sim_order(account_id,user_id,symbol,name,side,price,quantity,"
                     "status,filled_price,filled_quantity,amount,fee,reason,created_at,filled_at) "
                     "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (acc["id"], user_id, symbol, name, side, limit or market_price, qty, status,
                      fill_price if status == "filled" else None,
                      qty if status == "filled" else None,
                      amount if status == "filled" else None,
                      fee if status == "filled" else None,
                      "" if status == "filled" else f"限价 {fill_price} 未达现价 {market_price}",
                      db.now(), db.now() if status == "filled" else None))
    if status == "filled":
        _commit(acc, side, amount, fee)
    return {**dict(db.query_one("SELECT * FROM sim_order WHERE id=?", (oid,))),
            "statusLabel": STATUS_LABEL[status]}


def _apply_fill(acc: dict, side: str, symbol: str, qty: float, amount: float,
                fee: float) -> str:
    """返回拒绝原因，空串表示可以成交"""
    if side == "buy" and float(acc["cash"]) < amount + fee:
        return f"可用资金 {round(float(acc['cash']), 2)} 元，不足以支付 {round(amount + fee, 2)} 元"
    if side == "sell":
        held = 0.0
        for o in db.query("SELECT side,quantity,filled_quantity FROM sim_order WHERE account_id=? "
                          "AND symbol=? AND status='filled'", (acc["id"], symbol)):
            q = float(o["filled_quantity"] or o["quantity"])
            held += q if o["side"] == "buy" else -q
        if held < qty:
            return f"可卖 {held} 股，不够卖 {qty} 股"
    return ""


def _commit(acc: dict, side: str, amount: float, fee: float) -> None:
    delta = -(amount + fee) if side == "buy" else amount - fee
    db.execute("UPDATE sim_account SET cash=? WHERE id=?",
               (round(float(acc["cash"]) + delta, 2), acc["id"]))


def match_pending(acc: dict) -> int:
    """现价触及限价就成交，模拟撮合的简化版"""
    filled = 0
    for o in db.query("SELECT * FROM sim_order WHERE account_id=? AND status='pending'", (acc["id"],)):
        fresh = db.query_one("SELECT * FROM sim_account WHERE id=?", (acc["id"],))
        q = _quote(o["symbol"])
        if not q or not q.get("price"):
            continue
        price = float(q["price"])
        limit = float(o["price"])
        if (o["side"] == "buy" and price > limit) or (o["side"] == "sell" and price < limit):
            continue
        qty = float(o["quantity"])
        amount = round(price * qty, 2)
        fee = _fee(amount, o["side"])
        reason = _apply_fill(fresh, o["side"], o["symbol"], qty, amount, fee)
        if reason:
            db.execute("UPDATE sim_order SET status='rejected',reason=? WHERE id=?",
                       (reason, o["id"]))
            continue
        db.execute("UPDATE sim_order SET status='filled',filled_price=?,filled_quantity=?,amount=?,"
                   "fee=?,reason='',filled_at=? WHERE id=?",
                   (price, qty, amount, fee, db.now(), o["id"]))
        _commit(fresh, o["side"], amount, fee)
        filled += 1
    return filled


def cancel_order(user_id: int, order_id: int) -> dict:
    o = db.query_one("SELECT * FROM sim_order WHERE id=? AND user_id=?", (order_id, user_id))
    if not o:
        raise ValueError("订单不存在")
    if o["status"] != "pending":
        raise ValueError("只有待成交的单能撤")
    db.execute("UPDATE sim_order SET status='cancelled',reason='用户撤单' WHERE id=?", (order_id,))
    return dict(db.query_one("SELECT * FROM sim_order WHERE id=?", (order_id,)))
