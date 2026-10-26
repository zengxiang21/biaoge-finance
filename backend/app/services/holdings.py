"""持仓管理 /holdings/*：账户、交易流水、持仓明细与 4 类组合风控规则（拆解文档 3.13）"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from .. import db
from ..providers import registry
from ..providers.base import ProviderError
from . import notify

RULE_TYPES = {
    "portfolio_stop_loss": {
        "label": "组合止损", "tone": "rose",
        "desc": "整个组合的浮亏比例超过阈值就提醒减仓",
        "params": [{"key": "threshold", "label": "浮亏阈值(%)", "default": 8.0}]},
    "portfolio_concentration": {
        "label": "组合集中度", "tone": "amber",
        "desc": "单只票占组合市值的比例超过阈值",
        "params": [{"key": "threshold", "label": "单票占比上限(%)", "default": 30.0}]},
    "portfolio_drawdown": {
        "label": "组合回撤", "tone": "rose",
        "desc": "组合市值从历史最高点回撤超过阈值",
        "params": [{"key": "threshold", "label": "回撤阈值(%)", "default": 15.0}]},
    "portfolio_price_stale": {
        "label": "组合价格状态", "tone": "sky",
        "desc": "行情时间太久没更新，此时盈亏不可信",
        "params": [{"key": "threshold", "label": "行情最大时延(分钟)", "default": 30.0}]},
}

_quotes: dict[str, dict] = {}
_quotes_at = ""


def _stamp(v: str | None) -> datetime | None:
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d%H%M%S", "%H:%M:%S"):
        try:
            d = datetime.strptime(s, fmt)
            return d.replace(year=1970, month=1, day=1) if fmt == "%H:%M:%S" else d
        except ValueError:
            continue
    return None


def _quotes_for(symbols: list[str]) -> dict[str, dict]:
    """行情只缓存 30 秒：持仓页、风控扫描、概要会连着问同一批票"""
    global _quotes, _quotes_at
    now = datetime.now()
    if _quotes and _quotes_at and (now - _stamp(_quotes_at)).total_seconds() < 30:
        need = [s for s in symbols if s not in _quotes]
        if not need:
            return _quotes
    else:
        _quotes, need = {}, symbols
    if need:
        try:
            for r in registry.realtime(need):
                _quotes[r["symbol"]] = {"name": r.get("name"), "price": r.get("price"),
                                        "change_percent": r.get("change_percent"),
                                        "date": r.get("date"), "time": r.get("time")}
        except ProviderError:
            pass
        missing = [s for s in need if s not in _quotes]
        if missing:
            for r in db.query("SELECT symbol,name,price,change_percent,ticktime FROM snapshot_stocks "
                              "WHERE trade_date=(SELECT MAX(trade_date) FROM snapshot_stocks) "
                              f"AND symbol IN ({','.join('?' * len(missing))})", tuple(missing)):
                _quotes[r["symbol"]] = {"name": r["name"], "price": r["price"],
                                        "change_percent": r["change_percent"],
                                        "date": None, "time": str(r["ticktime"] or "")}
    _quotes_at = now.strftime("%Y-%m-%d %H:%M:%S")
    return _quotes


# ---------------------------------------------------------------- 账户
def accounts(user_id: int) -> list[dict]:
    rows = db.query("SELECT * FROM holdings_account WHERE user_id=? ORDER BY id", (user_id,))
    out = []
    for a in rows:
        m = _metrics(a["id"], user_id)
        out.append({**dict(a), "positions": m["positionCount"], "marketValue": m["marketValue"],
                    "totalCost": m["totalCost"], "unrealized": m["unrealized"],
                    "realized": m["realized"], "profitRate": m["profitRate"], "cash": m["cash"],
                    "drawdown": m["drawdown"]})
    return out


def create_account(user_id: int, body: dict) -> dict:
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("账户名称不能为空")
    capital = float(body.get("initialCapital") or 0)
    if capital <= 0:
        raise ValueError("投入本金要大于 0，现金是按本金减净买入算的")
    aid = db.execute("INSERT INTO holdings_account(user_id,name,broker,initial_capital,status,created_at) "
                     "VALUES(?,?,?,?,?,?)",
                     (user_id, name, str(body.get("broker") or "")[:40] or None, capital,
                      "active", db.now()))
    return dict(db.query_one("SELECT * FROM holdings_account WHERE id=?", (aid,)))


def delete_account(user_id: int, account_id: int) -> bool:
    if not db.execute("DELETE FROM holdings_account WHERE id=? AND user_id=?", (account_id, user_id)):
        return False
    db.executemany("DELETE FROM holding_trade WHERE account_id=?", [(account_id,)])
    db.executemany("DELETE FROM holding_rule WHERE account_id=?", [(account_id,)])
    db.executemany("DELETE FROM alert_trigger WHERE account_id=?", [(account_id,)])
    db.execute("DELETE FROM settings WHERE key=?", (f"holding_peak:{account_id}",))
    return True


def _account(user_id: int, account_id: int | None) -> dict | None:
    if account_id:
        return db.query_one("SELECT * FROM holdings_account WHERE id=? AND user_id=?",
                            (account_id, user_id))
    return db.query_one("SELECT * FROM holdings_account WHERE user_id=? ORDER BY id LIMIT 1",
                        (user_id,))


# ---------------------------------------------------------------- 交易流水
def trades(user_id: int, account_id: int | None = None, symbol: str = "") -> list[dict]:
    sql = "SELECT * FROM holding_trade WHERE user_id=?"
    args: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id=?"
        args.append(account_id)
    if symbol:
        sql += " AND symbol LIKE ?"
        args.append(f"%{symbol}%")
    return [dict(r) for r in db.query(sql + " ORDER BY trade_date DESC, id DESC LIMIT 500",
                                      tuple(args))]


def add_trade(user_id: int, body: dict) -> dict:
    acc = _account(user_id, body.get("accountId"))
    if not acc:
        raise ValueError("还没有持仓账户，先建一个")
    symbol = registry_norm(body.get("symbol"))
    side = str(body.get("side") or "").lower()
    price = float(body.get("price") or 0)
    qty = float(body.get("quantity") or 0)
    if not symbol:
        raise ValueError("股票代码无法识别")
    if side not in ("buy", "sell"):
        raise ValueError("方向只能是买入或卖出")
    if price <= 0 or qty <= 0:
        raise ValueError("价格和数量都要大于 0")
    if qty != int(qty) or (int(qty) % 100 and symbol.startswith(("sh", "sz"))):
        raise ValueError("A 股按 100 股一手下单，数量得是 100 的整数倍")
    date = str(body.get("tradeDate") or datetime.now().strftime("%Y-%m-%d"))
    name = str(body.get("name") or _name_of(symbol) or symbol)[:32]
    tid = db.execute("INSERT INTO holding_trade(account_id,user_id,symbol,name,side,price,quantity,"
                     "fee,trade_date,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                     (acc["id"], user_id, symbol, name, side, price, int(qty),
                      float(body.get("fee") or 0), date, str(body.get("note") or "")[:120], db.now()))
    return dict(db.query_one("SELECT * FROM holding_trade WHERE id=?", (tid,)))


def delete_trade(user_id: int, trade_id: int) -> bool:
    return bool(db.execute("DELETE FROM holding_trade WHERE id=? AND user_id=?",
                           (trade_id, user_id)))


def registry_norm(symbol: str) -> str:
    from ..providers.base import norm_symbol
    return norm_symbol(str(symbol or ""))["symbol"]


def _name_of(symbol: str) -> str | None:
    r = db.query_one("SELECT name FROM snapshot_stocks WHERE symbol=?", (symbol,))
    return r["name"] if r else None


# ---------------------------------------------------------------- 持仓
def _positions(user_id: int, account_id: int) -> list[dict]:
    """摊薄成本法：卖出按当前均价结转已实现盈亏，余下数量即持仓"""
    rows = db.query("SELECT * FROM holding_trade WHERE account_id=? ORDER BY trade_date, id",
                    (account_id,))
    book: dict[str, dict] = {}
    realized: dict[str, float] = {}
    for t in rows:
        key = t["symbol"]
        p = book.setdefault(key, {"symbol": key, "name": t["name"], "qty": 0.0, "cost": 0.0})
        qty, price, fee = float(t["quantity"]), float(t["price"]), float(t["fee"] or 0)
        if t["side"] == "buy":
            p["qty"] += qty
            p["cost"] += qty * price + fee
        else:
            avg = p["cost"] / p["qty"] if p["qty"] else price
            sold = min(qty, p["qty"])
            p["qty"] -= qty
            p["cost"] -= avg * sold
            realized[key] = realized.get(key, 0.0) + (price - avg) * sold - fee
            p["name"] = t["name"] or p["name"]
    syms = [k for k, v in book.items() if v["qty"] > 0]
    quotes = _quotes_for(syms)
    out = []
    for s in syms:
        p = book[s]
        q = quotes.get(s, {})
        price = q.get("price") or 0
        cost_avg = p["cost"] / p["qty"]
        value = price * p["qty"]
        out.append({
            "symbol": s, "name": q.get("name") or p["name"] or s, "quantity": p["qty"],
            "costPrice": round(cost_avg, 3), "costValue": round(p["cost"], 2),
            "price": price, "changePercent": q.get("change_percent"),
            "marketValue": round(value, 2), "unrealized": round(value - p["cost"], 2),
            "profitRate": round((value - p["cost"]) / p["cost"] * 100, 2) if p["cost"] else None,
            "realized": round(realized.get(s, 0.0), 2),
            "weight": None, "quoteDate": q.get("date"), "quoteTime": q.get("time"),
        })
    out.sort(key=lambda r: r["marketValue"], reverse=True)
    total = sum(r["marketValue"] for r in out) or 1
    for r in out:
        r["weight"] = round(r["marketValue"] / total * 100, 2)
    return out, round(sum(realized.values()), 2)


def positions(user_id: int, account_id: int | None = None) -> dict:
    acc = _account(user_id, account_id)
    if not acc:
        return {"rows": [], "accountId": None, "note": "还没有持仓账户"}
    rows, realized = _positions(user_id, acc["id"])
    return {"rows": rows, "realized": realized, "accountId": acc["id"],
            "accountName": acc["name"], "initialCapital": acc["initial_capital"]}


def _metrics(account_id: int, user_id: int) -> dict:
    rows, realized = _positions(user_id, account_id)
    cost = sum(r["costValue"] for r in rows)
    value = sum(r["marketValue"] for r in rows)
    unrealized = sum(r["unrealized"] for r in rows)
    acc = db.query_one("SELECT initial_capital FROM holdings_account WHERE id=?", (account_id,))
    capital = float(acc["initial_capital"] or 0) if acc else 0.0
    buys = db.query_one("SELECT COALESCE(SUM(price*quantity+fee),0) s FROM holding_trade "
                        "WHERE account_id=? AND side='buy'", (account_id,))
    sells = db.query_one("SELECT COALESCE(SUM(price*quantity-fee),0) s FROM holding_trade "
                        "WHERE account_id=? AND side='sell'", (account_id,))
    cash = capital - (buys["s"] or 0) + (sells["s"] or 0) if capital else None
    peak_key = f"holding_peak:{account_id}"
    peak = max(float(db.get_setting(peak_key, 0) or 0), value)
    if peak > float(db.get_setting(peak_key, 0) or 0):
        db.set_setting(peak_key, round(peak, 2))
    net = unrealized + realized
    return {
        "positionCount": len(rows), "totalCost": round(cost, 2), "marketValue": round(value, 2),
        "unrealized": round(unrealized, 2), "realized": round(realized, 2), "netProfit": round(net, 2),
        "profitRate": round(net / capital * 100, 2) if capital else (
            round(unrealized / cost * 100, 2) if cost else None),
        "cash": round(cash, 2) if cash is not None else None,
        "initialCapital": capital, "peakValue": round(peak, 2),
        "drawdown": round((peak - value) / peak * 100, 2) if peak else 0.0,
        "rows": rows,
    }


def summary(user_id: int, account_id: int | None = None) -> dict:
    acc = _account(user_id, account_id)
    if not acc:
        return {"accountId": None, "rows": [], "note": "还没有持仓账户，先建账户并录入第一笔买入"}
    m = _metrics(acc["id"], user_id)
    rules = [r for r in db.query("SELECT * FROM holding_rule WHERE user_id=? AND account_id=?",
                                 (user_id, acc["id"]))]
    return {"accountId": acc["id"], "accountName": acc["name"], "broker": acc["broker"],
            "ruleCount": len(rules), "ruleHits": sum(1 for r in rules if r["enabled"]),
            **{k: v for k, v in m.items() if k != "rows"}, "rows": m["rows"]}


# ---------------------------------------------------------------- 风控规则
def list_rules(user_id: int) -> list[dict]:
    rows = db.query("SELECT * FROM holding_rule WHERE user_id=? ORDER BY id", (user_id,))
    accs = {a["id"]: a["name"] for a in db.query(
        "SELECT id,name FROM holdings_account WHERE user_id=?", (user_id,))}
    out = []
    for r in rows:
        spec = RULE_TYPES.get(r["rule_type"], {"label": r["rule_type"], "tone": "slate",
                                               "desc": "", "params": []})
        out.append({**dict(r), "params": json.loads(r["params"] or "{}"),
                    "typeLabel": spec["label"], "tone": spec["tone"], "desc": spec["desc"],
                    "accountName": accs.get(r["account_id"], "全部账户")})
    return out


def _clean_params(rule_type: str, body: dict) -> tuple[float, dict]:
    spec = RULE_TYPES.get(rule_type)
    if not spec:
        raise ValueError("未知规则类型")
    raw = body.get("params") or {}
    if not isinstance(raw, dict):
        raw = {}
    threshold = float(body.get("threshold") if body.get("threshold") is not None
                      else raw.get("threshold") or spec["params"][0]["default"])
    return threshold, {"threshold": threshold}


def create_rule(user_id: int, body: dict) -> dict:
    acc = _account(user_id, body.get("accountId"))
    if not acc:
        raise ValueError("还没有持仓账户，先建一个")
    rule_type = str(body.get("ruleType") or body.get("rule_type") or "")
    threshold, params = _clean_params(rule_type, body or {})
    rid = db.execute("INSERT INTO holding_rule(user_id,account_id,rule_type,threshold,params,"
                     "enabled,cooldown_min,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (user_id, acc["id"], rule_type, threshold, json.dumps(params, ensure_ascii=False),
                      1 if body.get("enabled", True) else 0,
                      int(body.get("cooldownMin") or body.get("cooldown_min") or 30), db.now()))
    return {**dict(db.query_one("SELECT * FROM holding_rule WHERE id=?", (rid,))),
            "params": params, "typeLabel": RULE_TYPES[rule_type]["label"]}


def update_rule(user_id: int, rule_id: int, body: dict) -> dict | None:
    row = db.query_one("SELECT * FROM holding_rule WHERE id=? AND user_id=?", (rule_id, user_id))
    if not row:
        return None
    threshold = float(body["threshold"]) if body.get("threshold") is not None else row["threshold"]
    enabled = int(bool(body["enabled"])) if "enabled" in body else row["enabled"]
    cooldown = int(body.get("cooldownMin") or row["cooldown_min"]) if body.get("cooldownMin") else row["cooldown_min"]
    db.execute("UPDATE holding_rule SET threshold=?,params=?,enabled=?,cooldown_min=? WHERE id=?",
               (threshold, json.dumps({"threshold": threshold}, ensure_ascii=False), enabled,
                cooldown, rule_id))
    return dict(db.query_one("SELECT * FROM holding_rule WHERE id=?", (rule_id,)))


def delete_rule(user_id: int, rule_id: int) -> bool:
    return bool(db.execute("DELETE FROM holding_rule WHERE id=? AND user_id=?",
                           (rule_id, user_id)))


def _quote_age(rows: list[dict]) -> float:
    """行情离现在多少分钟；周末拿到的是最后交易日收盘，按自然日差算太长，只取时间字段"""
    worst = 0.0
    now = datetime.now()
    for r in rows:
        ts = _stamp(" ".join(x for x in (r.get("quoteDate"), r.get("quoteTime")) if x))
        if not ts:
            continue
        if (now - ts).total_seconds() > 6 * 3600 and not registry_market_open():
            return 0.0  # 休市时的旧快照不算过期
        worst = max(worst, (now - ts).total_seconds() / 60)
    return round(worst, 1)


def registry_market_open() -> bool:
    from . import market
    return bool(market.market_phase().get("trading"))


def evaluate(rule: dict, m: dict) -> dict:
    """单条规则算一次，返回 hit 与人类可读依据"""
    t = rule["rule_type"]
    th = float(rule["threshold"] or 0)
    rows = m["rows"]
    if not rows and t != "portfolio_price_stale":
        return {"hit": False, "detail": {"note": "空仓不触发"}}
    if t == "portfolio_stop_loss":
        loss = round(-m["unrealized"] / m["totalCost"] * 100, 2) if m["totalCost"] else 0
        state = f"组合浮亏 {loss}%" if loss >= 0 else f"组合浮盈 {-loss}%"
        return {"hit": loss > th, "detail": {"metric": loss, "threshold": th,
                "text": f"{state}，阈值 {th}%"}}
    if t == "portfolio_concentration":
        top = max(rows, key=lambda r: r["weight"])
        return {"hit": top["weight"] > th, "detail": {"metric": top["weight"], "threshold": th,
                "symbol": top["symbol"], "name": top["name"],
                "text": f"{top['name']} 占组合 {top['weight']}%，上限 {th}%"}}
    if t == "portfolio_drawdown":
        return {"hit": m["drawdown"] > th, "detail": {"metric": m["drawdown"], "threshold": th,
                "text": f"从峰值 {m['peakValue']} 回撤 {m['drawdown']}%，阈值 {th}%"}}
    if t == "portfolio_price_stale":
        age = _quote_age(rows)
        return {"hit": age > th, "detail": {"metric": age, "threshold": th,
                "text": f"行情已 {age} 分钟未更新，上限 {th} 分钟"}}
    return {"hit": False, "detail": {"note": "未知规则"}}


def _cooled(rule_id: int, minutes: int) -> bool:
    since = (datetime.now() - timedelta(minutes=max(1, int(minutes or 30)))).strftime("%Y-%m-%d %H:%M:%S")
    return bool(db.query_one("SELECT id FROM alert_trigger WHERE rule_id=? AND suppressed=0 "
                             "AND triggered_at>=?", (rule_id, since)))


def _noisy(rule_id: int) -> bool:
    today = datetime.now().strftime("%Y-%m-%d")
    n = db.query_one("SELECT COUNT(*) c FROM alert_trigger WHERE rule_id=? AND suppressed=0 "
                     "AND triggered_at>=?", (rule_id, today))
    return bool(n and n["c"] >= 3)


def run_rule(rule: dict, *, notify_user: bool = True) -> dict:
    m = _metrics(rule["account_id"], rule["user_id"])
    res = evaluate(rule, m)
    out = {"ruleId": rule["id"], "type": rule["rule_type"], "hit": res["hit"],
           "detail": res["detail"]}
    if not res["hit"] or not notify_user:
        return out
    if _cooled(rule["id"], rule["cooldown_min"]):
        db.execute("INSERT INTO alert_trigger(user_id,rule_id,account_id,scope,triggered_at,detail,"
                   "suppressed,suppress_reason) VALUES(?,?,?,?,?,?,?,?)",
                   (rule["user_id"], rule["id"], rule["account_id"], "account", db.now(),
                    json.dumps(res["detail"], ensure_ascii=False), 1, "cooldown"))
        return {**out, "suppressed": "cooldown"}
    if _noisy(rule["id"]):
        db.execute("INSERT INTO alert_trigger(user_id,rule_id,account_id,scope,triggered_at,detail,"
                   "suppressed,suppress_reason) VALUES(?,?,?,?,?,?,?,?)",
                   (rule["user_id"], rule["id"], rule["account_id"], "account", db.now(),
                    json.dumps(res["detail"], ensure_ascii=False), 1, "noise"))
        return {**out, "suppressed": "noise"}
    tid = db.execute("INSERT INTO alert_trigger(user_id,rule_id,account_id,scope,triggered_at,detail,"
                     "suppressed,suppress_reason) VALUES(?,?,?,?,?,?,?,?)",
                     (rule["user_id"], rule["id"], rule["account_id"], "account", db.now(),
                      json.dumps(res["detail"], ensure_ascii=False), 0, ""))
    acc = db.query_one("SELECT name FROM holdings_account WHERE id=?", (rule["account_id"],))
    label = RULE_TYPES[rule["rule_type"]]["label"]
    notify.notify(rule["user_id"], f"[{acc['name'] if acc else '持仓'}] {label}",
                  res["detail"]["text"])
    return {**out, "triggerId": tid}


def scan(user_id: int, account_id: int | None = None) -> dict:
    rules = [dict(r) for r in db.query(
        "SELECT * FROM holding_rule WHERE user_id=? AND enabled=1"
        + (" AND account_id=?" if account_id else ""), (user_id, account_id) if account_id else (user_id,))]
    results = []
    for r in rules:
        r["params"] = json.loads(r["params"] or "{}")
        try:
            results.append(run_rule(r))
        except ProviderError as exc:
            results.append({"ruleId": r["id"], "type": r["rule_type"], "hit": False,
                            "error": exc.message})
    return {"checked": len(rules), "hits": sum(1 for x in results if x.get("hit")),
            "notified": sum(1 for x in results if x.get("triggerId")),
            "suppressed": sum(1 for x in results if x.get("suppressed")),
            "results": results}


def test_rule(user_id: int, rule_id: int) -> dict:
    row = db.query_one("SELECT * FROM holding_rule WHERE id=? AND user_id=?", (rule_id, user_id))
    if not row:
        return {"ok": False, "note": "规则不存在"}
    m = _metrics(row["account_id"], user_id)
    return {"ok": True, "ruleId": rule_id, "dryRun": True, **evaluate(dict(row), m)}


def triggers(user_id: int, limit: int = 200) -> list[dict]:
    rows = db.query("SELECT t.*,r.rule_type,a.name AS account_name FROM alert_trigger t "
                    "LEFT JOIN holding_rule r ON r.id=t.rule_id "
                    "LEFT JOIN holdings_account a ON a.id=t.account_id "
                    "WHERE t.user_id=? ORDER BY t.id DESC LIMIT ?", (user_id, limit))
    out = []
    for t in rows:
        d = dict(t)
        d["detail"] = json.loads(d["detail"] or "{}")
        d["typeLabel"] = RULE_TYPES.get(d.get("rule_type") or "", {}).get("label", d.get("rule_type"))
        out.append(d)
    return out


def notifications(user_id: int, limit: int = 200) -> list[dict]:
    return [dict(r) for r in db.query("SELECT * FROM notification WHERE user_id=? "
                                      "ORDER BY id DESC LIMIT ?", (user_id, limit))]


def mark_read(user_id: int, notification_id: int | None = None) -> dict:
    before = unread(user_id)
    if notification_id:
        db.execute("UPDATE notification SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL",
                   (db.now(), notification_id, user_id))
    else:
        db.execute("UPDATE notification SET read_at=? WHERE user_id=? AND read_at IS NULL",
                   (db.now(), user_id))
    return {"ok": True, "marked": before - unread(user_id), "unread": unread(user_id)}


def unread(user_id: int) -> int:
    r = db.query_one("SELECT COUNT(*) n FROM notification WHERE user_id=? AND read_at IS NULL "
                     "AND channel='inapp'", (user_id,))
    return r["n"] if r else 0
