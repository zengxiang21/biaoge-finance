"""外部免费源：百度热搜 / 微博热搜 / CBOE 恐慌指数 VIX（拆解文档 3.11.2、3.8）"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from urllib.parse import quote

from .base import ProviderError, fetch

UA_REFERER = {
    "baidu": "https://top.baidu.com/board?tab=realtime",
    "weibo": "https://weibo.com/",
    "cboe": "https://www.cboe.com/tradable_products/vix/",
}
VIX_QUOTE = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json"
VIX_HISTORY = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"


def baidu_hot(num: int = 30) -> list[dict]:
    raw = fetch("https://top.baidu.com/api/board", provider="baidu", capability="hot_search",
                referer=UA_REFERER["baidu"], params={"platform": "pc", "tab": "realtime"})
    cards = ((raw or {}).get("data") or {}).get("cards") or []
    out = []
    for card in cards:
        for it in (card.get("content") or [])[:num]:
            out.append({
                "rank": len(out) + 1, "word": it.get("word") or it.get("query"),
                "hot": it.get("hotScore"), "desc": it.get("desc"),
                "url": it.get("url") or it.get("index"),
                "tag": it.get("hotTag"), "source": "百度热搜",
            })
    return out


def weibo_hot(num: int = 30) -> list[dict]:
    raw = fetch("https://weibo.com/ajax/side/hotSearch", provider="weibo",
                capability="hot_search", referer=UA_REFERER["weibo"])
    items = (raw or {}).get("data") or {}
    out = []
    for it in (items.get("realtime") or [])[:num]:
        out.append({
            "rank": len(out) + 1, "word": it.get("word"),
            "hot": it.get("num"), "desc": it.get("note"),
            "url": "https://s.weibo.com/weibo?q=%s" % (it.get("word") or ""),
            "tag": it.get("label_name"), "source": "微博热搜",
        })
    return out


def finance_hot(num: int = 30) -> dict:
    """社会财经热搜聚合：单源失败不影响另一源"""
    boards: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    for label, fn in (("baidu", baidu_hot), ("weibo", weibo_hot)):
        try:
            boards[label] = fn(num)
        except ProviderError as exc:
            boards[label] = []
            errors[label] = exc.message
        except Exception as exc:  # noqa: BLE001
            boards[label] = []
            errors[label] = f"{type(exc).__name__}: {exc}"
    return {"boards": boards, "errors": errors}


# ---------------------------------------------------------------- 恐慌指数 VIX
# 本机实测：新浪没有 VIX 码（gb_$vix/int_vix 全空），东财 100.VIX 返回空对象，
# CBOE 官方 delayed 接口可用且当场更新，历史 CSV 是 1990 年至今的全量日线
def cboe_vix() -> dict:
    raw = fetch(VIX_QUOTE, provider="cboe", capability="fear_index",
                referer=UA_REFERER["cboe"], timeout=20.0)
    d = (raw or {}).get("data") or {}
    price = d.get("current_price")
    if not isinstance(price, (int, float)):
        raise ProviderError("cboe", "fear_index", "CBOE 返回里没有 VIX 现价")
    stamp = str(d.get("last_trade_time") or (raw or {}).get("timestamp") or "")
    return {
        "code": "VIX", "name": "恐慌指数 VIX", "source": "CBOE 官方（延时行情）",
        "price": round(float(price), 2),
        "change_price": _num(d.get("price_change")),
        "change_percent": _num(d.get("price_change_percent")),
        "open": _num(d.get("open")), "high": _num(d.get("high")), "low": _num(d.get("low")),
        "prev_close": _num(d.get("prev_day_close")),
        "date": stamp[:10] or None,
        "time": stamp[11:19] or None,
        "quoteZone": "美东时间",
        "tick": d.get("tick"),
    }


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 3)


def cboe_vix_history(rows: int = 120) -> list[dict]:
    """VIX 全量历史 CSV（约 470KB）取最近 rows 个交易日，用于恐慌指数的折线与分位"""
    raw = fetch(VIX_HISTORY, provider="cboe", capability="fear_index_history",
                referer=UA_REFERER["cboe"], timeout=30.0, expect_json=False)
    out: list[dict] = []
    try:
        reader = csv.DictReader(io.StringIO(raw))
        for it in reader:
            close = _num((it or {}).get("CLOSE"))
            day = _us_date((it or {}).get("DATE"))
            if close is None or not day:
                continue
            out.append({"date": day, "close": close,
                        "high": _num(it.get("HIGH")), "low": _num(it.get("LOW"))})
    except Exception as exc:  # noqa: BLE001
        raise ProviderError("cboe", "fear_index_history", f"CSV 解析失败：{type(exc).__name__}: {exc}")
    if len(out) < 5:
        raise ProviderError("cboe", "fear_index_history", f"历史行数太少（{len(out)} 行）")
    return out[-rows:]


def _us_date(v: str | None) -> str | None:
    """CBOE 的日期是 MM/DD/YYYY，转成 YYYY-MM-DD 才能和 A 股序列并排"""
    s = str(v or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------- Yahoo 兜底
# 新浪没有、东财 push2 对数据中心 IP 掐断的外围标的（韩国 KOSPI ^KS11）走 Yahoo。
# v8 chart 免 crumb，但 Yahoo 对云 IP 时有 429，失败返回 None 少一行即可。
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"


def yahoo_index_quote(symbol: str, name: str) -> dict | None:
    try:
        raw = fetch(f"{YAHOO_CHART}/{quote(symbol, safe='')}", provider="yahoo",
                    capability="global_index", params={"range": "1d", "interval": "1d"},
                    timeout=8.0, retries=0)
    except ProviderError:
        return None
    try:
        result = ((raw or {}).get("chart") or {}).get("result") or []
        meta = (result[0] or {}).get("meta") or {}
    except (IndexError, AttributeError):
        return None
    price = meta.get("regularMarketPrice")
    if not isinstance(price, (int, float)):
        return None
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change_price = change_percent = None
    if isinstance(prev, (int, float)) and prev:
        change_price = round(price - prev, 4)
        change_percent = round((price / prev - 1) * 100, 2)
    quote_arr = (((result[0].get("indicators") or {}).get("quote") or [None])[0]) or {}
    bar = {k: (v or [None])[0] for k, v in quote_arr.items()} if quote_arr else {}

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    ts = meta.get("regularMarketTime")
    dt = datetime.fromtimestamp(ts) if isinstance(ts, (int, float)) and ts > 0 else None
    return {
        "code": "100.KS11", "name": name,
        "price": round(float(price), 4),
        "change_price": change_price, "change_percent": change_percent,
        "open": _f(bar.get("open")), "high": _f(bar.get("high")), "low": _f(bar.get("low")),
        "prev_close": _f(prev),
        "amount": None,
        "date": dt.strftime("%Y-%m-%d") if dt else None,
        "time": dt.strftime("%H:%M:%S") if dt else None,
    }
