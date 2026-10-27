"""每日复盘 /reviews/*：收盘后汇总 10 个板块的结构化报告，可定时生成并邮件推送（拆解文档 3.15）"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .. import db
from ..providers import registry
from ..providers.base import ProviderError
from . import ai, anomaly, info, market, notify

SECTIONS = ["指数快照", "涨跌统计", "情绪评分", "行业板块", "自选股专项", "策略命中",
            "今日核心观点", "作战计划", "市场快讯", "明日操作指南"]


def schedule_config() -> dict:
    cfg = db.get_setting("review_schedule", {}) or {}
    smtp = notify.smtp_config()
    return {**{"enabled": False, "time": "15:45", "weekday_only": True, "email_to": [],
               "autoAi": True}, **cfg,
            "emailReady": notify.email_ready(smtp),
            "smtp": {"host": smtp["host"], "port": smtp["port"], "use_ssl": smtp["use_ssl"],
                     "user": smtp["user"], "from_mail": smtp["from_mail"],
                     "hasPassword": bool(smtp["password"])}}


def save_schedule(body: dict) -> dict:
    cur = db.get_setting("review_schedule", {}) or {}
    out = dict(cur)
    if "enabled" in body:
        out["enabled"] = bool(body["enabled"])
    if "autoAi" in body:
        out["autoAi"] = bool(body["autoAi"])
    t = str(body.get("time") or "").strip()
    if t:
        out["time"] = t if len(t) == 5 else t[:5]
    if "weekday_only" in body:
        out["weekday_only"] = bool(body["weekday_only"])
    if "email_to" in body:
        raw = body["email_to"]
        if isinstance(raw, str):
            raw = [x for x in raw.replace("；", ";").replace(",", ";").split(";")]
        out["email_to"] = list(dict.fromkeys(x.strip() for x in raw if str(x).strip()))
    db.set_setting("review_schedule", out)
    _save_smtp(body.get("smtp") or {})
    return schedule_config()


def _save_smtp(raw: dict) -> None:
    """授权码只写不读：前端不回显密码，留空即保持原值"""
    if not isinstance(raw, dict) or not raw:
        return
    cur = notify.smtp_config()
    nxt = dict(cur)
    for key in ("host", "user", "from_mail"):
        if raw.get(key):
            nxt[key] = str(raw[key]).strip()
    if raw.get("port"):
        nxt["port"] = int(raw["port"])
    if "use_ssl" in raw:
        nxt["use_ssl"] = bool(raw["use_ssl"])
    pwd = str(raw.get("password") or "").strip()
    if pwd:
        nxt["password"] = pwd
    db.set_setting("smtp", nxt)


# ---------------------------------------------------------------- 数据汇总
def _indexes() -> list[dict]:
    try:
        rows = registry.index_quotes()
    except ProviderError:
        return []
    out = []
    for r in rows:
        sym = str(r.get("symbol") or "")
        if not sym.startswith(("sh", "sz")):
            continue
        amount = r.get("amount")
        out.append({"symbol": sym, "name": r.get("label") or r.get("name"),
                    "close": r.get("price"), "changePercent": r.get("change_percent"),
                    # 指数的成交额接口给的是元，统一换成「亿」再入库
                    "amount": round(amount / 1e8, 2) if isinstance(amount, (int, float)) else None})
    return out


def _watchlist(user_id: int) -> list[dict]:
    items = [dict(r) for r in db.query(
        "SELECT * FROM watchlist_items WHERE user_id=? ORDER BY id", (user_id,))]
    if not items:
        return []
    quotes = {q["symbol"]: q for q in market_live([i["symbol"] for i in items])}
    out = []
    for i in items:
        q = quotes.get(i["symbol"], {})
        out.append({**i, "price": q.get("price"), "changePercent": q.get("change_percent"),
                    "amount": q.get("amount")})
    return out


def market_live(symbols: list[str]) -> list[dict]:
    try:
        return registry.realtime(symbols)
    except ProviderError:
        return []


def _iso(date: str) -> str:
    s = str(date or "").replace("-", "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else str(date or "")[:10]


def _strategy_hits(date: str) -> list[dict]:
    day = _iso(date)
    rows = db.query(
        "SELECT r.id,r.strategy_id,r.pick_count,r.candidate_count,r.universe_count,r.status,"
        "r.finished_at,s.name,s.direction FROM strategy_run r JOIN strategy s ON s.id=r.strategy_id "
        "WHERE date(r.started_at)=? ORDER BY r.pick_count DESC, r.id DESC LIMIT 40", (day,))
    if rows:
        return [dict(r) for r in rows]
    # 复盘当天没跑过策略就取最近一次运行结果，并把口径标出来，比空表有用
    rows = db.query(
        "SELECT r.id,r.strategy_id,r.pick_count,r.candidate_count,r.universe_count,r.status,"
        "r.finished_at,s.name,s.direction FROM strategy_run r JOIN strategy s ON s.id=r.strategy_id "
        "ORDER BY r.id DESC LIMIT 12")
    out = [dict(r) for r in rows]
    for r in out:
        r["recentOnly"] = True
    return out


def collect(user_id: int, date: str | None = None) -> dict:
    date = date or registry.trade_date_hint()
    daily = market.latest_daily()
    sector = {}
    try:
        sector = info.sector_flow("industry", 60)
    except Exception as exc:  # noqa: BLE001 — 板块资金流挂了不影响整份复盘
        sector = {"rows": [], "error": str(exc)}
    rows = sector.get("rows") or []
    by_chg = sorted(rows, key=lambda r: r.get("avgChangePercent") or 0, reverse=True)
    payload = {
        "date": _iso(date),
        "indexes": _indexes(),
        "breadth": daily or {},
        "sentiment": {"score": (daily or {}).get("score"),
                      "dims": {k: v for k, v in ((daily or {}).get("dims") or {}).items()
                               if isinstance(v, (int, float))},
                      "labels": {k[:-len("Label")]: v for k, v in
                                 ((daily or {}).get("dims") or {}).items()
                                 if k.endswith("Label")},
                      "label": _sentiment_label((daily or {}).get("score"))},
        "sectors": {"leading": by_chg[:6], "lagging": list(reversed(by_chg[-6:])),
                    "netTop": rows[:6], "error": sector.get("error")},
        "watchlist": _watchlist(user_id),
        "strategies": _strategy_hits(date),
        "anomaly": anomaly.summary(24),
        "fundFlow": {k: v for k, v in _safe_market_flow().items()
                     if k in ("industryNet", "inAmount", "outAmount", "amountChange",
                              "northToday", "northNote", "daily")},
        "news": _news(12),
    }
    ai_part = _ai_section(payload) if schedule_config().get("autoAi", True) else {"skipped": True}
    payload.update(ai_part)
    return payload


def _safe_market_flow() -> dict:
    try:
        return info.market_flow()
    except Exception:  # noqa: BLE001
        return {}


def _news(size: int) -> list[dict]:
    try:
        rows = registry.news_flash(size)
    except ProviderError:
        return []
    return [{"time": r.get("time"), "title": r.get("title"), "source": r.get("source")}
            for r in rows[:size]]


def _sentiment_label(score: Any) -> str:
    if score is None:
        return "无数据"
    s = float(score)
    return "冰点" if s < 20 else "偏弱" if s < 40 else "中性" if s < 60 else "偏强" if s < 80 else "亢奋"


# ---------------------------------------------------------------- AI 段落
AI_SYSTEM = ("你是 A 股盘后复盘助手，只根据给出的数据摘要写结论，不编造具体数字，"
             "不做个股推荐承诺，语言克制专业，用中文短句。")


def _digest(p: dict) -> str:
    b = p.get("breadth") or {}
    idx = "，".join(f"{r['name']} {r['close']}（{r['changePercent']}%）"
                    for r in (p.get("indexes") or [])[:6])
    lead = "、".join(f"{r['name']}{r['avgChangePercent']}%" for r in (p.get('sectors') or {}).get('leading') or [])
    lag = "、".join(f"{r['name']}{r['avgChangePercent']}%" for r in (p.get('sectors') or {}).get('lagging') or [])
    hits = "；".join(f"{r['name']}命中{r['pick_count']}只" for r in (p.get('strategies') or [])[:8])
    an = p.get("anomaly") or {}
    return (f"交易日 {p.get('date')}\n指数：{idx or '无'}\n"
            f"上涨 {b.get('up')} 家 / 下跌 {b.get('down')} 家 / 涨停 {b.get('limit_up')} 家 / "
            f"跌停 {b.get('limit_down')} 家 / 成交额 {b.get('amount')} 亿\n"
            f"情绪分 {p.get('sentiment', {}).get('score')}（{p.get('sentiment', {}).get('label')}）\n"
            f"领涨行业：{lead or '无'}；领跌行业：{lag or '无'}\n"
            f"板块主力净流入合计 {p.get('fundFlow', {}).get('industryNet')} 亿\n"
            f"异动事件 {an.get('total')} 起\n策略信号：{hits or '今日无运行记录'}")


def _ai_section(p: dict) -> dict:
    """核心观点 + 作战计划 + 明日指南：AI 不可用时退回规则文本，复盘不能因此开天窗"""
    prompt = f"""请基于以下数据摘要输出三段，标题严格用【核心观点】【作战计划】【明日指南】，每段 2-4 句：

