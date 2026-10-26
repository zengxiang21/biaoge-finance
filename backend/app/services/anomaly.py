"""盘中异常监控：7 类异动检测 + 自定义规则（拆解文档 3.12 / 9.9）

检测依赖两次快照的差值，所以本模块自己维护一份最近 10 分钟的采样序列；
休市时改用收盘快照口径生成事件，页面不会是空白。
"""
from __future__ import annotations

import json
import threading
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from .. import db
from ..providers import registry, sina
from ..providers.base import ProviderError
from . import market

ANOMALY_TYPES: dict[str, dict] = {
    "surge": {"label": "急涨", "tone": "rose", "desc": "5 分钟内快速拉升并触发当日涨幅门槛",
              "params": [{"key": "pct5_min", "label": "5分钟涨幅≥(%)", "default": 3.0},
                         {"key": "day_pct_min", "label": "当日涨幅≥(%)", "default": 5.0},
                         {"key": "min_amount", "label": "成交额≥(万元)", "default": 3000}]},
    "plunge": {"label": "急跌", "tone": "emerald", "desc": "5 分钟内快速跳水",
               "params": [{"key": "pct5_max", "label": "5分钟跌幅≤(%)", "default": -3.0},
                          {"key": "day_pct_max", "label": "当日跌幅≤(%)", "default": -5.0},
                          {"key": "min_amount", "label": "成交额≥(万元)", "default": 3000}]},
    "volume_burst": {"label": "量能异动", "tone": "amber", "desc": "近 5 分钟每分钟成交额相对 20 日均量放大",
                     "params": [{"key": "volume_ratio_min", "label": "量能放大倍数≥", "default": 3.0},
                                {"key": "min_amount", "label": "成交额≥(万元)", "default": 5000}]},
    "limit_up_seal": {"label": "封板", "tone": "rose", "desc": "由未涨停跳升到涨停价封住",
                      "params": [{"key": "min_amount", "label": "成交额≥(万元)", "default": 1000}]},
    "limit_up_break": {"label": "炸板", "tone": "violet", "desc": "涨停打开并回落",
                      "params": [{"key": "min_amount", "label": "成交额≥(万元)", "default": 1000}]},
    "large_order_inflow": {"label": "主力大单流入", "tone": "sky", "desc": "个股主力资金净流入超阈值",
                           "params": [{"key": "net_min", "label": "净流入≥(万元)", "default": 5000}]},
    "large_order_outflow": {"label": "主力大单流出", "tone": "slate", "desc": "个股主力资金净流出超阈值",
                            "params": [{"key": "net_max", "label": "净流出≤(万元)", "default": -5000}]},
}

SCOPES = {"all": "全市场", "main": "沪深主板", "cyb": "创业板", "kcb": "科创板",
          "bj": "北交所", "watchlist": "仅自选股"}

_lock = threading.Lock()
_TICKS: dict[str, deque] = {}      # symbol -> [(ts, price, amount, prev_close, limit_rate)]
_last_scan: dict[str, Any] = {"at": None, "scanned": 0, "new_events": 0, "basis": None,
                              "note": None, "errors": {}}
_baseline: dict[str, Any] = {"date": None, "map": {}}

TRADE_MINUTES = 240.0


# ---------------------------------------------------------------- 规则
def seed_rules() -> None:
    if db.query_one("SELECT id FROM anomaly_rule LIMIT 1"):
        return
    for key, spec in ANOMALY_TYPES.items():
        db.execute("INSERT INTO anomaly_rule(user_id,name,event_type,scope,params,enabled,"
                   "cooldown_min,created_at) VALUES(NULL,?,?, 'all', ?,1,30,?)",
                   (spec["label"], key,
                    json.dumps({p["key"]: p["default"] for p in spec["params"]}, ensure_ascii=False),
                    db.now()))


