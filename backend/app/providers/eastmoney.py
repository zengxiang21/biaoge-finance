"""东方财富 Provider：涨停/炸板/跌停池、K线、分时、7x24快讯、数据中心报表、公告、人气榜

注意：本机网络实测下 `push2.eastmoney.com`（实时列表/资金流字段）被 TLS 中间设备掐断，
可用的是 `push2ex`（涨跌停池）、`datacenter-web`（报表）、`np-listapi`（快讯）、
`np-anotice-stock`（公告）、`emappdata`（人气榜）；`push2his` 的 K线/分时也在本机 502。
文档里把东财排为主源，本实现按实测把实时快照主源换成新浪、分时交给腾讯。
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

from .base import ProviderError, fetch, norm_symbol, post_json

P = "eastmoney"
REFERER = "http://quote.eastmoney.com/"
EX = "http://push2ex.eastmoney.com"
HIS = "http://push2his.eastmoney.com"
UT = "7eea3edcaed734bea9cbfc24409ed989"
DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"
NOTICE = "https://np-anotice-stock.eastmoney.com/api/security/ann"
FAST = "https://np-listapi.eastmoney.com/comm/web/getFastNewsList"
RANK = "https://emappdata.eastmoney.com/stockrank/getAllCurrentList"


P2_HOSTS = (
    "https://push2.eastmoney.com",
    "https://push2delay.eastmoney.com",
    "https://33.push2.eastmoney.com",
    "https://90.push2.eastmoney.com",
    "http://push2.eastmoney.com",
)


def global_index_quote(secid: str, name: str) -> dict | None:
    """东财全球指数现货报价，补新浪没有的外围标的（如韩国 KOSPI 100.KS11）。
    行字段口径与 sina.global_quotes 对齐。push2 系域名对不同出口 IP 的限流程度
    不一（本机 TLS 掐断、云 runner 常年 502），挨个镜像试，全挂返回 None 让
    调用方少一行即可，不抛错拖垮整组行情。"""
    for host in P2_HOSTS:
        try:
            raw = fetch(f"{host}/api/qt/ulist.np/get", provider=P, capability="global_index",
                        referer=REFERER, params={
                            "secids": secid,
                            "fields": "f1,f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124",
                        }, timeout=5, retries=0)
        except ProviderError:
            continue
        for d in ((raw or {}).get("data") or {}).get("diff") or []:
            digits = d.get("f1")
            price = _scaled(d.get("f2"), digits)
            if price is None or price <= 0:
                continue
            ts = d.get("f124")
            dt = datetime.fromtimestamp(ts) if isinstance(ts, (int, float)) and ts > 0 else None
            return {
                "code": f"{d.get('f13')}.{d.get('f12')}",
                "name": name,
                "price": price,
                "change_price": _scaled(d.get("f4"), digits),
                "change_percent": _scaled(d.get("f3"), 100),
                "open": _scaled(d.get("f17"), digits),
                "high": _scaled(d.get("f15"), digits),
                "low": _scaled(d.get("f16"), digits),
                "prev_close": _scaled(d.get("f18"), digits),
                "amount": None,
                "date": dt.strftime("%Y-%m-%d") if dt else None,
                "time": dt.strftime("%H:%M:%S") if dt else None,
            }
    return None


def _scaled(v: Any, digits: int) -> float | None:
    """东财价格按 f1 的位数缩放，涨跌幅 f3 固定按 100 缩放；空值/占位符 '-' 归 None"""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x / (10 ** digits)


def _pool(endpoint: str, date: str, pagesize: int = 200, pageindex: int = 0,
          sort: str = "fbt:asc") -> dict:
    raw = fetch(f"{EX}/{endpoint}", provider=P, capability=endpoint, referer=REFERER, params={
        "ut": UT, "dpt": "wz.ztzt", "Pageindex": pageindex, "pagesize": pagesize,
        "sort": sort, "date": date,
    })
    return (raw or {}).get("data") or {}


def _fen(v: Any) -> float:
    """东财价格放大 1000 倍"""
    try:
        return round(float(v) / 1000, 4)
    except (TypeError, ValueError):
        return 0.0


def _hm(v: Any) -> str:
    s = str(v or "").zfill(6)
    return f"{s[:2]}:{s[2:4]}" if len(s) >= 4 else ""


def _zttj(v: Any, lbc: int) -> str:
    """涨停统计「N天M板」。M 与连板数相同就没有额外信息，留空。"""
    d, c = int((v or {}).get("days") or 0), int((v or {}).get("ct") or 0)
    return f"{d}天{c}板" if d and c and c != lbc else ""


def limit_up_pool(date: str) -> list[dict]:
    data = _pool("getTopicZTPool", date)
    out = []
    for it in data.get("pool") or []:
        out.append({
            "code": it.get("c"), "market": it.get("m"),
            "name": it.get("n"), "price": _fen(it.get("p")),
            "change_percent": round(float(it.get("zdp") or 0), 2),
            "amount": float(it.get("amount") or 0),
            "float_cap": float(it.get("ltsz") or 0),
            "total_cap": float(it.get("tshare") or 0),
            "turnover": round(float(it.get("hs") or 0), 2),
            "lbc": int(it.get("lbc") or 1),
            "first_seal": _hm(it.get("fbt")), "last_seal": _hm(it.get("lbt")),
            "seal_fund": float(it.get("fund") or 0),
            # zbc 才是炸板次数（实测 1~9）；接口没有 zb / zb_count 这两个字段
            "blown_times": int(it.get("zbc") or 0),
            "sector": it.get("hybk") or "",
            "stat": _zttj(it.get("zttj"), int(it.get("lbc") or 1)),
        })
    return out


def blown_pool(date: str) -> list[dict]:
    data = _pool("getTopicZBPool", date)
    out = []
    for it in data.get("pool") or []:
        out.append({
            "code": it.get("c"), "name": it.get("n"), "price": _fen(it.get("p")),
            "change_percent": round(float(it.get("zdp") or 0), 2),
            "limit_price": _fen(it.get("ztp")),
            "amount": float(it.get("amount") or 0),
            "turnover": round(float(it.get("hs") or 0), 2),
            "first_seal": _hm(it.get("fbt")), "blown_times": int(it.get("zbc") or 0),
            "sector": it.get("hybk") or "",
        })
    return out


def limit_down_pool(date: str) -> list[dict]:
    # 跌停池没有 fbt（首次封板时间）字段，按 fbt 排序接口会返回 tc 但 pool 为空，实测 zdp:asc 才有行
    data = _pool("getTopicDTPool", date, sort="zdp:asc")
    out = []
    for it in data.get("pool") or []:
        out.append({
            "code": it.get("c"), "name": it.get("n"), "price": _fen(it.get("p")),
            "change_percent": round(float(it.get("zdp") or 0), 2),
            "amount": float(it.get("amount") or 0),
            "float_cap": float(it.get("ltsz") or 0),
            "turnover": round(float(it.get("hs") or 0), 2),
            "last_seal": _hm(it.get("lbt")), "seal_fund": float(it.get("fund") or 0),
            # 跌停池没有 lbc，连续跌停天数在 days、开板次数在 oc（实测字段名）
            "consecutive_down": int(it.get("days") or 1),
            "open_times": int(it.get("oc") or 0),
            "sector": it.get("hybk") or "",
        })
    return out


def pool_counts(date: str) -> dict:
    """只取条数，用于封板率；接口在 data.tc 里直接给总数"""
    return {
        "limit_up": int((_pool("getTopicZTPool", date, pagesize=1) or {}).get("tc") or 0),
        "blown": int((_pool("getTopicZBPool", date, pagesize=1) or {}).get("tc") or 0),
        "limit_down": int((_pool("getTopicDTPool", date, pagesize=1) or {}).get("tc") or 0),
    }


def kline_daily(symbol: str, days: int = 120) -> list[dict]:
    n = norm_symbol(symbol)
    raw = fetch(f"{HIS}/api/qt/stock/kline/get", provider=P, capability="kline_daily",
                referer=REFERER, params={
                    "secid": n["secid"], "ut": UT,
                    "fields1": "f1,f2,f3,f4,f5,f6",
                    "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
                    "klt": 101, "fqt": 1, "end": "20500101", "lmt": days,
                })
    out = []
    for line in ((raw or {}).get("data") or {}).get("klines") or []:
        f = line.split(",")
        if len(f) < 7:
            continue
        out.append({
            "day": f[0], "open": float(f[1]), "close": float(f[2]),
            "high": float(f[3]), "low": float(f[4]),
            "volume": float(f[5]), "amount": float(f[6]),
        })
    return out


def minute_trend(symbol: str) -> list[dict]:
    n = norm_symbol(symbol)
    raw = fetch(f"{HIS}/api/qt/stock/trends2/get", provider=P, capability="minute_trend",
                referer=REFERER, params={
                    "secid": n["secid"], "ut": UT,
                    "fields1": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
                    "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
                    "iscr": 0, "ndays": 1,
                })
    out = []
    for line in ((raw or {}).get("data") or {}).get("trends") or []:
        f = line.split(",")
        if len(f) < 4:
            continue
        out.append({"time": f[0], "price": float(f[1]), "volume": float(f[3]), "avg_price": float(f[2])})
    return out


# ---------------------------------------------------------------- 7x24 快讯
def fast_news(size: int = 50, sort_end: str = "") -> list[dict]:
    """东财 7x24 快讯；带关联个股代码，可直接做新闻雷达与个股消息面"""
    raw = fetch(FAST, provider=P, capability="news_flash", referer="https://www.eastmoney.com/",
                 params={"client": "web", "biz": "web_724", "fastColumn": "102", "sortSign": "1",
                         "pageSize": str(size), "nextText": "", "sortEnd": sort_end,
                         "req_trace": "1730000000000"})
    items = ((raw or {}).get("data") or {}).get("fastNewsList") or []
    out = []
    for it in items:
        out.append({
            "id": str(it.get("code")),
            "title": it.get("title") or (it.get("summary") or "")[:40],
            "summary": it.get("summary"),
            "time": it.get("showTime"),
            "url": "https://finance.eastmoney.com/a/%s.html" % it.get("code"),
            "source": "东方财富",
            "stocks": [s for s in (it.get("stockList") or []) if isinstance(s, str)],
        })
    return out


# ---------------------------------------------------------------- 公告
def announcements(size: int = 50, page: int = 1, stock_code: str = "") -> list[dict]:
    params = {"sr": -1, "page_size": size, "page_index": page, "ann_type": "A",
              "client_source": "web", "f_node": 0, "s_node": 0}
    if stock_code:
        params["stock_list"] = stock_code
    raw = fetch(NOTICE, provider=P, capability="announcement",
                referer="https://data.eastmoney.com/notice/", params=params)
    out = []
    for it in ((raw or {}).get("data") or {}).get("list") or []:
        codes = it.get("codes") or []
        first = codes[0] if codes else {}
        market = "sh" if str(first.get("market_code")) == "1" else "sz"
        out.append({
            "id": it.get("art_code"),
            "title": it.get("title"),
            "symbol": (market + str(first.get("stock_code"))) if first else None,
            "stockName": first.get("short_name"),
            "columns": [c.get("column_name") for c in (it.get("columns") or [])],
            "time": it.get("display_time"),
            "url": "https://data.eastmoney.com/notices/detail/%s.html" % it.get("art_code"),
        })
    return out


# ---------------------------------------------------------------- 数据中心报表
def datacenter(report: str, *, filt: str = "", columns: str = "ALL", sort: str | None = None,
               page: int = 1, size: int = 50, order: str = "-1",
               capability: str = "datacenter") -> list[dict]:
    """东财数据报表通用取数。日期过滤要写成 (FIELD>='YYYY-MM-DD')，等号写法会被拒"""
    params: dict[str, Any] = {"reportName": report, "columns": columns, "filter": filt,
                              "pageSize": size, "pageNumber": page,
                              "source": "WEB", "client": "WEB"}
    if sort:
        params.update({"sortColumns": sort, "sortTypes": order})
    last_msg = "报表无数据"
    for attempt in range(2):
        raw = fetch(DC, provider=P, capability=capability, referer="https://data.eastmoney.com/",
                     params=params)
        res = (raw or {}).get("result")
        if res:
            return res.get("data") or []
        last_msg = ((raw or {}).get("message") or last_msg)[:180]
        if "繁忙" not in last_msg:
            break
        time.sleep(0.6)
    raise ProviderError(P, capability, last_msg)


def billboard(date_iso: str) -> list[dict]:
    """龙虎榜：成交额占比、净额、上榜原因"""
    rows = datacenter("RPT_DAILYBILLBOARD_DETAILSNEW",
                      filt="(TRADE_DATE>='%s')" % date_iso, sort="TRADE_DATE",
                      size=300, capability="billboard")
    return [{
        "symbol": (r.get("SECUCODE") or "").split(".")[0],
        "secucode": r.get("SECUCODE"), "name": r.get("SECURITY_NAME_ABBR"),
        "date": (r.get("TRADE_DATE") or "")[:10],
        "changePercent": r.get("CHANGE_RATE"), "dealAmount": r.get("BILLBOARD_DEAL_AMT"),
        "netAmount": r.get("BILLBOARD_NET_AMT"), "buyAmount": r.get("BILLBOARD_BUY_AMT"),
        "sellAmount": r.get("BILLBOARD_SELL_AMT"), "ratio": r.get("DEAL_AMOUNT_RATIO"),
        "reason": r.get("EXPLANATION"), "explain": r.get("EXPLAIN"),
        "floatCap": r.get("FREE_MARKET_CAP"), "turnover": r.get("TURNOVERRATE"),
    } for r in rows]


def billboard_seats(date_iso: str) -> list[dict]:
    """龙虎榜买入席位：机构专用席位 + 游资营业部"""
    rows = datacenter("RPT_BILLBOARD_DAILYDETAILSBUY",
                      filt="(TRADE_DATE>='%s')" % date_iso, sort="TRADE_DATE",
                      size=400, capability="billboard_seats")
    out = []
    for r in rows:
        name = r.get("OPERATEDEPT_NAME") or ""
        out.append({
            "symbol": r.get("SECURITY_CODE"), "secucode": r.get("SECUCODE"),
            "date": (r.get("TRADE_DATE") or "")[:10], "dept": name,
            "buy": r.get("BUY"), "sell": r.get("SELL"), "net": r.get("NET"),
            "ratio": r.get("BUY_SELL_SUM_RATIO"),
            "is_institution": "机构专用" in name,
        })
    return out


def org_survey(days: int = 30, min_groups: int = 24, max_pages: int = 20,
               code: str = "") -> list[dict]:
    # 该报表 pageSize>50 会被东财判为「服务器繁忙」，所以分页取；一条记录是一家调研机构，
    # 一家公司一次调研能摊出上百条，所以要翻到「够多家被调研」为止，而不是翻满固定页数
    filt = f'(SECURITY_CODE="{code}")' if code else recent_filter("RECEIVE_START_DATE", days)
    stop_at = 4 if code else min_groups
    rows: list[dict] = []
    groups: set = set()
    for page in range(1, max_pages + 1):
        try:
            got = datacenter("RPT_ORG_SURVEY", filt=filt,
                             sort="RECEIVE_START_DATE", size=50, page=page,
                             capability="org_survey")
        except ProviderError:
            break
        if not got:
            break
        rows += got
        groups.update((r.get("SECURITY_CODE"), r.get("RECEIVE_START_DATE")) for r in rows)
        if len(got) < 50 or len(groups) >= stop_at:
            break
    out = []
    for r in rows:
        url = r.get("URL") or ""
        out.append({
            "symbol": r.get("SECURITY_CODE"), "name": r.get("SECURITY_NAME_ABBR"),
            "date": (r.get("RECEIVE_START_DATE") or "")[:10],
            # ORG_NAME 是被调研的上市公司本身，真正来的机构在 RECEIVE_OBJECT
            "org": r.get("RECEIVE_OBJECT"), "orgTotal": r.get("NUM"),
            "way": r.get("RECEIVE_WAY_EXPLAIN") or r.get("RECEIVE_WAY"),
            "place": r.get("RECEIVE_PLACE"), "receptionist": r.get("RECEPTIONIST"),
            "timeExplain": r.get("RECEIVE_TIME_EXPLAIN"),
            "content": (r.get("CONTENT") or "")[:600],
            "url": url if url.startswith("http") else None,
            "notice": (r.get("NOTICE_DATE") or "")[:10],
        })
    return out


def holder_changes(days: int = 60) -> list[dict]:
    """股东增减持公告：净增持可用作大股东增持策略"""
    rows = datacenter("RPT_SHARE_HOLDER_INCREASE", filt=recent_filter("NOTICE_DATE", days),
                      sort="NOTICE_DATE", size=200, capability="holder_change")
    return [{"symbol": r.get("SECURITY_CODE"), "name": r.get("SECURITY_NAME_ABBR"),
             "date": (r.get("NOTICE_DATE") or "")[:10],
             "tradeDate": (r.get("TRADE_DATE") or "")[:10],
             "holder": r.get("HOLDER_NAME"), "changeNum": r.get("CHANGE_NUM"),
             "changeRate": r.get("CHANGE_RATE"), "afterRate": r.get("AFTER_CHANGE_RATE"),
             "holdRatio": r.get("HOLD_RATIO"), "avgPrice": r.get("TRADE_AVERAGE_PRICE"),
             "close": r.get("CLOSE_PRICE"), "market": r.get("MARKET"),
             "direction": r.get("DIRECTION") or
                          ("增持" if (r.get("CHANGE_NUM_SYMBOL") or 0) > 0 else "减持")}
            for r in rows]


def lockup_expiry(days: int = 60) -> list[dict]:
    """限售解禁日历：从今天起 N 天内解禁的规模。股数单位是万股，市值单位是万元"""
    today = datetime.now().strftime("%Y-%m-%d")
    _lo, hi = window(days)
    rows = datacenter("RPT_LIFT_STAGE", filt="(FREE_DATE>='%s')" % today, sort="FREE_DATE",
                      order="1", size=300, capability="lockup")
    out = []
    for r in rows:
        d = (r.get("FREE_DATE") or "")[:10]
        if d <= hi:
            out.append({"symbol": r.get("SECURITY_CODE"), "secucode": r.get("SECUCODE"),
                        "name": r.get("SECURITY_NAME_ABBR"), "date": d,
                        "shares": r.get("CURRENT_FREE_SHARES"),
                        "sharesYi": round((r.get("CURRENT_FREE_SHARES") or 0) / 1e4, 3),
                        "marketCap": r.get("LIFT_MARKET_CAP"),
                        "marketCapYi": round((r.get("LIFT_MARKET_CAP") or 0) / 1e4, 2),
                        "type": r.get("FREE_SHARES_TYPE"), "ratio": r.get("FREE_RATIO"),
                        "totalRatio": r.get("TOTALSHARES_RATIO"),
                        "holders": r.get("BATCH_HOLDER_NUM"), "price": r.get("NEW"),
                        "chg20": r.get("B20_ADJCHRATE")})
    return out


def f10_main(secucode: str, size: int = 8) -> list[dict]:
    rows = datacenter("RPT_F10_FINANCE_MAINFINADATA", filt='(SECUCODE="%s")' % secucode,
                      sort="REPORT_DATE", size=size, capability="finance_main")
    return [{"reportDate": (r.get("REPORT_DATE") or "")[:10],
             "reportName": r.get("REPORT_DATE_NAME"), "reportType": r.get("REPORT_TYPE"),
             "noticeDate": (r.get("NOTICE_DATE") or "")[:10],
             "eps": r.get("EPSJB"), "epsDeduct": r.get("EPSKCJB"),
             "roe": r.get("ROEJQ"), "roeDeduct": r.get("ROEKCJQ"), "roic": r.get("ROIC"),
             "revenue": r.get("TOTALOPERATEREVE"),
             "revenueYoy": r.get("TOTALOPERATEREVETZ"),
             "netProfit": r.get("PARENTNETPROFIT"), "profitYoy": r.get("PARENTNETPROFITTZ"),
             "deductProfit": r.get("KCFJCXSYJLR"), "deductYoy": r.get("KCFJCXSYJLRTZ"),
             "bps": r.get("BPS"), "cashPerShare": r.get("MGJYXJJE"),
             "grossMargin": r.get("XSMLL"), "netMargin": r.get("XSJLL"),
             "debtRatio": r.get("ZCFZL"), "currentRatio": r.get("LD"),
             "quickRatio": r.get("SD"), "assetTurn": r.get("ZZCZZTS"),
             "inventoryTurn": r.get("CHZZTS"), "inventoryRate": r.get("CHZZL"), "receivableTurn": r.get("YSZKZZTS"),
             "goodwill": r.get("NETPROFITRPHBZC")} for r in rows]


def performance_report(code: str) -> list[dict]:
    rows = datacenter("RPT_LICO_FN_CPD", filt='(SECURITY_CODE="%s")' % code,
                      sort="REPORTDATE", size=8, capability="performance")
    return [{"reportDate": (r.get("REPORTDATE") or "")[:10],
             "reportName": r.get("DATATYPE"), "quarter": r.get("QDATE"),
             "industry": r.get("PUBLISHNAME"),
             "noticeDate": (r.get("NOTICE_DATE") or "")[:10],
             "eps": r.get("BASIC_EPS"), "epsDeduct": r.get("DEDUCT_BASIC_EPS"),
             "revenue": r.get("TOTAL_OPERATE_INCOME"), "revenueYoy": r.get("YSTZ"),
             "revenueQoq": r.get("YSHZ"),
             "netProfit": r.get("PARENT_NETPROFIT"), "profitYoy": r.get("SJLTZ"),
             "profitQoq": r.get("SJLHZ"),
             "roe": r.get("WEIGHTAVG_ROE"), "grossMargin": r.get("XSMLL"),
             "bps": r.get("BPS"), "cashPerShare": r.get("MGJYXJJE"),
             "dividend": r.get("ASSIGNDSCRPT")} for r in rows]


def top_holders(secucode: str, size: int = 10) -> list[dict]:
    rows = datacenter("RPT_F10_EH_FREEHOLDERS", filt='(SECUCODE="%s")' % secucode,
                      sort="END_DATE", size=size, capability="holders")
    return [{"name": r.get("HOLDER_NAME"), "shares": r.get("HOLD_NUM"),
             "ratio": r.get("FREE_HOLDNUM_RATIO"), "change": r.get("HOLD_NUM_CHANGE"),
             "endDate": (r.get("END_DATE") or "")[:10], "type": r.get("HOLDER_CLASS")}
            for r in rows]


def index_components(type_code: str, size: int = 700) -> list[dict]:
    """指数成分（RPT_INDEX_TS_COMPONENT）。TYPE 是指数编号，实测：
    1=沪深300(300家) 2=上证50 3=中证500 4=科创50 10=北证50(全是 920 代码) 11=上证180。
    只有 1/2/3/4 给 WEIGHT，其余指数的权重字段为空，页面按缺失展示。"""
    rows = datacenter("RPT_INDEX_TS_COMPONENT", filt='(TYPE="%s")' % type_code,
                      sort="WEIGHT", size=size, capability="index_component")
    out = []
    for r in rows:
        code = str(r.get("SECURITY_CODE") or "")
        prefix = "sh" if code[0] in "569" else ("bj" if code[0] in "48" else "sz")
        out.append({
            "symbol": prefix + code, "code": code, "name": r.get("SECURITY_NAME_ABBR"),
            "weight": r.get("WEIGHT"), "price": r.get("CLOSE_PRICE"),
            "changePercent": r.get("CHANGE_RATE"), "industry": r.get("INDUSTRY"),
            "region": r.get("REGION"), "eps": r.get("EPS"), "bps": r.get("BPS"),
            "roe": r.get("ROE"), "pe": r.get("PE"), "freeCap": r.get("FREE_CAP"),
            "date": (r.get("MAXTRADEDATE") or "")[:10],
        })
    return out


def north_history(size: int = 40) -> list[dict]:
    """北向资金：交易所已停止披露净买入额，接口仍有额度字段但金额为空，页面按缺失展示"""
    rows = datacenter("RPT_MUTUAL_DEAL_HISTORY", filt='(MUTUAL_TYPE="005")',
                      sort="TRADE_DATE", size=size, capability="north_fund")
    return [{"date": (r.get("TRADE_DATE") or "")[:10], "net": r.get("NET_DEAL_AMT"),
             "inflow": r.get("FUND_INFLOW"), "buy": r.get("BUY_AMT"),
             "sell": r.get("SELL_AMT"), "balance": r.get("QUOTA_BALANCE"),
             "leader": r.get("LEAD_STOCKS_CODE")} for r in rows]


def recent_filter(field: str, days: int) -> str:
    lo, _ = window(days)
    return "(%s>='%s')" % (field, lo)


def window(days: int) -> tuple[str, str]:
    today = datetime.now()
    return ((today - timedelta(days=days)).strftime("%Y-%m-%d"),
            (today + timedelta(days=days)).strftime("%Y-%m-%d"))


# ---------------------------------------------------------------- 人气榜
def hot_rank(size: int = 100) -> list[dict]:
    # 实测榜单最多 100 条：pageSize>100 返回空 data，pageNo=2 也是空
    size = min(size, 100)
    raw = post_json(RANK, provider=P, capability="hot_rank",
                    referer="https://quote.eastmoney.com/",
                    body={"appId": "appId01", "globalId": "786e4c21-70dc-435a-93ff-38b4e9bb53f9",
                          "marketType": "", "pageNo": 1, "pageSize": size})
    out = []
    for it in (raw or {}).get("data") or []:
        sc = str(it.get("sc") or "")
        prefix = {"SH": "sh", "SZ": "sz", "BJ": "bj"}.get(sc[:2].upper(), "")
        out.append({"rank": it.get("rk"), "symbol": prefix + sc[2:], "raw": sc,
                    "change": it.get("rc"), "historyChange": it.get("hisRc")})
    return out
