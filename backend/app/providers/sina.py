"""新浪财经 Provider：实时指数、全市场快照、排行、板块、K线"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterator

from .base import fetch, norm_symbol

P = "sina"
REFERER = "http://finance.sina.com.cn/"
HQ = "https://hq.sinajs.cn/list="
MC = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
KL = "http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"

# 核心指数（含科创板、北交所，对齐拆解文档 3.2）
CORE_INDEXES = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000688", "科创50"),
    ("bj899050", "北证50"),
]


def _rows(raw: str) -> list[str]:
    return [line for line in raw.splitlines() if "=" in line]


def realtime(symbols: list[str], capability: str = "realtime") -> list[dict]:
    """hq.sinajs.cn 批量实时行情，GBK 需显式解码"""
    if not symbols:
        return []
    out: list[dict] = []
    for chunk in [symbols[i:i + 60] for i in range(0, len(symbols), 60)]:
        raw = fetch(HQ + ",".join(chunk), provider=P, capability=capability,
                    referer=REFERER, encoding="gbk", expect_json=False)
        for line in _rows(raw):
            m = re.match(r'var hq_str_(\w+)="(.*)";?', line.strip())
            if not m:
                continue
            sym, body = m.group(1), m.group(2)
            f = body.split(",")
            if len(f) < 32:
                continue
            try:
                price = float(f[3])
                prev = float(f[2]) or price
                out.append({
                    "symbol": sym, "name": f[0],
                    "open": float(f[1]), "prev_close": prev, "price": price,
                    "high": float(f[4]), "low": float(f[5]),
                    "volume": float(f[8]), "amount": float(f[9]),
                    "date": f[30], "time": f[31],
                    "change_price": round(price - prev, 4),
                    "change_percent": round((price - prev) / prev * 100, 2) if prev else 0.0,
                })
            except (ValueError, IndexError):
                continue
    return out


def index_quotes() -> list[dict]:
    quotes = {q["symbol"]: q for q in realtime([s for s, _ in CORE_INDEXES], "index")}
    return [{**quotes[s], "label": label} for s, label in CORE_INDEXES if s in quotes]


def spot_page(node: str = "hs_a", sort: str = "changepercent", asc: int = 0,
              page: int = 1, num: int = 100) -> list[dict]:
    return fetch(MC, provider=P, capability="spot", referer=REFERER, params={
        "page": page, "num": num, "sort": sort, "asc": asc, "node": node,
    })


def spot_ranking(sort: str, desc: bool = True, num: int = 30, node: str = "hs_a") -> list[dict]:
    return spot_page(node=node, sort=sort, asc=0 if desc else 1, page=1, num=num)


def spot_all(node: str = "hs_a", max_pages: int = 60, sleep: float = 0.12) -> Iterator[dict]:
    """全市场快照；新浪单页上限 100 行"""
    import time
    for page in range(1, max_pages + 1):
        rows = spot_page(node=node, sort="symbol", asc=1, page=page, num=100)
        if not rows:
            break
        for r in rows:
            yield r
        if len(rows) < 100:
            break
        time.sleep(sleep)


def spot_count(node: str = "hs_a") -> int:
    raw = fetch(
        "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount",
        provider=P, capability="spot_count", referer=REFERER, params={"node": node})
    try:
        return int(str(raw).strip('"'))
    except Exception:
        return 0


def board_list(kind: str = "industry") -> list[dict]:
    """板块列表。实测：newFLJK.php 返回 hangye_Z* 证监会行业分类，
    newSinaHy.php 返回 new_* 特色/概念分类（含次新股），所以行业取前者、概念取后者"""
    url = ("http://money.finance.sina.com.cn/q/view/newFLJK.php" if kind == "industry"
           else "http://money.finance.sina.com.cn/q/view/newSinaHy.php")
    raw = fetch(url, provider=P, capability=f"board_{kind}", referer=REFERER,
                encoding="gbk", expect_json=False)
    m = re.search(r"=\s*(\{.*\})\s*;?\s*$", raw, re.S)
    if not m:
        return []
    import json as _json
    data = _json.loads(m.group(1))
    out = []
    for code, line in data.items():
        f = str(line).split(",")
        if len(f) < 8:
            continue
        try:
            out.append({
                "code": code, "name": f[1], "stock_count": int(float(f[2])),
                "avg_price": float(f[3]), "change_price": float(f[4]),
                "change_percent": round(float(f[5]), 2),
                "volume": float(f[6]), "amount": float(f[7]),
            })
        except (ValueError, IndexError):
            continue
    out.sort(key=lambda x: x["change_percent"], reverse=True)
    return out


def board_stocks(board_code: str, num: int = 50) -> list[dict]:
    """板块成分。新浪 Market_Center 对无效 node 不报错，直接返回全市场列表，
    所以先用家数接口把这种假结果挡掉（板块不可能有几千只）。"""
    count = spot_count(board_code)
    if not count or count > 3000:
        return []
    return spot_page(node=board_code, sort="changepercent", asc=0, page=1, num=num)


def kline_daily(symbol: str, datalen: int = 120) -> list[dict]:
    n = norm_symbol(symbol)
    rows = fetch(KL, provider=P, capability="kline_daily", referer=REFERER, params={
        "symbol": n["symbol"], "scale": 240, "ma": "no", "datalen": datalen})
    return _clean_kline(rows)


def kline_minutes(symbol: str, scale: int = 5, datalen: int = 240) -> list[dict]:
    n = norm_symbol(symbol)
    rows = fetch(KL, provider=P, capability="kline_minute", referer=REFERER, params={
        "symbol": n["symbol"], "scale": scale, "ma": "no", "datalen": datalen})
    return _clean_kline(rows)


def _clean_kline(rows: Any) -> list[dict]:
    out = []
    for r in rows or []:
        try:
            out.append({
                "day": str(r.get("day", ""))[:10], "datetime": r.get("day"),
                "open": float(r["open"]), "high": float(r["high"]),
                "low": float(r["low"]), "close": float(r["close"]),
                "volume": float(r.get("volume") or 0),
            })
        except (KeyError, ValueError, TypeError):
            continue
    return out


# ---------------------------------------------------------------- 全球指数 / 商品
# 本机实测：腾讯外盘K线没有数据，全球与商品只有新浪现货报价
GLOBAL_INDEXES = [
    ("gb_$dji", "道琼斯", "美股"),
    ("gb_$ixic", "纳斯达克", "美股"),
    ("gb_$inx", "标普500", "美股"),
    ("rt_hkHSI", "恒生指数", "港股"),
    ("int_nikkei", "日经225", "亚太"),
    # 新浪没有 KOSPI：这行只当分组/命名的规范源，行情由东财补（registry.global_quotes）
    ("100.KS11", "韩国KOSPI", "亚太"),
    ("int_ftse", "英国富时100", "欧洲"),
    ("int_hangseng", "恒生指数(简)", "亚太"),
    ("DINIW", "美元指数", "汇率"),
    ("fx_susdcnh", "离岸人民币", "汇率"),
    ("hf_CHA50CFD", "富时A50期货", "中国"),
]

# 这些代码新浪没有，行情由东财补；绝不能混进组表请求——实测 100.KS11 会触发
# 新浪风控 hq_str_sys_auth="FAILED"，整组（含其他正常代码）一起被拒
GLOBAL_FROM_EM = {"100.KS11"}

COMMODITIES = [
    ("hf_CL", "纽约原油", "能源"),
    ("hf_OIL", "布伦特原油", "能源"),
    ("hf_NG", "美国天然气", "能源"),
    ("hf_GC", "纽约黄金", "贵金属"),
    ("hf_SI", "纽约白银", "贵金属"),
    ("hf_XAU", "伦敦金现货", "贵金属"),
    ("hf_CAD", "伦铜", "有色"),
]

GLOBAL_NAMES = {c: n for c, n, _g in GLOBAL_INDEXES}
GLOBAL_NAMES.update({c: n for c, n, _g in COMMODITIES})

# int_hangseng 与 rt_hkHSI 是同一个恒生指数（实测价/涨跌完全一致），
# 简版只有 4 个字段，留作主源挂掉时的兜底，两个都有数时只展示主源
GLOBAL_BACKUP_OF = {"int_hangseng": "rt_hkHSI"}


def _hq_lines(codes: list[str], capability: str) -> dict[str, list[str]]:
    raw = fetch(HQ + ",".join(codes), provider=P, capability=capability,
                referer=REFERER, encoding="gbk", expect_json=False)
    out: dict[str, list[str]] = {}
    for line in _rows(raw):
        m = re.match(r'var hq_str_([\w$.\-]+)="(.*)";?', line.strip())
        if not m:
            continue
        f = m.group(2).split(",")
        if m.group(2) and len(f) > 1:
            out[m.group(1)] = f
    return out


def _f(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def global_quotes(codes: list[str], capability: str = "global_index") -> list[dict]:
    """全球指数/外汇/期货报价：gb_$ 美股指数、int_ 简版指数、rt_hk/hk 恒指、DINIW/fx 汇率、hf_ 期货"""
    data = _hq_lines(codes, capability)
    out = []
    for code in codes:
        f = data.get(code)
        if not f:
            continue
        row = {"code": code, "name": None, "price": None, "change_price": None,
               "change_percent": None, "open": None, "high": None, "low": None,
               "prev_close": None, "amount": None, "date": None, "time": None}
        if code.startswith("gb_"):
            row.update({"name": f[0], "price": _f(f[1]), "change_percent": _f(f[2]),
                        "date": (f[3] or "")[:10], "time": (f[3] or "")[11:] or None, "change_price": _f(f[4]),
                        "open": _f(f[5]), "high": _f(f[6]), "low": _f(f[7]),
                        "amount": _f(f[11])})
        elif code.startswith(("int_",)):
            row.update({"name": f[0], "price": _f(f[1]), "change_price": _f(f[2]),
                        "change_percent": _f(f[3])})
        elif code.startswith(("rt_hk", "hk")):
            row.update({"name": f[1], "open": _f(f[2]), "prev_close": _f(f[3]),
                        "high": _f(f[4]), "low": _f(f[5]), "price": _f(f[6]),
                        "change_price": _f(f[7]), "change_percent": _f(f[8]),
                        "amount": _f(f[12]), "date": f[17] if len(f) > 17 else None,
                        "time": f[18] if len(f) > 18 else None})
        elif code.startswith("DINIW"):
            row.update({"price": _f(f[1]), "high": _f(f[6]), "low": _f(f[7]),
                        "prev_close": _f(f[5]), "date": f[10], "time": f[0]})
            if row["price"] and row["prev_close"]:
                row["change_price"] = round(row["price"] - row["prev_close"], 4)
                row["change_percent"] = round((row["price"] / row["prev_close"] - 1) * 100, 2)
        elif code.startswith("fx_"):
            # 实测离岸人民币字段：[1]现价 [5]昨收 [6]最高 [7]最低 [8]今开；
            # [10]/[11] 与本品种现价对不上（6.669 对 -0.05），不拿来当涨跌
            prev = _f(f[5]) if len(f) > 5 else None
            row.update({"time": f[0], "price": _f(f[1]), "name": f[9] if len(f) > 9 else code,
                        "prev_close": prev, "open": _f(f[8]) if len(f) > 8 else None,
                        "high": _f(f[6]) if len(f) > 6 else None,
                        "low": _f(f[7]) if len(f) > 7 else None,
                        "date": f[-1]})
            if row["price"] and prev:
                row["change_price"] = round(row["price"] - prev, 4)
                row["change_percent"] = round((row["price"] / prev - 1) * 100, 2)
        elif code.startswith("hf_"):
            prev = _f(f[7]) if len(f) > 7 else None
            row.update({"price": _f(f[0]), "bid": _f(f[2]), "ask": _f(f[3]),
                        "high": _f(f[4]), "low": _f(f[5]), "time": f[6],
                        "prev_close": prev, "open": _f(f[8]) if len(f) > 8 else None,
                        "date": f[12] if len(f) > 12 else None,
                        "name": f[13] if len(f) > 13 else code})
            if len(f) > 13 and f[13]:
                row["name"] = f[13]
            else:
                row["name"] = dict(COMMODITIES).get(code, code)
            if row["price"] and prev:
                row["change_price"] = round(row["price"] - prev, 4)
                row["change_percent"] = round((row["price"] / prev - 1) * 100, 2)
        # 表内中文名优先：源给的名字粗细不一（DINIW 干脆没有，int_ftse 叫「伦敦指数」）
        row["name"] = GLOBAL_NAMES.get(code) or row["name"] or code
        out.append(row)
    live = {r["code"] for r in out}
    return [r for r in out if GLOBAL_BACKUP_OF.get(r["code"]) not in live]


def index_kline_global(symbol: str, datalen: int = 120) -> list[dict]:
    """A股指数日线（sh000001 等），全球指数没有可用历史源"""
    rows = fetch(KL, provider=P, capability="kline_daily", referer=REFERER, params={
        "symbol": symbol, "scale": 240, "ma": "no", "datalen": datalen})
    return _clean_kline(rows)


# ---------------------------------------------------------------- 资金流
MF = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow."


def money_flow_boards(fenlei: int = 2, num: int = 60) -> list[dict]:
    """板块资金流：fenlei 0=地域/概念分类 1=概念 2=行业 3=指数成分"""
    rows = fetch(MF + "ssl_bkzj_bk", provider=P, capability="fund_flow_board", referer=REFERER,
                 params={"page": 1, "num": num, "sort": "netamount", "asc": 0, "fenlei": fenlei})
    out = []
    for r in rows or []:
        try:
            out.append({
                "code": r.get("category"), "name": r.get("name"),
                "avgChangePercent": round(float(r.get("avg_changeratio") or 0) * 100, 2),
                "turnover": _f(r.get("turnover")),
                "inAmount": _f(r.get("inamount")), "outAmount": _f(r.get("outamount")),
                "netAmount": _f(r.get("netamount")),
                "netRatio": round(float(r.get("ratioamount") or 0) * 100, 2),
                "leaderSymbol": r.get("ts_symbol"), "leaderName": r.get("ts_name"),
                "leaderPrice": _f(r.get("ts_trade")),
                "leaderChangePercent": round(float(r.get("ts_changeratio") or 0) * 100, 2),
            })
        except (ValueError, TypeError):
            continue
    return out


def money_flow_stocks(num: int = 60, desc: bool = True) -> list[dict]:
    """个股主力资金排行。desc=True 按净流入降序（抢钱股），False 升序（出货股）"""
    rows = fetch(MF + "ssl_bkzj_ssggzj", provider=P, capability="fund_flow_stock", referer=REFERER,
                 params={"page": 1, "num": num, "sort": "netamount", "asc": 0 if desc else 1})
    out = []
    for r in rows or []:
        try:
            out.append({
                "symbol": r.get("symbol"), "name": r.get("name"),
                "price": _f(r.get("trade")),
                "changePercent": round(float(r.get("changeratio") or 0) * 100, 2),
                "turnover": _f(r.get("turnover")), "amount": _f(r.get("amount")),
                "inAmount": _f(r.get("inamount")), "outAmount": _f(r.get("outamount")),
                "netAmount": _f(r.get("netamount")),
                "netRatio": round(float(r.get("ratioamount") or 0) * 100, 2),
            })
        except (ValueError, TypeError):
            continue
    return out


def money_flow_stock(symbol: str, num: int = 20) -> list[dict]:
    """单只个股按日的资金流（特大/大/中/小单）。
    实测只有 MoneyFlow.ssl_qsfx_lscjfb 带 daima 参数可用，ssl_bkzj_zjlrqs 已是死接口。"""
    n = norm_symbol(symbol)
    rows = fetch(MF + "ssl_qsfx_lscjfb", provider=P, capability="fund_flow_stock_daily",
                 referer=REFERER, params={"page": 1, "num": num, "sort": "opendate", "asc": 0,
                                          "daima": n["symbol"]})
    out = []
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("opendate"):
            continue
        super_net, big_net = _f(r.get("r0_net")), _f(r.get("r1_net"))
        out.append({
            "date": r["opendate"], "close": _f(r.get("trade")),
            "changePercent": round(float(r.get("changeratio") or 0) * 100, 2),
            "netAmount": _f(r.get("netamount")),
            "netRatio": round(float(r.get("ratioamount") or 0) * 100, 2),
            "superIn": _f(r.get("r0")), "bigIn": _f(r.get("r1")),
            "midIn": _f(r.get("r2")), "smallIn": _f(r.get("r3")),
            "superNet": super_net, "bigNet": big_net,
            "midNet": _f(r.get("r2_net")), "smallNet": _f(r.get("r3_net")),
            "mainNet": round((super_net or 0) + (big_net or 0), 2),
        })
    return out


# ---------------------------------------------------------------- 滚动新闻
ROLL = "https://feed.mix.sina.com.cn/api/roll/get"


def roll_news(lid: int = 2516, num: int = 50, page: int = 1) -> list[dict]:
    """新浪财经滚动新闻，lid 2516=财经 2510=国内 2511=国际"""
    raw = fetch(ROLL, provider=P, capability="news_roll", referer=REFERER,
                params={"pageid": 153, "lid": lid, "num": num, "page": page})
    items = ((raw or {}).get("result") or {}).get("data") or []
    out = []
    for it in items:
        ts = str(it.get("create_time") or it.get("ctime") or "")
        out.append({
            "id": str(it.get("oid") or it.get("url") or "")[:64],
            "title": it.get("title"), "summary": it.get("intro") or it.get("title"),
            "url": it.get("url"), "source": it.get("media_name") or "新浪财经",
            # 源给的是秒级时间戳，直接甩给前端会显示 1792918038 这种
            "time": (datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
                     if ts.isdigit() else ts),
            "tags": [],
        })
    return out