def list_rules(user_id: int | None = None) -> list[dict]:
    seed_rules()
    out = []
    for r in db.query("SELECT * FROM anomaly_rule ORDER BY event_type, id"):
        d = dict(r)
        d["params"] = json.loads(d.get("params") or "{}")
        spec = ANOMALY_TYPES.get(d["event_type"], {})
        d["eventTypeLabel"] = spec.get("label", d["event_type"])
        d["scopeLabel"] = SCOPES.get(d.get("scope") or "all", d.get("scope"))
        d["isSystem"] = d["user_id"] is None
        d["defaults"] = {p["key"]: p["default"] for p in spec.get("params", [])}
        out.append(d)
    return out


def create_rule(body: dict, user_id: int) -> dict:
    etype = body.get("event_type")
    if etype not in ANOMALY_TYPES:
        raise ValueError("未知的异动类型")
    params = _clean_params(etype, body.get("params") or {})
    rid = db.execute("INSERT INTO anomaly_rule(user_id,name,event_type,scope,params,enabled,"
                     "cooldown_min,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (user_id, body.get("name") or ANOMALY_TYPES[etype]["label"], etype,
                      body.get("scope") or "all", json.dumps(params, ensure_ascii=False),
                      1 if body.get("enabled", True) else 0,
                      int(body.get("cooldown_min") or 30), db.now()))
    return next(r for r in list_rules() if r["id"] == rid)


def update_rule(rule_id: int, body: dict) -> dict | None:
    row = db.query_one("SELECT * FROM anomaly_rule WHERE id=?", (rule_id,))
    if not row:
        return None
    patch, params = dict(row), json.loads(row["params"] or "{}")
    if "params" in (body or {}) and isinstance(body["params"], dict):
        params = _clean_params(row["event_type"], {**params, **body["params"]})
        patch["params"] = json.dumps(params, ensure_ascii=False)
    for key in ("name", "scope", "cooldown_min"):
        if body.get(key) is not None:
            patch[key] = body[key]
    if "enabled" in (body or {}):
        patch["enabled"] = 1 if body["enabled"] else 0
    db.execute("UPDATE anomaly_rule SET name=?,scope=?,params=?,enabled=?,cooldown_min=? WHERE id=?",
               (patch["name"], patch["scope"], patch["params"], patch["enabled"],
                patch["cooldown_min"], rule_id))
    return next((r for r in list_rules() if r["id"] == rule_id), None)


def delete_rule(rule_id: int) -> bool:
    return db.execute("DELETE FROM anomaly_rule WHERE id=?", (rule_id,)) > 0


def _clean_params(etype: str, raw: dict) -> dict:
    """只留该类型认识的字段，数值统一存 float，避免前端拿到字符串后比较出错"""
    out = {}
    for p in ANOMALY_TYPES[etype]["params"]:
        v = raw.get(p["key"], p["default"])
        try:
            out[p["key"]] = float(v)
        except (TypeError, ValueError):
            out[p["key"]] = p["default"]
    return out


def _in_scope(sym: str, name: str, scope: str, watch: set[str]) -> bool:
    code = sym[2:]
    if scope == "main":
        return code.startswith(("60", "00"))
    if scope == "cyb":
        return code.startswith("30")
    if scope == "kcb":
        return code.startswith("68")
    if scope == "bj":
        return sym.startswith("bj")
    if scope == "watchlist":
        return sym in watch
    return True


# ---------------------------------------------------------------- 采样序列
def _avg_amount(symbols: list[str]) -> dict[str, float]:
    """20 日均成交额（元），量能异动的分母"""
    date = registry.trade_date_hint()
    if _baseline["date"] != date:
        _baseline.update({"date": date, "map": {}})
    missing = [s for s in symbols if s not in _baseline["map"]]
    for i in range(0, len(missing), 400):
        chunk = missing[i:i + 400]
        marks = ",".join("?" * len(chunk))
        for sym, avg in db.rows_of(
                f"SELECT symbol, AVG(amount) FROM kline_cache WHERE symbol IN ({marks}) "
                f"GROUP BY symbol HAVING COUNT(*) >= 5", tuple(chunk)):
            _baseline["map"][sym] = float(avg or 0)
    return _baseline["map"]


