"""基础数据 / 财务报表 / 财务指标（拆解文档 2.1 路由 30、39、40）"""
from __future__ import annotations

import threading
import time
from typing import Any

from .. import db
from ..providers import registry, sina
from ..providers.base import ProviderError, norm_symbol
from . import indicators, market

_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()


def _cached(key: str, fn, ttl: float = 120.0):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def secucode(symbol: str) -> str:
    """sh600519 -> 600519.SH，东财 F10 报表要这个口径"""
    n = norm_symbol(symbol)
    return f"{n['code']}.{n['prefix'].upper()}"


def profile(symbol: str) -> dict:
    try:
        n = norm_symbol(symbol)
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}
    sym, code, secu = n["symbol"], n["code"], secucode(symbol)
    errors: dict[str, str] = {}
    snap = market.snapshot_row(sym) or {}
    quote = None
    try:
        rows = registry.realtime([sym])
        quote = rows[0] if rows else None
    except ProviderError as exc:
        errors["realtime"] = exc.message

    def _load(fn, key):
        try:
            return fn()
        except ProviderError as exc:
            errors[key] = exc.message
            return []
        except Exception as exc:  # noqa: BLE001
            errors[key] = f"{type(exc).__name__}: {exc}"[:160]
            return []

    data = _cached(f"profile:{sym}", lambda: {
        "f10": _load(lambda: registry.f10(secu), "finance_main"),
        "holders": _load(lambda: registry.top_holders(secu), "holders"),
        "performance": _load(lambda: registry.performance(code), "performance"),
        "survey": _load(lambda: registry.org_survey(365, code=code), "org_survey"),
    })
    fund = _load(lambda: sina.money_flow_stock(sym), "fund_flow")
    return {
        "ok": True,
        "symbol": sym, "code": code, "secucode": secu,
        "name": (quote or {}).get("name") or snap.get("name") or code,
        "quote": quote or snap or None,
        "mainFinancials": data["f10"],
        "performance": data["performance"],
        "topHolders": data["holders"],
        "surveys": (data["survey"] or [])[:20],
        "fundFlow": list(reversed(fund or []))[:20],
        "boards": [dict(r) for r in db.query(
            "SELECT kind,board_code,board_name FROM stock_board WHERE symbol=? ORDER BY kind DESC LIMIT 20",
            (sym,))],
        "errors": errors,
        "note": "财务摘要/十大流通股东/业绩报表取自东财 F10 报表，按报告期倒序；调研记录为近 90 天",
        "generatedAt": db.now(),
    }


def events(kind: str, days: int = 60, keyword: str = "", limit: int = 80) -> dict:
    """解禁日历 / 机构调研 / 股东增减持：基础数据页的三个列表"""
    def load():
        try:
            if kind == "lockup":
                rows = registry.lockup(days)
                rows.sort(key=lambda x: -(x.get("marketCapYi") or 0))
                return {"rows": rows, "error": None}
            if kind == "survey":
                rows = registry.org_survey(days)
                agg: dict[str, dict] = {}
                for r in rows:
                    key = f"{r.get('symbol')}|{r.get('date')}"
                    it = agg.get(key)
                    if it is None:
                        it = agg[key] = {**r, "orgs": [], "attendees": 0}
                    it["attendees"] += 1
                    if r.get("org") and r["org"] not in it["orgs"]:
                        it["orgs"].append(r["org"])
                    if isinstance(r.get("orgTotal"), (int, float)):
                        it["orgCount"] = max(it.get("orgCount") or 0, r["orgTotal"])
                merged = list(agg.values())
                for it in merged:
                    # NUM 是单条记录自带的机构数，同一天多场调研会给出不同的值，
                    # 去重后的机构名单才是「这天来了多少家」
                    it["orgCount"] = len(it["orgs"]) or it.get("orgCount")
                    it["orgSample"] = "、".join(it.pop("orgs")[:6])
                merged.sort(key=lambda x: (x.get("date") or "", x.get("orgCount") or 0), reverse=True)
                return {"rows": merged, "error": None}
            return {"rows": registry.holder_changes(days), "error": None}
        except ProviderError as exc:
            return {"rows": [], "error": exc.message}
        except Exception as exc:  # noqa: BLE001
            return {"rows": [], "error": f"{type(exc).__name__}: {exc}"[:200]}

    data = _cached(f"events:{kind}:{days}", load, 300)
    rows = data["rows"]
    kw = keyword.strip()
    if kw:
        keys = ("name", "symbol", "holder", "org", "title", "type", "way", "content")
        rows = [r for r in rows if any(kw in str(r.get(k) or "") for k in keys)]
    out = [dict(r) for r in rows[:limit]]
    totalCap = round(sum(r.get("marketCapYi") or 0 for r in rows), 2) if kind == "lockup" else None
    increase = sum(1 for r in rows if r.get("direction") == "增持") if kind == "holder_change" else None
    return {"kind": kind, "days": days, "rows": out, "total": len(rows),
            "shown": len(out), "keyword": kw, "error": data["error"],
            "sumMarketCapYi": totalCap, "increaseCount": increase,
            "generatedAt": db.now()}


