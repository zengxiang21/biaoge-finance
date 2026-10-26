"""资讯中心服务：7x24 快讯 + 新闻雷达 + 热搜 + 资金流（拆解文档 3.11 / 9.8）"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta
from typing import Any

from .. import db
from ..providers import eastmoney, external, registry, sina
from ..providers.base import ProviderError

# 资讯类接口慢且容易被限流，做进程内短缓存，前端自动刷新不至于反复打源
_CACHE_TTL = 45.0
_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


# ---------------------------------------------------------------- 快讯
def _match_stocks(text: str) -> list[str]:
    """正文里提到哪些股票：先用快照名字反查，比 NLP 便宜且够用"""
    names = db.rows_of(
        "SELECT name, symbol FROM snapshot_stocks WHERE trade_date=("
        "SELECT MAX(trade_date) FROM snapshot_stocks) ORDER BY amount DESC LIMIT 2500")
    hit = []
    for name, symbol in names:
        if name and len(name) >= 3 and name in text:
            hit.append(symbol)
        if len(hit) >= 8:
            break
    return hit


def _score_radar(item: dict, cfg: dict) -> dict:
    """按雷达关键词打分：命中一个词算一次，标题命中权重翻倍"""
    text = f"{item.get('title') or ''} {item.get('summary') or ''}"
    kws = [k for k in (cfg.get("keywords") or []) if k]
    exclude = [k for k in (cfg.get("exclude") or []) if k]
    title = item.get("title") or ""
    hits = []
    for k in kws:
        if k in title:
            hits.append(k)
        elif k in text:
            hits.append(k)
    blocked = [k for k in exclude if k in text]
    score = len([k for k in hits if k in title]) * 2 + len([k for k in hits if k not in title])
    return {"keywords": hits, "excluded": blocked, "importance": 0 if blocked else score,
            "radar": bool(score) and not blocked and score >= int(cfg.get("min_importance", 1) or 1)}


def _store_news(items: list[dict], source: str) -> None:
    rows = []
    for it in items:
        if not it.get("id"):
            continue
        rows.append((str(it["id"])[:64], source, it.get("title"), it.get("summary"),
                     it.get("url"), it.get("time"),
                     json.dumps(it.get("stocks") or [], ensure_ascii=False),
                     json.dumps(it.get("topics") or [], ensure_ascii=False), db.now()))
    if rows:
        db.executemany("INSERT OR REPLACE INTO news_item(id,source,title,summary,url,time,stocks,"
                       "topic,created_at) VALUES(?,?,?,?,?,?,?,?,?)", rows)
    db.execute("DELETE FROM news_item WHERE created_at < ?",
               ((datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S"),))


def _raw_flash(size: int) -> dict:
    """东财 7x24 为主，新浪滚动新闻补齐宏观/产业消息；单源失败不影响另一源"""
    errors: dict[str, str] = {}
    em: list[dict] = []
    sina_rows: list[dict] = []
    try:
        em = registry.news_flash(size)
        for it in em:
            it["source"] = "东方财富"
            it["channel"] = "7x24"
            it["topics"] = []
    except ProviderError as exc:
        errors["eastmoney_fast"] = exc.message
    try:
        sina_rows = sina.roll_news(2516, size)
        for it in sina_rows:
            it["stocks"] = []
            it["channel"] = "滚动"
            it["topics"] = []
    except ProviderError as exc:
        errors["sina_roll"] = exc.message
    _store_news(em, "eastmoney")
    _store_news(sina_rows, "sina")
    return {"items": em + sina_rows, "errors": errors}


def refresh_news(size: int = 80) -> int:
    """定时任务用：绕开短缓存直接抓一次并落库"""
    data = _raw_flash(size)
    _cache[f"flash:{size}"] = (time.time(), data)
    return len(data["items"])


def _norm_stock_code(raw: str) -> str | None:
    """东财快讯的 stockList 是「市场.代码」，板块码（90.BKxxxx）与指数不是个股，直接丢"""
    s = str(raw or "").strip()
    if re.match(r"^(sh|sz|bj)\d{6}$", s):
        return s
    m = re.match(r"^(\d+)\.([0-9a-zA-Z]{6,8})$", s)
    if not m:
        return None
    market, code = m.group(1), m.group(2)
    if not code.isdigit() or len(code) != 6:
        return None
    if market == "1":
        return f"sh{code}"
    if market == "0":
        return f"bj{code}" if code[0] in "48" else f"sz{code}"
    return None


def news_flash(size: int = 80, keyword: str = "", source: str = "",
               only_radar: bool = False, stock: str = "") -> dict:
    cfg = db.get_setting("news_radar", {}) or {}
    data = _cached(f"flash:{size}", lambda: _raw_flash(size))
    out = []
    for it in data["items"]:
        scored = _score_radar(it, cfg)
        text = f"{it.get('title') or ''}{it.get('summary') or ''}"
        if keyword and keyword not in text:
            continue
        if source and source not in (it.get("source"), it.get("channel")):
            continue
        if only_radar and not scored["radar"]:
            continue
        if not it.get("stocks"):
            # 东财自带关联个股，新浪滚动没有；用快照股票名反查补齐
            it["stocks"] = _match_stocks(text)
        syms = [s for s in (_norm_stock_code(x) for x in it["stocks"]) if s]
        it["stocks"] = list(dict.fromkeys(syms))
        if stock and stock not in it["stocks"]:
            continue
        out.append({**it, **scored})
    out.sort(key=lambda x: (x["radar"], x["importance"], x.get("time") or ""), reverse=True)
    names = {r[0]: r[1] for r in db.rows_of(
        "SELECT symbol,name FROM snapshot_stocks WHERE trade_date=("
        "SELECT MAX(trade_date) FROM snapshot_stocks)")}
    for it in out:
        it["stockNames"] = [{"symbol": s, "name": names.get(s, s)} for s in (it.get("stocks") or [])]
    return {"items": out[:size], "total": len(out), "errors": data["errors"],
            "radarEnabled": bool(cfg.get("enabled")), "cachedSeconds": _CACHE_TTL,
            "generatedAt": db.now()}


def radar_config() -> dict:
    cfg = db.get_setting("news_radar", {}) or {}
    hits = db.query_one("SELECT COUNT(*) n FROM news_item WHERE created_at > ?",
                        ((datetime.now() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S"),))
    return {"config": cfg, "cachedNews24h": hits["n"] if hits else 0}


def save_radar_config(body: dict) -> dict:
    cfg = db.get_setting("news_radar", {}) or {}
    for key in ("enabled", "interval_min", "keywords", "exclude", "min_importance", "sources"):
        if key in (body or {}):
            cfg[key] = body[key]
    if isinstance(cfg.get("keywords"), str):
        cfg["keywords"] = [k for k in re.split(r"[,，\s]+", cfg["keywords"]) if k]
    if isinstance(cfg.get("exclude"), str):
        cfg["exclude"] = [k for k in re.split(r"[,，\s]+", cfg["exclude"]) if k]
    cfg["keywords"] = list(dict.fromkeys(cfg.get("keywords") or []))
    db.set_setting("news_radar", cfg)
    _cache.clear()
    return cfg


# ---------------------------------------------------------------- 热搜
def hot_search(num: int = 30) -> dict:
    def load():
        agg = external.finance_hot(num)
        boards = dict(agg.get("boards") or {})
        errors = dict(agg.get("errors") or {})
        # 财经相关度：热搜榜大部分是娱乐，用关键词把财经/股市相关的挑出来放前面
        fin_kw = ["股", "A股", "财经", "基金", "IPO", "上市", "央行", "利率", "房价", "楼市",
                  "黄金", "原油", "美元", "人民币", "降息", "降准", "公司", "财报", "分红",
                  "新能源", "芯片", "AI", "人工智能", "机器人", "汽车", "药", "酒", "电"]
        for label, rows in boards.items():
            for r in rows:
                text = f"{r.get('word') or ''}{r.get('desc') or ''}"
                r["finance"] = any(k in text for k in fin_kw)
            boards[label] = sorted(rows, key=lambda x: (not x["finance"], x.get("rank") or 99))
        try:
            # 东财人气榜只给代码不给名字，用最新快照补齐
            names = {r[0]: r[1] for r in db.rows_of(
                "SELECT symbol,name FROM snapshot_stocks WHERE trade_date=("
                "SELECT MAX(trade_date) FROM snapshot_stocks)")}
            boards["eastmoney_hot"] = [
                {"rank": r.get("rank") or i + 1, "word": names.get(r["symbol"], r["symbol"]),
                 "hot": None, "symbol": r["symbol"],
                 "desc": f"热度排名变化 {r.get('change')}", "url": None,
                 "tag": "东财人气榜", "source": "东方财富", "finance": True}
                for i, r in enumerate(registry.hot_rank(num))]
        except ProviderError as exc:
            errors["eastmoney_hot"] = exc.message
            boards["eastmoney_hot"] = []
        return {"boards": boards, "errors": errors}

    out = _cached(f"hot:{num}", load)
    return {**out, "generatedAt": db.now()}


# ---------------------------------------------------------------- 资金流
BOARD_KINDS = {"industry": 2, "concept": 1, "region": 0}


def _full_board_names(kind: str) -> list[str]:
    """新浪资金流接口把板块名截到 8 个字，用 stock_board 的全名补回来"""
    return [r["board_name"] for r in db.query(
        "SELECT DISTINCT board_name FROM stock_board WHERE kind=? AND board_name<>''", (kind,))]


def sector_flow(kind: str = "industry", limit: int = 60) -> dict:
    def load():
        try:
            rows = registry.board_fund_flow(fenlei=BOARD_KINDS.get(kind, 2), num=max(limit, 60))
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}
        date = registry.trade_date_hint()
        names = _full_board_names(kind)
        if names:
            for r in rows:
                hit = [n for n in names if n.startswith(r["name"] or "")]
                if hit:
                    r["name"] = min(hit, key=len)
        db.executemany(
            "INSERT OR REPLACE INTO board_fund_flow(trade_date,kind,code,name,change_percent,"
            "net_amount,in_amount,out_amount,net_ratio,turnover,leader_name,leader_change) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [(date, kind, r["code"], r["name"], r["avgChangePercent"], r["netAmount"],
              r["inAmount"], r["outAmount"], r["netRatio"], r["turnover"],
              r["leaderName"], r["leaderChangePercent"]) for r in rows])
        return {"rows": rows, "date": date, "error": None}

    data = _cached(f"boardflow:{kind}:{limit}", load)
    rows = data["rows"]
    net = sum(r["netAmount"] or 0 for r in rows)
    return {"kind": kind, "rows": rows[:limit], "total": len(rows),
            "sumNet": round(net / 1e8, 2), "date": data.get("date"),
            "top": rows[:limit // 4], "bottom": sorted(rows, key=lambda r: r["netAmount"] or 0)[:limit // 4],
            "error": data["error"], "generatedAt": db.now()}


def stock_flow(limit: int = 60, direction: str = "in") -> dict:
    def load():
        try:
            rows = sina.money_flow_stocks(max(limit, 60), desc=direction != "out")
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}
        date = registry.trade_date_hint()
        db.executemany(
            "INSERT OR REPLACE INTO stock_fund_flow(trade_date,symbol,name,price,change_percent,"
            "net_amount,in_amount,out_amount,net_ratio,turnover,amount) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [(date, r["symbol"], r["name"], r["price"], r["changePercent"], r["netAmount"],
              r["inAmount"], r["outAmount"], r["netRatio"], r["turnover"], r["amount"]) for r in rows])
        return {"rows": rows, "date": date, "error": None}

    data = _cached(f"stockflow:{direction}:{limit}", load)
    return {"rows": data["rows"][:limit], "direction": direction, "date": data.get("date"),
            "error": data["error"], "generatedAt": db.now()}


def stock_flow_daily(symbol: str, days: int = 20) -> dict:
    def load():
        try:
            return {"rows": sina.money_flow_stock(symbol, days)}
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}
    data = _cached(f"stockflowd:{symbol}:{days}", load)
    rows = list(reversed(data["rows"]))
    return {"symbol": symbol, "rows": rows, "error": data.get("error"),
            "cumNet": round(sum(r["mainNet"] or 0 for r in rows) / 1e8, 2)}


def market_flow() -> dict:
    """大盘资金概览：行业板块主力净流入合计 + 北向 + 两市成交额，全部本机可得的口径"""
    out: dict[str, Any] = {"errors": {}}
    try:
        boards = registry.board_fund_flow(fenlei=2, num=100)
        out["industryNet"] = round(sum(r["netAmount"] or 0 for r in boards) / 1e8, 2)
        out["inAmount"] = round(sum(r["inAmount"] or 0 for r in boards) / 1e8, 2)
        out["outAmount"] = round(sum(r["outAmount"] or 0 for r in boards) / 1e8, 2)
        out["boardCount"] = len(boards)
        out["boardTop"] = [
            {"name": r["name"], "net": round((r["netAmount"] or 0) / 1e8, 2),
             "change": r["avgChangePercent"], "leader": r["leaderName"]}
            for r in boards[:8]]
        out["boardBottom"] = [
            {"name": r["name"], "net": round((r["netAmount"] or 0) / 1e8, 2),
             "change": r["avgChangePercent"], "leader": r["leaderName"]}
            for r in sorted(boards, key=lambda x: x["netAmount"] or 0)[:8]]
    except ProviderError as exc:
        out["errors"]["board_fund_flow"] = exc.message
    try:
        north = registry.north_history(30)
        out["north"] = north[:10]
        # 2024 年 8 月起交易所停止披露北向净买入，接口字段大面积为空，只有数值时才汇总
        vals = [r.get("net") for r in north if isinstance(r.get("net"), (int, float))]
        if vals:
            out["northToday"] = vals[0]
            out["north5d"] = round(sum(vals[:5]) / 1e4, 2)  # 接口单位是万元
        else:
            out["northToday"] = None
            out["north5d"] = None
            out["northNote"] = "交易所已停止披露北向资金净买入额，仅保留交易日与额度字段"
    except ProviderError as exc:
        out["errors"]["north"] = exc.message
    daily = db.query_one("SELECT trade_date,total,up,down,limit_up,amount,score FROM market_daily "
                         "ORDER BY trade_date DESC LIMIT 1")
    out["daily"] = dict(daily) if daily else None
    prev = db.query_one("SELECT amount FROM market_daily ORDER BY trade_date DESC LIMIT 1 OFFSET 1")
    # market_daily.amount 已经是「亿」为单位，不再除一次
    if daily and prev and prev["amount"]:
        out["amountChange"] = round((daily["amount"] or 0) - prev["amount"], 2)
    out["generatedAt"] = db.now()
    return out