def _observe(rows: list[dict]) -> None:
    now = datetime.now()
    for r in rows:
        q = _TICKS.setdefault(r["symbol"], deque(maxlen=25))
        q.append((now, r["price"], r["amount"], r["prev_close"], r["limit_rate"]))


def _window(symbol: str, minutes: float = 5.0) -> tuple | None:
    """取出 minutes 分钟前最近的一个采样点"""
    q = _TICKS.get(symbol)
    if not q:
        return None
    now = q[-1][0]
    cut = now - timedelta(minutes=minutes)
    for point in q:
        if point[0] >= cut:
            return point
    return None


# ---------------------------------------------------------------- 扫描
def _spot_union() -> tuple[list[dict], dict]:
    """涨得快、跌得快、成交额大的三张榜取并集：盘中异动只会出现在这些票里，
    每 30 秒全推 5500 只既不现实也没必要"""
    errors: dict[str, str] = {}
    picked: dict[str, dict] = {}
    for sort, desc, num in (("changepercent", True, 100), ("changepercent", False, 100),
                            ("amount", True, 120), ("turnoverratio", True, 100)):
        try:
            rows = market._normalize_spot(sina.spot_ranking(sort, desc, num))
        except ProviderError as exc:
            errors[f"spot:{sort}:{desc}"] = exc.message
            continue
        for r in rows:
            picked.setdefault(r["symbol"], r)
    return list(picked.values()), errors


def scan(trigger: str = "manual", user_id: int | None = None) -> dict:
    with _lock:
        return _scan(trigger, user_id)


def _scan(trigger: str, user_id: int | None) -> dict:
    global _last_scan
    if not _trading():
        return {**_last_scan, "basis": "closed",
                "note": "当前非交易时段，实时扫描不产生新事件；可切换「收盘口径」用当日快照生成",
                "events": events(limit=100)}
    rows, errors = _spot_union()
    if not rows:
        return {**_last_scan, "note": "快照取数失败", "errors": errors, "events": events(limit=100)}
    _observe(rows)
    found = _detect(rows, trigger, user_id, errors)
    _last_scan = {"at": db.now(), "scanned": len(rows), "new_events": len(found),
                  "basis": "live", "note": None, "errors": errors}
    return {**_last_scan, "events": found}


def _trading() -> bool:
    return bool(market.market_phase()["trading"])


def _detect(rows: list[dict], trigger: str, user_id: int | None, errors: dict) -> list[dict]:
    rules = [r for r in list_rules() if r["enabled"]]
    watch = _watchlist(user_id) if any(r["scope"] == "watchlist" for r in rules) else set()
    avg = _avg_amount([r["symbol"] for r in rows])
    now = datetime.now()
    date = now.strftime("%Y-%m-%d")
    out: list[dict] = []
    for r in rows:
        prev = _window(r["symbol"])
        for rule in rules:
            if not _in_scope(r["symbol"], r["name"], rule["scope"], watch):
                continue
            p = rule["params"]
            if (r["amount"] or 0) < p.get("min_amount", 0) * 1e4:
                continue
            hit = None
            et = rule["event_type"]
            if et == "surge" and prev:
                chg5 = _pct5(prev[1], r["price"])
                if chg5 is not None and chg5 >= p["pct5_min"] and r["change_percent"] >= p["day_pct_min"]:
                    hit = {"pct_5min": round(chg5, 2), "change_pct": r["change_percent"],
                           "basis": "5分钟涨幅/当日涨幅"}
            elif et == "plunge" and prev:
                chg5 = _pct5(prev[1], r["price"])
                if chg5 is not None and chg5 <= p["pct5_max"] and r["change_percent"] <= p["day_pct_max"]:
                    hit = {"pct_5min": round(chg5, 2), "change_pct": r["change_percent"],
                           "basis": "5分钟跌幅/当日跌幅"}
            elif et == "volume_burst" and prev:
                ratio = _volume_ratio(prev, r, avg.get(r["symbol"], 0))
                if ratio and ratio >= p["volume_ratio_min"]:
                    hit = {"volume_ratio": round(ratio, 2), "change_pct": r["change_percent"],
                           "basis": "5分钟每分钟成交额 / 20日均额每分钟"}
            elif et == "limit_up_seal" and prev:
                was, is_now = _sealed(prev[1], prev[3], prev[4]), _sealed(r["price"], r["prev_close"], r["limit_rate"])
                if is_now and not was:
                    hit = {"change_pct": r["change_percent"], "seal_price": r["price"],
                           "basis": "上一采样未涨停 → 本采样封板"}
            elif et == "limit_up_break" and prev:
                was, is_now = _sealed(prev[1], prev[3], prev[4]), _sealed(r["price"], r["prev_close"], r["limit_rate"])
                if was and not is_now and r["price"] > 0:
                    hit = {"change_pct": r["change_percent"], "break_price": r["price"],
                           "basis": "上一采样封板 → 本采样打开"}
            if hit and not _cooled(r["symbol"], et, rule["cooldown_min"], now):
                out.append(_insert(r, et, rule["id"], hit, None, date, trigger))
    out += _flow_events(rules, watch, date, trigger, errors)
    return [e for e in out if e]