def statements(symbol: str) -> dict:
    """财务报表：三大报表口径的关键科目按报告期排开"""
    try:
        n = norm_symbol(symbol)
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}
    secu = secucode(symbol)
    errors: dict[str, str] = {}
    try:
        rows = registry.f10(secu)
    except ProviderError as exc:
        rows = []
        errors["finance_main"] = exc.message
    try:
        perf = registry.performance(n["code"])
    except ProviderError as exc:
        perf = []
        errors["performance"] = exc.message

    def yi(v):
        return round(v / 1e8, 3) if isinstance(v, (int, float)) else None

    series = [{
        "reportDate": r.get("reportDate"), "reportName": r.get("reportName"),
        "reportType": r.get("reportType"), "noticeDate": r.get("noticeDate"),
        "revenue": yi(r.get("revenue")), "revenueYoy": r.get("revenueYoy"),
        "netProfit": yi(r.get("netProfit")), "profitYoy": r.get("profitYoy"),
        "deductProfit": yi(r.get("deductProfit")), "deductYoy": r.get("deductYoy"),
        "eps": r.get("eps"), "epsDeduct": r.get("epsDeduct"),
        "bps": r.get("bps"), "cashPerShare": r.get("cashPerShare"),
        "roe": r.get("roe"), "roeDeduct": r.get("roeDeduct"), "roic": r.get("roic"),
        "grossMargin": r.get("grossMargin"), "netMargin": r.get("netMargin"),
        "debtRatio": r.get("debtRatio"), "currentRatio": r.get("currentRatio"),
        "quickRatio": r.get("quickRatio"), "assetTurn": r.get("assetTurn"),
        "inventoryTurn": r.get("inventoryTurn"), "receivableTurn": r.get("receivableTurn"),
    } for r in rows]
    snap = market.snapshot_row(n["symbol"]) or {}
    return {
        "ok": True, "symbol": n["symbol"], "secucode": secu,
        "name": snap.get("name") or n["code"],
        "rows": series, "performance": perf, "errors": errors,
        "units": {"revenue": "亿元（累计口径）", "netProfit": "亿元", "deductProfit": "亿元",
                  "revenueYoy": "%", "profitYoy": "%", "deductYoy": "%", "roe": "%",
                  "roic": "%", "grossMargin": "销售毛利率 %", "netMargin": "销售净利率 %",
                  "debtRatio": "资产负债率 %", "currentRatio": "流动比率", "quickRatio": "速动比率",
                  "assetTurn": "总资产周转天数", "inventoryTurn": "存货周转天数",
                  "receivableTurn": "应收账款周转天数", "cashPerShare": "每股经营现金流(元)",
                  "bps": "每股净资产(元)", "eps": "每股收益(元)"},
        "note": "东财 F10 主要财务指标：营业收入/归母净利润为累计口径（一季报=1-3月），同比对去年同期；"
                "周转类字段是天数，越小越快",
        "generatedAt": db.now(),
    }


