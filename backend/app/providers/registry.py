"""Provider 路由：同一能力的主备切换 + 数据源矩阵健康状态"""
from __future__ import annotations

from datetime import datetime, timedelta

from .. import db
from . import eastmoney, external, legulegu, sina, tencent
from .base import ProviderError, call_chain, norm_symbol, provider_enabled

# 能力 -> [(provider, 说明)]，按顺序尝试
CAPABILITIES: dict[str, dict] = {
    "index": {"label": "指数实时行情", "chain": ["sina", "tencent"]},
    "realtime": {"label": "个股实时行情", "chain": ["sina", "tencent"]},
    "spot": {"label": "全市场快照/排行", "chain": ["sina"]},
    "kline_daily": {"label": "日线K线", "chain": ["sina", "eastmoney"]},
    "kline_minute": {"label": "分钟K线", "chain": ["sina", "eastmoney"]},
    "minute_trend": {"label": "分时走势", "chain": ["tencent", "eastmoney"]},
    "board_industry": {"label": "行业板块", "chain": ["sina"]},
    "board_concept": {"label": "概念板块", "chain": ["sina"]},
    "limit_up_pool": {"label": "涨停池", "chain": ["eastmoney"]},
    "blown_pool": {"label": "炸板池", "chain": ["eastmoney"]},
    "limit_down_pool": {"label": "跌停池", "chain": ["eastmoney"]},
    "global_index": {"label": "全球指数/汇率/期货", "chain": ["sina"]},
    "fear_index": {"label": "恐慌指数 VIX", "chain": ["cboe", "tencent"]},
    "fear_index_history": {"label": "VIX 历史日线", "chain": ["cboe"]},
    "fund_flow_board": {"label": "板块资金流", "chain": ["sina"]},
    "fund_flow_stock": {"label": "个股资金流排行", "chain": ["sina"]},
    "news_flash": {"label": "7x24 快讯", "chain": ["eastmoney"]},
    "news_roll": {"label": "滚动新闻", "chain": ["sina"]},
    "announcement": {"label": "个股公告", "chain": ["eastmoney"]},
    "billboard": {"label": "龙虎榜", "chain": ["eastmoney"]},
    "billboard_seats": {"label": "龙虎榜席位", "chain": ["eastmoney"]},
    "finance_main": {"label": "个股财务摘要", "chain": ["eastmoney"]},
    "performance": {"label": "业绩报表", "chain": ["eastmoney"]},
    "holders": {"label": "十大流通股东", "chain": ["eastmoney"]},
    "org_survey": {"label": "机构调研", "chain": ["eastmoney"]},
    "holder_change": {"label": "股东增减持", "chain": ["eastmoney"]},
    "lockup": {"label": "限售解禁", "chain": ["eastmoney"]},
    "north_fund": {"label": "北向资金", "chain": ["eastmoney"]},
    "hot_rank": {"label": "东财人气榜", "chain": ["eastmoney"]},
    "hot_search": {"label": "社会财经热搜", "chain": ["baidu", "weibo"]},
    "index_component": {"label": "指数成分股", "chain": ["eastmoney"]},
    "index_valuation": {"label": "宽基指数估值历史", "chain": ["legulegu"]},
    "market_valuation": {"label": "两市整体估值历史", "chain": ["legulegu"]},
}

PROVIDER_LABELS = {"sina": "新浪财经", "eastmoney": "东方财富", "tencent": "腾讯行情",
                   "baidu": "百度热搜", "weibo": "微博热搜", "cboe": "CBOE 期权交易所",
                   "legulegu": "乐咕乐股（估值历史）",
                   "router": "内部路由"}


def index_quotes() -> list[dict]:
    return call_chain("index", [
        ("sina", sina.index_quotes),
        ("tencent", lambda: [
            {**q, "label": dict(sina.CORE_INDEXES).get(q["symbol"], q["name"])}
            for q in tencent.batch_quotes([s for s, _ in sina.CORE_INDEXES], "index")
        ]),
    ])


def realtime(symbols: list[str]) -> list[dict]:
    normed = [norm_symbol(s)["symbol"] for s in symbols]
    return call_chain("realtime", [
        ("sina", lambda: sina.realtime(normed)),
        ("tencent", lambda: tencent.batch_quotes(normed)),
    ])


def spot_ranking(sort: str, desc: bool = True, num: int = 30) -> list[dict]:
    return sina.spot_ranking(sort, desc, num)


def kline_daily(symbol: str, days: int = 120) -> list[dict]:
    return call_chain("kline_daily", [
        ("sina", lambda: sina.kline_daily(symbol, days)),
        ("eastmoney", lambda: eastmoney.kline_daily(symbol, days)),
    ])