def _watchlist(user_id: int | None) -> set[str]:
    if not user_id:
        return set()
    return {r[0] for r in db.rows_of(
        "SELECT symbol FROM watchlist_items WHERE user_id=?", (user_id,))}


def _flow_events(rules: list[dict], watch: set[str], date: str, trigger: str,
                 errors: dict) -> list[dict]:
    """主力大单：新浪个股资金流排行，净流入/流出各取一头。同一类型只用第一条启用规则，
    多条同类型规则会在同一批数据上重复刷屏"""
    out: list[dict] = []
    now = datetime.now()
    for et, desc in (("large_order_inflow", True), ("large_order_outflow", False)):
        rule = next((r for r in rules if r["event_type"] == et), None)
        if not rule:
            continue
        try:
            rows = sina.money_flow_stocks(80, desc=desc)
        except ProviderError as exc:
            errors[et] = exc.message
            continue
        p = rule["params"]
        for r in rows:
            if not _in_scope(r["symbol"], r["name"], rule["scope"], watch):
                continue
            net = r["netAmount"] or 0
            ok = net >= p["net_min"] * 1e4 if et == "large_order_inflow" \
                else net <= p["net_max"] * 1e4
            if not ok or _cooled(r["symbol"], et, rule["cooldown_min"], now):
                continue
            row = {"symbol": r["symbol"], "name": r["name"], "price": r["price"],
                   "change_percent": r["changePercent"], "amount": r["amount"]}
            out.append(_insert(row, et, rule["id"], {"basis": "主力资金净流入（新浪盘中口径）"},
                               round(net / 1e4, 1), date, trigger))
    return out


def _pct5(prev_price: float, price: float) -> float | None:
    if not prev_price:
        return None
    return (price - prev_price) / prev_price * 100


def _volume_ratio(prev, cur, avg_amount: float) -> float | None:
    """量比近似：区间每分钟成交额 ÷ 20 日平均每分钟成交额"""
    if not avg_amount:
        return None
    seconds = (datetime.now() - prev[0]).total_seconds()
    if seconds < 60:
        return None
    delta = (cur["amount"] or 0) - (prev[2] or 0)
    if delta <= 0:
        return None
    per_min_now = delta / (seconds / 60.0)
    per_min_avg = avg_amount / TRADE_MINUTES
    return per_min_now / per_min_avg if per_min_avg else None


def _sealed(price: float, prev_close: float, limit_rate: float) -> bool:
    limit = market._limit_price(prev_close, limit_rate or 0.1)
    return bool(limit and price and price >= limit - 0.001)


