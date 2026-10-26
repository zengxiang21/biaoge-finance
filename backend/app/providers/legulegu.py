"""乐咕乐股（legulegu）：宽基指数长历史 PE/PB 与历史分位

指数估值页要的「长时间估值区间」只有这里有日线级长序列（2005 年至今），
新浪/东财/中证官网都只给当天或近几天。上游按 IP 限流（快速连发返 429 的 HTML 页），
所以整个进程共用一把节流锁，并且要先取页面的 _csrf 令牌再带 cookie 调接口。
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from datetime import datetime

from . import base
from .base import ProviderError

PROVIDER = "legulegu"
SITE = "https://legulegu.com"

# 上游限流是实测定下来的：连发第三次就 429，留 2 秒余量后整轮 24 次请求没再被拦
MIN_INTERVAL = 2.0
_gate = threading.Lock()
_last_at = 0.0

PE_API = f"{SITE}/api/stockdata/index-basic-pe"
PB_API = f"{SITE}/api/stockdata/index-basic-pb"
MARKET_PE_API = f"{SITE}/api/stock-data/market-pe"
# 科创板在另一条接口上，参数不带 marketId
STAR_PE_API = f"{SITE}/api/stockdata/get-ke-chuang-ban-pe"
# 取令牌用的页面：乐咕的指数估值列表页
CSRF_PAGE = f"{SITE}/stockdata/sz50-ttm-lyr"

# 宽基指数清单：code 是乐咕口径（带交易所后缀），只有这些代码接口给数据，
# 上证指数/科创50/北证50 实测返回空数组，只能用 market 口径兜
INDEX_UNIVERSE: list[dict] = [
    {"code": "000016.SH", "name": "上证50"},
    {"code": "000010.SH", "name": "上证180"},
    {"code": "000903.SH", "name": "中证100"},
    {"code": "000300.SH", "name": "沪深300"},
    {"code": "000905.SH", "name": "中证500"},
    {"code": "000852.SH", "name": "中证1000"},
    {"code": "000906.SH", "name": "中证800"},
    {"code": "000009.SH", "name": "上证380"},
    {"code": "399673.SZ", "name": "创业板50"},
    {"code": "399330.SZ", "name": "深证100"},
    {"code": "399324.SZ", "name": "深证红利"},
    {"code": "000015.SH", "name": "上证红利"},
]

# 全市场口径（不是某个指数本身，是整个沪市/深市/创业板/科创板），上证指数只能用这个近似
MARKET_UNIVERSE: list[dict] = [
    {"code": "MKT1", "market_id": "1", "name": "沪市整体"},
    {"code": "MKT2", "market_id": "2", "name": "深市整体"},
    {"code": "MKT4", "market_id": "4", "name": "创业板整体"},
    {"code": "MKT7", "market_id": "7", "name": "科创板整体"},
]

_tls = threading.local()


def _wait() -> None:
    """所有出网请求都过这把闸，两次之间至少隔 MIN_INTERVAL 秒"""
    global _last_at
    with _gate:
        gap = time.time() - _last_at
        if gap < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - gap)
        _last_at = time.time()


def _token() -> str:
    """乐咕的 token 就是当天日期的 md5，跨天要重算"""
    return hashlib.md5(datetime.now().date().isoformat().encode("utf-8")).hexdigest()


def _csrf_headers() -> dict:
    """页面 meta[name=_csrf] 里的令牌要和 session cookie 配对，先取一次缓存半小时"""
    cached = getattr(_tls, "csrf", None)
    if cached and time.time() - cached[1] < 1800:
        return cached[0]
    started = time.perf_counter()
    last, status = "unknown", 0
    for attempt in range(2):
        _wait()
        try:
            r = base.session().get(CSRF_PAGE, headers={"Referer": SITE + "/"}, timeout=20)
            status = r.status_code
            if r.status_code < 400:
                m = re.search(r'name="_csrf"[^>]*content="([^"]+)"', r.text) \
                    or re.search(r'content="([^"]+)"[^>]*name="_csrf"', r.text)
                if m:
                    headers = {"Referer": SITE + "/", "X-CSRF-Token": m.group(1)}
                    base.record_ok(PROVIDER, "index_valuation", True, started)
                    _tls.csrf = (headers, time.time())
                    return headers
                last = "页面里没有 _csrf 令牌（多半被拦或改版）"
            else:
                last = f"HTTP {r.status_code}"
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
        _tls.csrf = None
        time.sleep(0.5 * (attempt + 1))
    base.record_fail(PROVIDER, "index_valuation", last, status, started)
    raise ProviderError(PROVIDER, "index_valuation", f"取 CSRF 令牌失败：{last}", status)


def _get(url: str, params: dict, capability: str) -> list[dict]:
    headers = _csrf_headers()
    started = time.perf_counter()
    last, status = "unknown", 0
    for attempt in range(3):
        _wait()
        try:
            r = base.session().get(url, params={**params, "token": _token()},
                                   headers={**headers, "User-Agent": base.UA}, timeout=25)
            status = r.status_code
            if status == 429:
                last = "HTTP 429 上游限流"
                _tls.csrf = None
                time.sleep(3.0 * (attempt + 1))
                continue
            if status >= 400:
                last = f"HTTP {status}"
                _tls.csrf = None
                time.sleep(0.6 * (attempt + 1))
                continue
            try:
                j = r.json()
            except ValueError:
                last = "返回不是 JSON（被拦或改版）"
                _tls.csrf = None
                time.sleep(0.6 * (attempt + 1))
                continue
            rows = j.get("data")
            if not isinstance(rows, list):
                last = f"接口没给 data 列表：{str(j)[:120]}"
                # 代码不在乐咕覆盖范围时它回 {"data":[],"vip":false}，这是正常空集不是故障
                base.record_ok(PROVIDER, capability, [], started)
                return []
            base.record_ok(PROVIDER, capability, rows, started)
            return rows
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
            _tls.csrf = None
            time.sleep(0.6 * (attempt + 1))
    base.record_fail(PROVIDER, capability, last, status, started)
    raise ProviderError(PROVIDER, capability, last, status)


def _num(v) -> float | None:
    if isinstance(v, (int, float)):
        return round(float(v), 4)
    return None


def _date(v) -> str:
    """上游给的是 UTC 时间戳或 ISO 串，统一成 YYYY-MM-DD"""
    s = str(v or "")
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else ""


def index_pe(index_code: str) -> list[dict]:
    """整体法/等权/中位数三种口径的滚动市盈率 + 各自历史分位"""
    rows = _get(PE_API, {"indexCode": index_code}, "index_valuation")
    out = []
    for r in rows:
        d = _date(r.get("date"))
        if not d:
            continue
        out.append({"date": d, "close": _num(r.get("close")),
                    "pe": _num(r.get("addTtmPe")), "pe_quantile": _num(r.get("addTtmPeQuantile")),
                    "pe_equal": _num(r.get("ttmPe")), "pe_median": _num(r.get("middleTtmPe"))})
    out.sort(key=lambda x: x["date"])
    return out


def index_pb(index_code: str) -> list[dict]:
    rows = _get(PB_API, {"indexCode": index_code}, "index_valuation")
    out = []
    for r in rows:
        d = _date(r.get("date"))
        if not d:
            continue
        out.append({"date": d, "pb": _num(r.get("addPb")), "pb_quantile": _num(r.get("addPbQuantile")),
                    "pb_equal": _num(r.get("middlePb"))})
    out.sort(key=lambda x: x["date"])
    return out


def market_pe(market_id: str) -> list[dict]:
    """沪市/深市/创业板/科创板整体的市盈率（月度）；科创板走单独那条接口"""
    if str(market_id) == "7":
        rows = _get(STAR_PE_API, {}, "market_valuation")
    else:
        rows = _get(MARKET_PE_API, {"marketId": market_id}, "market_valuation")
    out = []
    for r in rows:
        d = _date(r.get("date"))
        if not d:
            continue
        pe = r.get("pe")
        if not isinstance(pe, (int, float)):
            pe = r.get("addTtmPe")
        out.append({"date": d, "close": _num(r.get("close")), "pe": _num(pe)})
    out.sort(key=lambda x: x["date"])
    return out


def market_pb(market_id: str) -> list[dict]:
    """同一条 index-basic-pb 接口，把市场编号当 indexCode 传就能拿市场口径的 PB"""
    rows = _get(PB_API, {"indexCode": str(market_id)}, "market_valuation")
    out = []
    for r in rows:
        d = _date(r.get("date"))
        if not d:
            continue
        out.append({"date": d, "pb": _num(r.get("addPb")),
                    "pb_quantile": _num(r.get("addPbQuantile")),
                    "pb_equal": _num(r.get("middlePb"))})
    out.sort(key=lambda x: x["date"])
    return out