def minute_trend(symbol: str) -> list[dict]:
    """东财分时带均价，但本机实测 push2his 一直 502，所以主源换成腾讯，东财留作备源"""
    return call_chain("minute_trend", [
        ("tencent", lambda: tencent.minute_trend(symbol)),
        ("eastmoney", lambda: eastmoney.minute_trend(symbol)),
    ])


def boards(kind: str = "industry") -> list[dict]:
    return sina.board_list(kind)


# ---------------------------------------------------------------- 新增能力包装
def global_quotes(group: str = "index") -> list[dict]:
    codes = [c for c, _n, _g in sina.GLOBAL_INDEXES] if group == "index" else \
        [c for c, _n, _g in sina.COMMODITIES]
    return sina.global_quotes(codes, f"global_{group}")


def commodity_quotes() -> list[dict]:
    return sina.global_quotes([c for c, _n, _g in sina.COMMODITIES], "commodity")


def fear_index() -> dict:
    """恐慌指数现价：CBOE 官方为主源，腾讯备源可能滞后（界面会显示报价时间）"""
    return call_chain("fear_index", [
        ("cboe", external.cboe_vix),
        ("tencent", tencent.vix_quote),
    ])


def fear_index_history(rows: int = 120) -> list[dict]:
    return call_chain("fear_index_history", [("cboe", lambda: external.cboe_vix_history(rows))])


def board_fund_flow(fenlei: int = 2, num: int = 60) -> list[dict]:
    return sina.money_flow_boards(fenlei, num)


def stock_fund_flow(num: int = 60) -> list[dict]:
    return sina.money_flow_stocks(num)


def news_flash(size: int = 50) -> list[dict]:
    return call_chain("news_flash", [("eastmoney", lambda: eastmoney.fast_news(size))])


def news_roll(num: int = 50) -> list[dict]:
    return call_chain("news_roll", [("sina", lambda: sina.roll_news(2516, num))])


def announcements(size: int = 50, stock_code: str = "", page: int = 1) -> list[dict]:
    return eastmoney.announcements(size=size, stock_code=stock_code, page=page)


def hot_search(num: int = 30) -> dict:
    return external.finance_hot(num)


def hot_rank(size: int = 100) -> list[dict]:
    return eastmoney.hot_rank(size)


def billboard(date_iso: str | None = None) -> list[dict]:
    return call_chain("billboard", [
        ("eastmoney", lambda: eastmoney.billboard(date_iso))])