def _cooled(symbol: str, etype: str, cooldown_min: int, now: datetime) -> bool:
    since = (now - timedelta(minutes=max(1, int(cooldown_min or 30)))).strftime("%Y-%m-%d %H:%M:%S")
    row = db.query_one("SELECT id FROM anomaly_event WHERE symbol=? AND event_type=? "
                       "AND triggered_at>=? LIMIT 1", (symbol, etype, since))
    return bool(row)


def _insert(row: dict, etype: str, rule_id: int | None, params: dict,
            net_amount: float | None, date: str, trigger: str) -> dict:
    eid = db.execute(
        "INSERT INTO anomaly_event(symbol,name,event_type,price,change_percent,volume_ratio,"
        "net_amount,params,rule_id,trade_date,triggered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (row["symbol"], row["name"], etype, row["price"], row["change_percent"],
         params.get("volume_ratio"), net_amount,
         json.dumps({**params, "trigger": trigger}, ensure_ascii=False), rule_id,
         date, db.now()))
    return {"id": eid, "symbol": row["symbol"], "name": row["name"], "event_type": etype,
            "eventTypeLabel": ANOMALY_TYPES[etype]["label"], "price": row["price"],
            "change_percent": row["change_percent"], "volume_ratio": params.get("volume_ratio"),
            "net_amount": net_amount, "params": params, "rule_id": rule_id,
            "trade_date": date, "triggered_at": db.now(), "trigger": trigger}


# ---------------------------------------------------------------- 收盘口径
def scan_close_basis(user_id: int) -> dict:
    """休市时用当日快照生成事件：涨停池给封板/炸板，快照给急涨急跌与量能"""
    date = registry.trade_date_hint()
    spot = {r["symbol"]: r for r in db.query(
        "SELECT * FROM snapshot_stocks WHERE trade_date=? ORDER BY amount DESC LIMIT 600", (date,))}
    if not spot:
        return {"ok": False, "note": "还没有收盘快照，先去仪表盘刷新行情", "events": []}
    rules = {r["event_type"]: r for r in list_rules() if r["enabled"]}
    pools = market._pool_rows(date, "up")
    blown = market._pool_rows(date, "blown")
    watch = _watchlist(user_id)
    created: list[dict] = []

    def add(sym, etype, params, net=None, price=None, chg=None, name=None):
        rule = rules.get(etype)
        if not rule:
            return
        if not _in_scope(sym, name or "", rule["scope"], watch):
            return
        if _cooled(sym, etype, rule["cooldown_min"], datetime.now()):
            return
        eid = db.execute(
            "INSERT INTO anomaly_event(symbol,name,event_type,price,change_percent,volume_ratio,"
            "net_amount,params,rule_id,trade_date,triggered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (sym, name, etype, price, chg, params.get("volume_ratio"), net,
             json.dumps({**params, "trigger": "close_basis"}, ensure_ascii=False),
             rule["id"], date[:10], db.now()))
        created.append({"id": eid, "symbol": sym, "name": name, "event_type": etype,
                        "eventTypeLabel": ANOMALY_TYPES[etype]["label"], "price": price,
                        "change_percent": chg, "volume_ratio": params.get("volume_ratio"),
                        "net_amount": net, "params": params, "rule_id": rule["id"],
                        "trade_date": date[:10], "triggered_at": db.now()})

    for p in pools[:120]:
        add(p["symbol"], "limit_up_seal",
            {"basis": "收盘涨停池", "lbc": p.get("lbc"), "fbt": p.get("fbt")},
            price=p.get("price"), chg=p.get("change_percent"), name=p.get("name"))
    for p in blown[:80]:
        add(p["symbol"], "limit_up_break",
            {"basis": "收盘炸板池", "zb_count": p.get("zb_count")},
            price=p.get("price"), chg=p.get("change_percent"), name=p.get("name"))

    avg = _avg_amount(list(spot))
    sp = rules.get("surge", {}).get("params", {})
    pp = rules.get("plunge", {}).get("params", {})
    vp = rules.get("volume_burst", {}).get("params", {})
    for sym, r in spot.items():
        chg = r["change_percent"] or 0
        amt = r["amount"] or 0
        if "surge" in rules and chg >= sp["day_pct_min"] and amt >= sp["min_amount"] * 1e4:
            prev_close = r["prev_close"] or 0
            rebound = ((r["price"] - r["low"]) / prev_close * 100) if prev_close else 0
            add(sym, "surge", {"pct_5min": round(rebound, 2),
                               "basis": "收盘口径：当日最低价到现价的振幅，代替 5 分钟涨幅"},
                price=r["price"], chg=chg, name=r["name"])
        if "plunge" in rules and chg <= pp["day_pct_max"]:
            add(sym, "plunge", {"basis": "收盘口径：当日跌幅"}, price=r["price"], chg=chg, name=r["name"])
        vr = _close_volume_ratio(r, avg.get(sym, 0))
        if "volume_burst" in rules and vr and vr >= vp["volume_ratio_min"]:
            add(sym, "volume_burst", {"volume_ratio": vr, "basis": "收盘口径：当日成交额 / 20 日均额"},
                price=r["price"], chg=chg, name=r["name"])
    errors: dict[str, str] = {}
    for et, desc in (("large_order_inflow", True), ("large_order_outflow", False)):
        rule = rules.get(et)
        if not rule:
            continue
        try:
            rows = sina.money_flow_stocks(80, desc=desc)
        except ProviderError as exc:
            errors[et] = exc.message
            continue
        p = rule["params"]
        for r in rows:
            net = r["netAmount"] or 0
            hit = net >= p["net_min"] * 1e4 if et == "large_order_inflow" else net <= p["net_max"] * 1e4
            if hit:
                add(r["symbol"], et, {"basis": "收盘口径：个股主力资金排行"},
                    net=round(net / 1e4, 1), price=r["price"], chg=r["changePercent"], name=r["name"])
    return {"ok": True, "date": date[:10], "new_events": len(created), "events": created,
            "basis": "close", "errors": errors,
            "note": "用当日收盘快照与涨跌停池生成，口径与盘中不同，已标注 close_basis"}