def technical(symbol: str, days: int = 250) -> dict:
    """财务指标页的技术面 + 估值双表：均线/MACD/KDJ/RSI/布林 + 每股指标"""
    try:
        n = norm_symbol(symbol)
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}
    errors: dict[str, str] = {}
    bars: list[dict] = []
    try:
        bars = registry.kline_daily(n["symbol"], min(days, 500))
    except ProviderError as exc:
        errors["kline"] = exc.message
    try:
        fin = registry.f10(secucode(symbol))
    except ProviderError as exc:
        fin = []
        errors["finance_main"] = exc.message
    if not bars:
        return {"ok": False, "symbol": n["symbol"], "message": "没有拿到日线数据",
                "errors": errors, "rows": []}

    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    dif, dea, hist = indicators.macd(closes)
    boll_mid, boll_up, boll_low, boll_width = indicators.boll(closes)
    kdj_k, kdj_d, kdj_j, kdj_kp, kdj_dp = indicators.kdj(highs, lows, closes)
    rows = []
    for i, b in enumerate(bars):
        rows.append({
            "date": b.get("day") or b.get("date"), "open": b.get("open"),
            "high": b.get("high"), "low": b.get("low"), "close": b.get("close"),
            "volume": b.get("volume"), "amount": b.get("amount"),
            "ma5": _ma(closes, i, 5), "ma10": _ma(closes, i, 10), "ma20": _ma(closes, i, 20),
            "ma60": _ma(closes, i, 60),
            "macd": _at(dif, i), "signal": _at(dea, i), "hist": _at(hist, i),
            "rsi": indicators.rsi(closes[:i + 1]) if i >= 14 else None,
            "changePercent": round((b["close"] / closes[i - 1] - 1) * 100, 2)
                             if i and closes[i - 1] else None,
        })
    rows.reverse()
    last = rows[0]
    snap = market.snapshot_row(n["symbol"]) or {}
    return {
        "ok": True, "symbol": n["symbol"],
        "name": snap.get("name") or n["code"],
        "count": len(rows), "rows": rows[:120],
        "latest": {**{k: last[k] for k in ("close", "ma5", "ma10", "ma20", "ma60",
                                           "macd", "hist", "rsi", "changePercent")},
                   "kdjK": kdj_k, "kdjD": kdj_d, "kdjJ": kdj_j,
                   "kdjKPrev": kdj_kp, "kdjDPrev": kdj_dp},
        "boll": {"mid": boll_mid, "upper": boll_up, "lower": boll_low, "width": boll_width},
        "atr": indicators.atr_pct(highs, lows, closes),
        "momentum": {"r5": _mom(closes, 5), "r20": _mom(closes, 20), "r60": _mom(closes, 60)},
        "financial": [{
            "reportDate": r.get("reportDate"), "reportName": r.get("reportName"),
            "eps": r.get("eps"), "roe": r.get("roe"), "roic": r.get("roic"),
            "bps": r.get("bps"), "cashPerShare": r.get("cashPerShare"),
            "grossMargin": r.get("grossMargin"), "netMargin": r.get("netMargin"),
            "debtRatio": r.get("debtRatio"), "revenueYoy": r.get("revenueYoy"),
            "profitYoy": r.get("profitYoy"), "currentRatio": r.get("currentRatio"),
            "assetTurn": r.get("assetTurn"),
        } for r in fin],
        "note": "指标全部由本地日线实时计算（MA/EMA/MACD/KDJ/RSI/BOLL/ATR），财务列来自东财 F10",
        "errors": errors, "generatedAt": db.now(),
    }


def _ma(vals: list[float], i: int, n: int) -> float | None:
    if i + 1 < n:
        return None
    return round(sum(vals[i + 1 - n:i + 1]) / n, 3)


def _at(series, i: int) -> float | None:
    if not isinstance(series, list) or i >= len(series):
        return None
    v = series[i]
    return round(float(v), 4) if isinstance(v, (int, float)) else None


def _mom(closes: list[float], n: int) -> float | None:
    if len(closes) <= n:
        return None
    base = closes[-1 - n]
    return round((closes[-1] / base - 1) * 100, 2) if base else None