{_digest(p)}

要求：核心观点只讲市场结构与情绪；作战计划给看多方向与看空方向（行业或风格，不提个股买卖点）；
明日指南给观察项与仓位建议区间。不要输出免责声明。"""
    try:
        res = ai.chat([{"role": "system", "content": AI_SYSTEM},
                       {"role": "user", "content": prompt}], purpose="daily_review")
        text = str(res.get("content") or "").strip()
        return {"coreView": _pick(text, "核心观点"), "plan": _plan(text),
                "tomorrow": _pick(text, "明日指南"), "aiModel": res.get("model"),
                "aiMs": res.get("latencyMs")}
    except Exception as exc:  # noqa: BLE001 — Ollama 没起也要能出报告
        return {"coreView": _fallback_view(p), "plan": _fallback_plan(p),
                "tomorrow": _fallback_tomorrow(p), "aiError": f"{type(exc).__name__}: {exc}"}


def _pick(text: str, key: str) -> str:
    import re
    m = re.search(rf"【{key}】(.*?)(?=【|$)", text, re.S)
    return (m.group(1) if m else text).strip()[:600]


def _plan(text: str) -> dict:
    body = _pick(text, "作战计划")
    import re
    def grab(labels: tuple[str, ...]) -> str:
        m = re.search(rf"(?:{'|'.join(labels)})[:：]?\s*(.+?)(?=(?:看空|看多|观望)|$)", body, re.S)
        return m.group(1).strip()[:220] if m else ""
    return {"long": grab(("看多", "多头", "偏多")), "short": grab(("看空", "空头", "回避")),
            "raw": body[:600]}


def _fallback_view(p: dict) -> str:
    b = p.get("breadth") or {}
    up, down = b.get("up") or 0, b.get("down") or 0
    tone = "普涨" if up > down * 2 else "普跌" if down > up * 2 else "涨跌互现"
    return (f"{tone}：上涨 {up} 家、下跌 {down} 家，涨停 {b.get('limit_up')} 家，"
            f"情绪分 {p.get('sentiment', {}).get('score')}（{p.get('sentiment', {}).get('label')}）。"
            f"AI 引擎不可用，本段为规则文本。")


def _fallback_plan(p: dict) -> dict:
    s = p.get("sectors") or {}
    return {"long": "、".join(r["name"] for r in (s.get("leading") or [])[:3]) or "无",
            "short": "、".join(r["name"] for r in (s.get("lagging") or [])[:3]) or "无",
            "raw": "AI 引擎不可用，看多/看空直接取当日领涨领跌行业"}


def _fallback_tomorrow(p: dict) -> str:
    ff = p.get("fundFlow") or {}
    net = ff.get("industryNet")
    return (f"重点看主力资金是否延续（当日行业板块净流入 {net} 亿）与涨停梯队高度是否抬升；"
            f"AI 引擎不可用，本段为规则文本。")


# ---------------------------------------------------------------- Markdown
def to_markdown(p: dict) -> str:
    b = p.get("breadth") or {}
    ff = p.get("fundFlow") or {}
    s = p.get("sectors") or {}
    an = p.get("anomaly") or {}
    lines = [f"# 每日复盘 · {p.get('date')}", ""]
    lines += ["## 1. 指数快照", ""]
    if p.get("indexes"):
        lines.append("| 指数 | 收盘 | 涨跌幅 |")
        lines.append("| --- | --- | --- |")
        for r in p["indexes"]:
            close = round(r["close"], 2) if isinstance(r.get("close"), (int, float)) else r.get("close")
            lines.append(f"| {r['name']} | {close} | {r['changePercent']}% |")
    else:
        lines.append("指数行情取数失败。")
    amount_delta = (f"{ff.get('amountChange')} 亿" if isinstance(ff.get("amountChange"), (int, float))
                    else f"环比 {b.get('amount_vs_prev')}%" if b.get("amount_vs_prev") is not None
                    else "无对比数据")
    lines += ["", "## 2. 涨跌统计", "",
              f"- 上涨 {b.get('up')} 家 / 下跌 {b.get('down')} 家 / 平盘 {b.get('flat')} 家",
              f"- 涨停 {b.get('limit_up')} 家 / 跌停 {b.get('limit_down')} 家 / 炸板 {b.get('blown')} 家",
              f"- 两市成交额 {b.get('amount')} 亿，较上一日 {amount_delta}",
              f"- 板块主力净流入 {ff.get('industryNet')} 亿（流入 {ff.get('inAmount')} / 流出 {ff.get('outAmount')}）",
              ff.get("northNote") and f"- 北向：{ff.get('northNote')}" or
              f"- 北向今日 {ff.get('northToday')} 亿",
              "", "## 3. 情绪评分", "",
              f"综合情绪 {p.get('sentiment', {}).get('score')} 分（{p.get('sentiment', {}).get('label')}）。"]
    senti = p.get("sentiment") or {}
    dims = senti.get("dims") or {}
    if dims:
        labels = senti.get("labels") or {}
        lines.append("")
        lines.append("| 维度 | 得分 |")
        lines.append("| --- | --- |")
        for k, v in dims.items():
            lines.append(f"| {labels.get(k) or k} | {v} |")
    lines += ["", "## 4. 行业板块", ""]
    for label, key in (("领涨", "leading"), ("领跌", "lagging")):
        rows = s.get(key) or []
        lines.append(f"- {label}：" + ("、".join(f"{r['name']} {r['avgChangePercent']}%" for r in rows)
                                     or "无"))
    lines += ["", "## 5. 自选股专项", ""]
    if p.get("watchlist"):
        lines.append("| 名称 | 代码 | 现价 | 涨跌幅 |")
        lines.append("| --- | --- | --- | --- |")
        for r in p["watchlist"]:
            lines.append(f"| {r.get('name')} | {r.get('symbol')} | {r.get('price')} | "
                         f"{r.get('changePercent')}% |")
    else:
        lines.append("自选股为空。")
    lines += ["", "## 6. 策略命中", ""]
    if p.get("strategies"):
        lines.append("| 策略 | 状态 | 命中 | 完成时间 |")
        lines.append("| --- | --- | --- | --- |")
        for r in p["strategies"]:
            lines.append(f"| {r['name']} | {r['status']} | {r['pick_count']} | {r['finished_at']} |")
    else:
        lines.append("当日没有策略运行记录，去策略列表跑一次再复盘。")
    lines += ["", "## 7. 今日核心观点", "", p.get("coreView") or "（未生成）", "",
              "## 8. 作战计划", "",
              f"- 看多：{(p.get('plan') or {}).get('long') or '无'}",
              f"- 看空：{(p.get('plan') or {}).get('short') or '无'}"]
    if an.get("total"):
        lines += ["", f"当日异动事件 {an.get('total')} 起，涉及 {an.get('symbols')} 只。"]
    lines += ["", "## 9. 市场快讯", ""]
    for n in (p.get("news") or [])[:10]:
        lines.append(f"- {n.get('time')} {n.get('title')}（{n.get('source')}）")
    if not p.get("news"):
        lines.append("快讯取数失败。")
    lines += ["", "## 10. 明日操作指南", "", p.get("tomorrow") or "（未生成）", "",
              f"> 复盘引擎 {p.get('aiModel') or '规则文本'}；数据来自新浪/东财公开接口，仅供研究参考。"]
    return "\n".join(lines)


# ---------------------------------------------------------------- 存取
def generate(user_id: int, date: str | None = None) -> dict:
    p = collect(user_id, date)
    md = to_markdown(p)
    day = str(p.get("date") or "")[:10]
    db.execute("DELETE FROM review_report WHERE user_id=? AND trade_date=?", (user_id, day))
    rid = db.execute("INSERT INTO review_report(user_id,trade_date,market,payload,markdown,score,"
                     "emailed,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (user_id, day, "a_share", json.dumps(p, ensure_ascii=False, default=str),
                      md, (p.get("sentiment") or {}).get("score"), 0, db.now()))
    return {"id": rid, "date": day, "score": (p.get("sentiment") or {}).get("score"),
            "markdown": md, "payload": p, "aiError": p.get("aiError")}


def list_reports(user_id: int, limit: int = 60) -> list[dict]:
    rows = db.query("SELECT id,trade_date,market,score,emailed,created_at,length(markdown) len "
                    "FROM review_report WHERE user_id=? ORDER BY trade_date DESC, id DESC LIMIT ?",
                    (user_id, limit))
    return [dict(r) for r in rows]


def get_report(user_id: int, report_id: int) -> dict | None:
    r = db.query_one("SELECT * FROM review_report WHERE id=? AND user_id=?", (report_id, user_id))
    if not r:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"] or "{}")
    d["sections"] = SECTIONS
    return d


def delete_report(user_id: int, report_id: int) -> bool:
    return bool(db.execute("DELETE FROM review_report WHERE id=? AND user_id=?",
                           (report_id, user_id)))


def send_now(user_id: int, date: str | None = None) -> dict:
    cfg = schedule_config()
    rep = generate(user_id, date)
    to = cfg.get("email_to") or []
    res = notify.send_email(f"每日复盘 {rep['date']}", rep["markdown"], to, html=False)
    db.execute("UPDATE review_report SET emailed=? WHERE id=?",
               (1 if res["ok"] else 0, rep["id"]))
    db.execute("INSERT INTO notification(user_id,channel,title,body,status,reason,created_at) "
               "VALUES(?,?,?,?,?,?,?)",
               (user_id, "email", f"每日复盘 {rep['date']}",
                f"收件人 {len(to) or 'SMTP 默认'} 个；{res['reason']}", res["status"],
                res["reason"], db.now()))
    return {"ok": res["ok"], "status": res["status"], "reason": res["reason"],
            "reportId": rep["id"], "date": rep["date"], "recipients": to,
            "emailReady": notify.email_ready()}


def test_email(user_id: int, to: list[str] | None = None) -> dict:
    cfg = schedule_config()
    res = notify.send_email("曾老师 · 邮件通道测试",
                            "这是一封测试邮件，收到即说明 SMTP 配置可用。",
                            to or cfg.get("email_to") or [])
    return res


def run_scheduled() -> dict:
    """APScheduler 到点调用：给第一个账号生成并按配置发送"""
    cfg = schedule_config()
    user = db.query_one("SELECT id FROM users ORDER BY id LIMIT 1")
    if not user or not cfg.get("enabled"):
        return {"ok": False, "note": "定时复盘未启用"}
    out = send_now(user["id"])
    db.audit(user["id"], "review:scheduled", out.get("date") or "")
    return out