def billboard_seats(days: int = 5) -> list[dict]:
    """近 N 个自然日的龙虎榜席位明细（含机构专用标记）"""
    out: list[dict] = []
    d = datetime.now()
    for i in range(days):
        day = (d - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            rows = eastmoney.billboard_seats(day)
        except ProviderError:
            continue
        for r in rows or []:
            r.setdefault("date", day)
            out.append(r)
    return out


def holder_changes(days: int = 30) -> list[dict]:
    return call_chain("holder_change", [
        ("eastmoney", lambda: eastmoney.holder_changes(days))])


def lockup(days: int = 30) -> list[dict]:
    return call_chain("lockup", [("eastmoney", lambda: eastmoney.lockup_expiry(days))])


def org_survey(days: int = 30, code: str = "") -> list[dict]:
    return call_chain("org_survey", [("eastmoney", lambda: eastmoney.org_survey(days, code=code))])


def north_history(size: int = 30) -> list[dict]:
    return call_chain("north_fund", [("eastmoney", lambda: eastmoney.north_history(size))])


def fund_flow_stocks(num: int = 60) -> list[dict]:
    return sina.money_flow_stocks(num)


def performance(code: str) -> list[dict]:
    return eastmoney.performance_report(code)


def f10(secucode: str) -> list[dict]:
    return eastmoney.f10_main(secucode)


def top_holders(secucode: str) -> list[dict]:
    return eastmoney.top_holders(secucode)


def index_components(type_code: str) -> list[dict]:
    return call_chain("index_component", [
        ("eastmoney", lambda: eastmoney.index_components(type_code))])


def index_valuation(code: str) -> list[dict]:
    """宽基指数长历史估值：PE 与 PB 两条接口按日期合并，只保留两者都算得出的口径字段"""
    rows = call_chain("index_valuation", [("legulegu", lambda: legulegu.index_pe(code))])
    if not rows:
        return []
    try:
        pb_rows = legulegu.index_pb(code)
    except ProviderError:
        pb_rows = []      # PB 挂了不影响 PE，界面按缺值显示
    by_date = {r["date"]: r for r in pb_rows}
    for r in rows:
        hit = by_date.get(r["date"])
        r["pb"] = hit["pb"] if hit else None
        r["pb_quantile"] = hit["pb_quantile"] if hit else None
    return rows


def market_valuation(market_id: str) -> list[dict]:
    """市场口径估值：PE 用各自的接口，PB 统一用 index-basic-pb（把市场编号当 indexCode）"""
    rows = call_chain("market_valuation", [("legulegu", lambda: legulegu.market_pe(market_id))])
    if not rows:
        return []
    try:
        pb_rows = legulegu.market_pb(market_id)
    except ProviderError:
        pb_rows = []      # PB 挂了不影响 PE，界面按缺值显示
    by_date = {r["date"]: r for r in pb_rows}
    for r in rows:
        hit = by_date.get(r["date"])
        r["pb"] = hit["pb"] if hit else None
        r["pb_quantile"] = hit["pb_quantile"] if hit else None
    return rows


def trade_date_hint(today: datetime | None = None) -> str:
    """收盘快照归属的交易日：优先最近一次成功建快照的日期，否则回看 7 天找交易日"""
    row = db.query_one("SELECT trade_date FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    if row:
        return row["trade_date"]
    d = today or datetime.now()
    for _ in range(10):
        if d.weekday() < 5:
            return d.strftime("%Y%m%d")
        d -= timedelta(days=1)
    return datetime.now().strftime("%Y%m%d")


def limit_pools(date: str) -> dict:
    """涨停/炸板/跌停三池，单源失败不影响其它"""
    out = {"limit_up": [], "blown": [], "limit_down": [], "counts": {}, "errors": {}}
    for key, fn, label in (("limit_up", eastmoney.limit_up_pool, "limit_up_pool"),
                           ("blown", eastmoney.blown_pool, "blown_pool"),
                           ("limit_down", eastmoney.limit_down_pool, "limit_down_pool")):
        if not provider_enabled("eastmoney"):
            out["errors"][label] = "eastmoney 已停用"
            continue
        try:
            out[key] = fn(date)
        except ProviderError as exc:
            out["errors"][label] = exc.message
    counts = {k: len(out[k]) for k in ("limit_up", "blown", "limit_down")}
    # 跌停池带 fbt 排序时会返回条数但空列表，用接口给的 tc 兜底
    if 0 in counts.values():
        try:
            tc = eastmoney.pool_counts(date)
            for k, v in tc.items():
                if not counts[k] and v:
                    counts[k] = int(v)
        except ProviderError as exc:
            out["errors"]["pool_counts"] = exc.message
    out["counts"] = counts
    return out


def matrix() -> list[dict]:
    """数据源矩阵页 + /system/data-sources 用"""
    cfg = db.get_setting("data_sources", {}) or {}
    rows = {f"{r['provider']}|{r['capability']}": r for r in db.query(
        "SELECT * FROM provider_health")}
    out = []
    for cap, meta in CAPABILITIES.items():
        for provider in meta["chain"]:
            r = rows.get(f"{provider}|{cap}")
            enabled = bool((cfg.get(provider) or {}).get("enabled", True))
            probed = bool((cfg.get(provider) or {}).get("probed"))
            out.append({
                "capability": cap, "capabilityLabel": meta["label"],
                "provider": provider, "providerLabel": PROVIDER_LABELS.get(provider, provider),
                "priority": meta["chain"].index(provider) + 1,
                "enabled": enabled,
                "status": "unknown" if r is None else ("ok" if r["ok"] else "error"),
                "latencyMs": r["latency_ms"] if r else None,
                "httpStatus": r["http_status"] if r else None,
                "error": r["error"] if r else None,
                "checkedAt": r["checked_at"] if r else None,
                "hits": r["hits"] if r else 0,
                "fails": r["fails"] if r else 0,
                "probed": probed,
            })
    return out


def summary() -> dict:
    items = matrix()
    ok = sum(1 for i in items if i["status"] == "ok")
    err = sum(1 for i in items if i["status"] == "error")
    probed = ok + err
    return {
        "total": len(items), "ok": ok, "error": err, "unknown": len(items) - probed,
        # 未探测过的能力不计入健康度，否则刚启动时数字永远是低的
        "healthy": round(ok / probed * 100, 1) if probed else None,
        "lastCheck": max((i["checkedAt"] for i in items if i["checkedAt"]), default=None),
        "providers": [
            {"provider": p, "label": PROVIDER_LABELS[p],
             **{k: v for k, v in (db.get_setting("data_sources", {}) or {}).get(p, {}).items() if k != "api_key"}}
            for p in ("sina", "eastmoney", "tencent", "baidu", "weibo", "cboe", "legulegu")
        ],
    }