def _close_volume_ratio(r: dict, avg_amount: float) -> float | None:
    if not avg_amount:
        return None
    return round((r["amount"] or 0) / avg_amount, 2)


# ---------------------------------------------------------------- 查询
def events(event_type: str = "", symbol: str = "", date: str = "",
           limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM anomaly_event WHERE 1=1"
    args: list[Any] = []
    if event_type:
        sql += " AND event_type=?"
        args.append(event_type)
    if symbol:
        sql += " AND (symbol LIKE ? OR name LIKE ?)"
        args += [f"%{symbol}%", f"%{symbol}%"]
    if date:
        sql += " AND trade_date=?"
        args.append(date)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(min(limit, 500))
    out = []
    for r in db.query(sql, tuple(args)):
        d = dict(r)
        d["params"] = json.loads(d.get("params") or "{}")
        d["eventTypeLabel"] = ANOMALY_TYPES.get(d["event_type"], {}).get("label", d["event_type"])
        d["tone"] = ANOMALY_TYPES.get(d["event_type"], {}).get("tone", "slate")
        out.append(d)
    return out


def summary(hours: int = 24) -> dict:
    since = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    rows = db.query("SELECT event_type, COUNT(*) n, MAX(triggered_at) last FROM anomaly_event "
                    "WHERE triggered_at>=? GROUP BY event_type", (since,))
    counts = {r["event_type"]: r["n"] for r in rows}
    total = sum(counts.values())
    return {"total": total,
            "byType": [{"key": k, "label": v["label"], "tone": v["tone"], "count": counts.get(k, 0)}
                       for k, v in ANOMALY_TYPES.items()],
            "symbols": db.query_one("SELECT COUNT(DISTINCT symbol) n FROM anomaly_event "
                                     "WHERE triggered_at>=?", (since,))["n"],
            "lastEvent": db.query_one("SELECT MAX(triggered_at) t FROM anomaly_event")["t"],
            "scan": _last_scan}
