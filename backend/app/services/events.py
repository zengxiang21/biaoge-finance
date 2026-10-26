"""并购重组事件追踪（拆解文档 3.10 / 路由 13）

东财没有公开的「并购重组专题」接口，这里用公告流做关键词扫描 + 落库累积：
每次扫描只增量入库，历史越攒越长，页面上的事件数会随使用时间增长。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from .. import db
from ..providers import registry
from ..providers.base import ProviderError

CORE_KW = ("并购", "重大资产重组", "资产重组", "资产置换", "发行股份购买资产",
           "吸收合并", "要约收购", "重组报告书", "重组预案", "收购")

# 从标题推断交易阶段，列表页要能一眼看到进度
STAGES = [
    ("终止", ("终止", "取消", "撤回", "否决", "未获", "放弃")),
    ("完成", ("实施完成", "过户完成", "完成工商变更", "注册生效", "无异议")),
    ("审核", ("问询", "上市委", "并购重组委", "注册", "核准", "受理", "反馈")),
    ("股东会是", ("股东大会", "暂停牌")),
    ("方案", ("预案", "草案", "报告书", "方案")),
    ("筹划", ("筹划", "停牌", "拟筹划", "正在筹划")),
]


def classify(title: str) -> tuple[str, list[str]]:
    text = title or ""
    hit = [k for k in CORE_KW if k in text]
    if not hit:
        return "", []
    stage = "公告"
    for name, keys in STAGES:
        if any(k in text for k in keys):
            stage = name
            break
    return stage, hit


def _store(items: list[dict], event_type: str) -> int:
    rows = []
    for it in items:
        if not it.get("id"):
            continue
        rows.append((str(it["id"])[:80], event_type, it.get("symbol"), it.get("name"),
                     it.get("title"), it.get("summary"), it.get("url"), it.get("date"),
                     json.dumps({"stage": it.get("stage"), "keywords": it.get("keywords") or []},
                                ensure_ascii=False), db.now()))
    if not rows:
        return 0
    db.executemany("INSERT OR REPLACE INTO event_item(id,event_type,symbol,name,title,summary,"
                   "url,date,extra,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", rows)
    return len(rows)


def scan_announcements(pages: int = 6) -> dict:
    """扫近 N 页全市场公告（每页 100 条），命中的并购重组事件入库"""
    errors: dict[str, str] = {}
    scanned = 0
    picked: dict[str, dict] = {}
    for page in range(1, max(1, min(pages, 20)) + 1):
        try:
            rows = registry.announcements(size=100, page=page)
        except ProviderError as exc:
            errors["announcements"] = exc.message
            break
        if not rows:
            break
        scanned += len(rows)
        for r in rows:
            stage, kws = classify(r.get("title") or "")
            if not kws or not r.get("id"):
                continue
            picked[f"ann:{r['id']}"] = {
                "id": f"ann:{r['id']}", "symbol": r.get("symbol"),
                "name": r.get("stockName"), "title": r.get("title"),
                "summary": "；".join(c for c in (r.get("columns") or []) if c)[:120],
                "url": r.get("url"), "date": (r.get("time") or "")[:19],
                "stage": stage, "keywords": kws,
            }
    items = list(picked.values())
    inserted = _store(items, "merger")
    return {"scanned": scanned, "matched": len(items), "inserted": inserted,
            "pages": pages, "errors": errors}


def scan_news(days: int = 3) -> dict:
    """本地快讯缓存里已经提到的并购事件一并收进事件表，避免只靠公告"""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    rows = [dict(r) for r in db.query(
        "SELECT id,source,title,summary,url,time FROM news_item WHERE created_at>? AND "
        "(title LIKE '%重组%' OR title LIKE '%并购%' OR title LIKE '%收购%' OR title LIKE '%资产置换%')",
        (since,))]
    picked = []
    for r in rows:
        stage, kws = classify(r.get("title") or "")
        if not kws:
            continue
        picked.append({"id": f"news:{r['id']}", "symbol": None, "name": None,
                       "title": r.get("title"), "summary": (r.get("summary") or "")[:200],
                       "url": r.get("url"), "date": r.get("time"),
                       "stage": stage, "keywords": kws})
    return {"matched": len(picked), "inserted": _store(picked, "merger_news")}


def refresh(pages: int = 6) -> dict:
    """快讯 → 事件表，公告流 → 事件表；调度任务和管理页都走这里"""
    from . import info
    out: dict = {"news": {}, "announcements": {}}
    try:
        n = info.refresh_news(120)
        out["news"]["fetched"] = n
    except Exception as exc:  # noqa: BLE001
        out["news"]["error"] = f"{type(exc).__name__}: {exc}"[:160]
    out["news"].update(scan_news())
    out["announcements"].update(scan_announcements(pages))
    out["total"] = db.query_one("SELECT COUNT(*) c FROM event_item")["c"]
    out["at"] = db.now()
    return out


def list_events(keyword: str = "", days: int = 90, limit: int = 200,
                stage: str = "", symbol: str = "") -> dict:
    where, params = ["1=1"], []
    if days:
        where.append("date >= ?")
        params.append((datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d"))
    if keyword:
        where.append("(title LIKE ? OR summary LIKE ? OR name LIKE ?)")
        like = f"%{keyword}%"
        params += [like, like, like]
    if symbol:
        where.append("symbol = ?")
        params.append(symbol)
    rows = [dict(r) for r in db.query(
        f"SELECT * FROM event_item WHERE {' AND '.join(where)} "
        f"ORDER BY date DESC LIMIT ?", (*params, min(limit, 500)))]
    out = []
    for r in rows:
        try:
            extra = json.loads(r.get("extra") or "{}")
        except json.JSONDecodeError:
            extra = {}
        r["stage"] = extra.get("stage") or "公告"
        r["keywords"] = extra.get("keywords") or []
        if stage and r["stage"] != stage:
            continue
        out.append(r)
    stages: dict[str, int] = {}
    stocks: dict[str, int] = {}
    for r in out:
        stages[r["stage"]] = stages.get(r["stage"], 0) + 1
        key = f"{r.get('name') or r.get('symbol') or '市场级'}"
        stocks[key] = stocks.get(key, 0) + 1
    return {"rows": out, "total": len(out),
            "stored": db.query_one("SELECT COUNT(*) c FROM event_item")["c"],
            "stages": stages,
            "topStocks": sorted(({"name": k, "count": v} for k, v in stocks.items()),
                                key=lambda x: -x["count"])[:10],
            "keyword": keyword, "stage": stage, "days": days,
            "generatedAt": db.now()}
