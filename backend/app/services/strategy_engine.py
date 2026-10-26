"""策略引擎：全市场扫描、命中判定、评分、异步运行、选股结果、胜率回测

- 内置策略用 RULES 里的判定函数（读 indicators.build_features 的特征行）
- 自定义/AI 策略用 code_text（META + basic_filter + scoring），在受限命名空间里执行
- 叠加策略 = 子策略评分加权和
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime
from typing import Any, Callable

from .. import config, db
from ..providers import registry
from ..providers.base import norm_symbol
from . import indicators as ind
from . import kline, market
from .strategy_defs import BY_CODE, COMMON_FILTERS

_runs_lock = threading.Lock()
BARS_WINDOW = 130
BOARD_LABEL = {"sh_main": "沪主板", "sz_main": "深主板", "chinext": "创业板",
               "star": "科创板", "bse": "北交所"}


# --------------------------------------------------------------- 参数与过滤
def merged_params(row: dict) -> dict:
    spec = BY_CODE.get(row.get("strategy_type") or "")
    base = dict(spec["params"]) if spec else {}
    try:
        saved = json.loads(row.get("params") or "{}")
    except Exception:
        saved = {}
    hard = saved.get("hard") or {}
    base.update({k: v for k, v in hard.items() if v is not None})
    base["max_output"] = saved.get("max_output", 100)
    base["min_score"] = saved.get("min_score", 55)
    base.update(saved.get("filters") or {})
    return base


def _num(v: Any, default: float | None = None) -> float | None:
    try:
        return default if v is None else float(v)
    except (TypeError, ValueError):
        return default


def common_filter(f: dict, p: dict) -> tuple[bool, list[str]]:
    """文档 3.5.7 通用基础过滤"""
    reasons: list[str] = []
    if p.get("exclude_st", True) and f["is_st"]:
        reasons.append("ST")
    lo, hi = _num(p.get("price_min")), _num(p.get("price_max"))
    if lo and f["close"] < lo:
        reasons.append(f"价格 {f['close']} < {lo}")
    if hi and f["close"] > hi:
        reasons.append(f"价格 {f['close']} > {hi}")
    amin = _num(p.get("amount_min"))
    if amin and (f["amount"] or 0) < amin:
        reasons.append("成交额不足")
    amax = _num(p.get("amount_max"))
    if amax and (f["amount"] or 0) > amax:
        reasons.append("成交额超限")
    tmin, tmax = _num(p.get("turnover_rate_min")), _num(p.get("turnover_rate_max"))
    tv = f.get("turnover")
    if tv is not None:
        if tmin is not None and tv < tmin:
            reasons.append(f"换手 {tv}% < {tmin}%")
        if tmax is not None and tv > tmax:
            reasons.append(f"换手 {tv}% > {tmax}%")
    cmin, cmax = _num(p.get("float_cap_min")), _num(p.get("float_cap_max"))
    cap = f.get("float_cap_yi")
    if cap is not None:
        if cmin and cap < cmin:
            reasons.append(f"流通市值 {cap:.0f}亿 < {cmin:.0f}亿")
        if cmax and cap > cmax:
            reasons.append(f"流通市值 {cap:.0f}亿 > {cmax:.0f}亿")
    boards = p.get("boards")
    if boards and f["board"] not in boards:
        reasons.append(f"板块 {BOARD_LABEL.get(f['board'], f['board'])} 未勾选")
    return (not reasons), reasons


# ------------------------------------------------------------------- 评分
def _band(v, lo, hi, out_lo=0.0, out_hi=100.0) -> float:
    if v is None:
        return 0.0
    if hi == lo:
        return out_hi
    x = max(0.0, min(1.0, (float(v) - lo) / (hi - lo)))
    return round(out_lo + x * (out_hi - out_lo), 2)


def dim_score(dim: str, f: dict) -> float:
    if dim == "momentum_60d":
        return _band(f.get("mom60"), -10, 40)
    if dim == "momentum_20d":
        return _band(f.get("mom20"), -10, 25)
    if dim == "momentum":
        return _band(f.get("mom5"), -6, 12)
    if dim == "turnover_rate":
        return _band(f.get("turnover"), 0.5, 18)
    if dim == "trend":
        up = sum(1 for k in ("ma5_up", "ma10_up", "ma20_up", "ma60_up") if f.get(k))
        return round(up * 25.0, 2)
    if dim == "activity":
        return _band(f.get("vol_ratio"), 0.6, 4)
    if dim == "reversal":
        r = f.get("rsi14")
        return 0.0 if r is None else round(max(0.0, min(100.0, (60 - r) / 30 * 100)), 2)
    if dim == "liquidity":
        amt = f.get("amount") or 0
        return _band(min(amt, 5e9) / 1e8, 0.5, 30)
    if dim == "strength":
        s = 0.0
        if f.get("ma_bullish"):
            s += 30
        if f.get("macd_above_zero"):
            s += 20
        s += _band(f.get("pct_chg"), 0, 9.8, 0, 30)
        s += _band(f.get("vol_ratio"), 1, 3, 0, 20)
        return round(min(s, 100.0), 2)
    return 0.0


def score_of(f: dict, dims: list[str], weights: dict | None = None) -> float:
    if not dims:
        return 0.0
    weights = weights or {}
    tw = sum(weights.get(d, 1.0) for d in dims)
    return round(sum(dim_score(d, f) * weights.get(d, 1.0) for d in dims) / tw, 2)


def _ma_support(f: dict, period: float, tolerance: float) -> bool:
    mab = f.get("ma_by_period") or {}
    best = None
    for k in mab:
        if best is None or abs(k - period) < abs(best - period):
            best = k
    ma = mab.get(best) if best is not None else None
    return bool(ma and f["close"] >= ma * (1 - tolerance / 100))


def _vr_ok(f: dict, p: dict) -> bool:
    if not p.get("enable_volume_filter", True):
        return True
    vr = f.get("vol_ratio")
    return vr is not None and vr >= _num(p.get("min_volume_ratio"), 1.0)


def _in(v, lo, hi) -> bool:
    return v is not None and lo <= v <= hi


# ------------------------------------------------------------- 内置策略判定
RULES: dict[str, Callable[[dict, dict], tuple[bool, list[str]]]] = {
    "ma_bullish": lambda f, p: (
        (not p.get("require_ma_bullish", True) or f["ma_bullish"])
        and (not p.get("require_momentum_20d_positive", True) or (f.get("mom20") or 0) > 0)
        and _vr_ok(f, p),
        ["均线多头" if f["ma_bullish"] else "", "20日动量为正" if (f.get("mom20") or 0) > 0 else "",
         f"量比{f.get('vol_ratio')}" if f.get("vol_ratio") else ""]),
    "macd_golden_cross": lambda f, p: (
        f["macd_cross"] and _vr_ok(f, p),
        ["MACD金叉", "零轴上方" if f["macd_above_zero"] else "零轴下方"]),
    "limit_up_gene": lambda f, p: (
        f.get("limit_up_20", 0) >= int(p.get("min_limit_up", 1))
        and _ma_support(f, _num(p.get("ma_support_period"), 10), _num(p.get("tolerance"), 3)),
        [f"20日涨停{f.get('limit_up_20')}次", f"距上次涨停{f.get('days_since_limit')}日"]),
    "volume_breakout": lambda f, p: (
        f["boll_break"] and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5)
        and f["close"] >= f["h20"] * 0.99,
        ["突破布林上轨", f"20日新高" if f["close"] >= f["h20"] * 0.99 else ""]),
    "rsi_reversal": lambda f, p: (
        _in(f.get("rsi14"), -1, _num(p.get("rsi_oversold"), 35))
        and (not p.get("require_close_up", True) or (f.get("pct_chg") or 0) > 0),
        [f"RSI{f.get('rsi14')}超卖", "收阳" if (f.get("pct_chg") or 0) > 0 else ""]),
    "ma_golden_cross": lambda f, p: (
        f["ma_cross"] and _vr_ok(f, p), ["5日上穿10日"]),
    "bottom_volume": lambda f, p: (
        (f.get("mom60") or 0) <= -_num(p.get("min_drawdown"), 15)
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.8),
        [f"60日跌{abs(f.get('mom60') or 0):.1f}%", f"量比{f.get('vol_ratio')}"]),
    "box_oscillation": lambda f, p: (
        f.get("box_width") is not None and f["box_width"] <= _num(p.get("max_box_width"), 15)
        and f["close"] <= f["l20"] * (1 + _num(p.get("bottom_tolerance"), 5) / 100) * 1.06,
        [f"箱体宽度{f.get('box_width')}%"]),
    "chan_theory": lambda f, p: (
        (f.get("pct_chg") or 0) >= _num(p.get("min_change"), 5)
        and (f.get("turnover") or 0) >= _num(p.get("min_turnover"), 5)
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5),
        ["涨幅≥5%", "换手≥5%", f"量比{f.get('vol_ratio')}"]),
    "dragon_head": lambda f, p: (
        f.get("up_shadow") is not None and f["up_shadow"] <= _num(p.get("max_up_shadow"), 3)
        and _in(f.get("rsi14"), _num(p.get("rsi_ice"), 40) - 8, _num(p.get("rsi_ice"), 40) + 14)
        and _vr_ok(f, p),
        [f"上影{f.get('up_shadow')}%", f"RSI{f.get('rsi14')}"]),
    "emotion_cycle": lambda f, p: (
        (f.get("pct_chg") or 0) >= _num(p.get("min_change"), 3)
        and (f.get("turnover") or 0) >= _num(p.get("min_turnover"), 3)
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5),
        ["涨幅≥3%", "换手≥3%", f"量比{f.get('vol_ratio')}"]),
    "event_driven": lambda f, p: (
        (f.get("mom20") or 0) >= _num(p.get("min_momentum_20d"), 5)
        and _in(f.get("rsi14"), _num(p.get("rsi_low"), 45), _num(p.get("rsi_high"), 70))
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.2),
        [f"20日动量{f.get('mom20')}%"]),
    "expectation_repricing": lambda f, p: (
        (f.get("mom60") or 0) >= _num(p.get("min_momentum_60d"), 10)
        and f.get("vol20_pct") is not None and f["vol20_pct"] <= _num(p.get("max_volatility"), 3.5)
        and (f.get("amount") or 0) >= _num(p.get("min_amount"), 1e8),
        [f"60日动量{f.get('mom60')}%", f"20日波动{f.get('vol20_pct')}%"]),
    "growth_quality": lambda f, p: (
        (f.get("pct_chg") or 0) >= _num(p.get("min_change"), 2)
        and (f.get("turnover") or 0) >= _num(p.get("min_turnover"), 5)
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5),
        ["涨幅≥2%", "换手≥5%"]),
    "hot_theme": lambda f, p: (
        f["is_yin"] and f.get("vol_vs_prev") is not None
        and f["vol_vs_prev"] <= _num(p.get("max_shrink_ratio"), 0.8)
        and _ma_support(f, _num(p.get("ma_support_period"), 10), _num(p.get("tolerance"), 3)),
        [f"阴线缩量{f.get('vol_vs_prev')}", "均线支撑"]),
    "one_yang_three_yin": lambda f, p: (
        f["one_yang_three_yin"] and f.get("vol_vs_prev") is not None
        and f["vol_vs_prev"] >= 1.2
        and _in(f.get("rsi14"), _num(p.get("rsi_low"), 45), _num(p.get("rsi_high"), 70)),
        ["一阳穿三阴"]),
    "shrink_pullback": lambda f, p: (
        (f.get("limit_up_10") or 0) >= 1
        and f.get("shrink_after_limit") is not None
        and f["shrink_after_limit"] <= _num(p.get("max_pullback_volume_ratio"), 0.8)
        and _ma_support(f, _num(p.get("ma_support_period"), 10), _num(p.get("tolerance"), 3)),
        [f"10日内涨停{f.get('limit_up_10')}次", f"回调量能{f.get('shrink_after_limit')}"]),
    "limit_up_pullback": lambda f, p: (
        (f.get("limit_up_20") or 0) >= 1
        and f.get("shrink_after_limit") is not None
        and f["shrink_after_limit"] <= _num(p.get("max_pullback_volume_ratio"), 0.9)
        and _ma_support(f, _num(p.get("ma_support_period"), 5), _num(p.get("tolerance"), 3)),
        [f"20日内涨停{f.get('limit_up_20')}次", f"缩量{f.get('shrink_after_limit')}"]),
    "wave_theory": lambda f, p: (
        (f.get("mom20") or 0) >= _num(p.get("min_momentum_20d"), 0)
        and f.get("ma20_up") and f.get("mom60") is not None and f["mom60"] > 0,
        [f"20日动量{f.get('mom20')}%", "上升波段"]),
    "balanced_alpha": lambda f, p: (
        (f.get("mom20") or 0) >= _num(p.get("min_momentum_20d"), 0)
        and _in(f.get("rsi14"), _num(p.get("rsi_low"), 40), _num(p.get("rsi_high"), 75))
        and f.get("vol20_pct") is not None and f["vol20_pct"] <= _num(p.get("max_volatility"), 4.0)
        and (f.get("amount") or 0) >= 1e8,
        ["动量+RSI+波动+流动性均衡"]),
    "kdj_golden_cross": lambda f, p: (
        f["kdj_cross"] and f.get("kdj_j") is not None and f["kdj_j"] <= _num(p.get("max_j"), 20)
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.2),
        [f"KDJ金叉 J={f.get('kdj_j')}"]),
    "bollinger_squeeze": lambda f, p: (
        f.get("boll_width") is not None and f["boll_width"] <= _num(p.get("max_band_width"), 5)
        and f["boll_break"] and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5),
        [f"带宽{f.get('boll_width')}%收口", "放量突破上轨"]),
    "volume_price_divergence": lambda f, p: (
        f["divergence"] and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.2),
        ["价格新低量不新低（底背离）"]),
    "ma_hybrid_cross": lambda f, p: (
        f["ma_all_up"] and (f.get("ma_cross_days") is not None
                            and f["ma_cross_days"] <= _num(p.get("recent_cross_days"), 5)),
        ["5/10/20/60 均线同向上", f"{f.get('ma_cross_days')}日前金叉"]),
    "gap_up_strong": lambda f, p: (
        _in(f.get("gap_up"), _num(p.get("gap_low"), 2), _num(p.get("gap_high"), 5))
        and (not p.get("require_unfilled", True) or f["gap_unfilled"])
        and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 2.0),
        [f"跳空{f.get('gap_up')}%未回补"]),
}


# ----------------------------------------------------- 资金面/事件面（需外部数据）
def _enrich_fundflow(features: dict[str, dict]) -> list[str]:
    """主力资金流：新浪个股资金流排行只有当日快照，按当日值判定"""
    warns: list[str] = []
    try:
        rows = registry.stock_fund_flow(num=100)
    except Exception as exc:  # noqa: BLE001
        warns.append(f"个股主力资金流取数失败：{type(exc).__name__}")
        return warns
    for r in rows or []:
        sym = r.get("symbol") or ""
        if sym in features:
            f = features[sym]
            f["fund_net"] = float(r.get("netAmount") or 0)
            f["fund_net_ratio"] = float(r.get("netRatio") or 0)
            f["fund_in"] = float(r.get("inAmount") or 0)
            f["fund_out"] = float(r.get("outAmount") or 0)
    if not any("fund_net" in f for f in features.values()):
        warns.append("个股主力资金流接口本次返回为空")
    return warns


def _enrich_billboard(features: dict[str, dict], days: int = 10) -> list[str]:
    warns: list[str] = []
    try:
        seats = registry.billboard_seats(days=days)
    except Exception as exc:  # noqa: BLE001
        warns.append(f"龙虎榜席位取数失败：{type(exc).__name__}")
        return warns
    stat: dict[str, dict] = {}
    for s in seats or []:
        raw = (s.get("symbol") or "").strip()
        if not raw:
            continue
        try:
            sym = norm_symbol(raw)["symbol"]
        except ValueError:
            continue
        st = stat.setdefault(sym, {"net": 0.0, "hot": set(), "inst_net": 0.0, "dates": set()})
        net = float(s.get("net") or 0)
        st["net"] += net
        st["dates"].add(s.get("date"))
        if s.get("is_institution"):
            st["inst_net"] += net
        elif net > 0:
            st["hot"].add(s.get("dept") or "")
    for sym, st in stat.items():
        if sym in features:
            f = features[sym]
            f["lhb_net"] = round(st["net"], 2)
            f["lhb_hot_seats"] = len(st["hot"])
            f["lhb_inst_net"] = round(st["inst_net"], 2)
            f["lhb_days"] = len(st["dates"])
    if not stat:
        warns.append("近 %d 天龙虎榜席位数据为空" % days)
    return warns


def _enrich_events(features: dict[str, dict]) -> tuple[list[str], dict]:
    warns: list[str] = []
    extra: dict[str, Any] = {}
    try:
        hc = registry.holder_changes(days=30)
        inc: dict[str, float] = {}
        for r in hc or []:
            code = (r.get("symbol") or "").strip()
            if not code or r.get("direction") != "增持":
                continue
            sym = norm_symbol(code)["symbol"]
            inc[sym] = inc.get(sym, 0) + float(r.get("changeNum") or 0)
        extra["holder_increase"] = inc
        for sym, v in inc.items():
            if sym in features:
                features[sym]["holder_increase"] = v
    except Exception as exc:  # noqa: BLE001
        warns.append(f"股东增减持取数失败：{type(exc).__name__}")
    try:
        lk = registry.lockup(days=30)
        soon: dict[str, dict] = {}
        for r in lk or []:
            code = (r.get("symbol") or "").strip()
            if not code:
                continue
            sym = norm_symbol(code)["symbol"]
            soon[sym] = r
        extra["lockup"] = soon
        for sym in soon:
            if sym in features:
                features[sym]["lockup_soon"] = 1
    except Exception as exc:  # noqa: BLE001
        warns.append(f"限售解禁取数失败：{type(exc).__name__}")
    return warns, extra


def _rule_fund_or_event(code: str, f: dict, p: dict, ctx: dict) -> tuple[bool, list[str]]:
    if code == "main_force_inflow":
        net = f.get("fund_net")
        ratio = f.get("fund_net_ratio")
        return (net is not None and net > 0
                and (ratio or 0) >= _num(p.get("min_net_ratio"), 60)), \
            ([f"主力净流入{net/1e8:.2f}亿", f"净占比{ratio}%"] if net is not None else ["无资金流数据"])
    if code == "dragon_tiger_list":
        return ((f.get("lhb_hot_seats") or 0) >= int(p.get("min_hot_seats", 2))
                and (f.get("lhb_net") or 0) > 0), \
            [f"游资席位{f.get('lhb_hot_seats', 0)}个", f"龙虎榜净额{(f.get('lhb_net') or 0)/1e8:.2f}亿"]
    if code == "institution_buy":
        return (f.get("lhb_inst_net") or 0) > 0 and (f.get("lhb_days") or 0) >= int(p.get("min_days", 2)), \
            [f"机构净额{(f.get('lhb_inst_net') or 0)/1e8:.2f}亿", f"上榜{f.get('lhb_days', 0)}天"]
    if code == "northbound_inflow":
        ok = f.get("ma_bullish") and (f.get("north_net") or 0) > 0
        return bool(ok and (f.get("north_total") or 0) >= _num(p.get("min_net_amount"), 1e8)), \
            [f"北向净买{(f.get('north_net') or 0)/1e8:.2f}亿"]
    if code == "margin_buy_increase":
        return bool(f.get("margin_net") and f.get("ma_bullish")), [f"融资净买{f.get('margin_net')}"]
    if code == "auction_breakout":
        return ((f.get("vol_ratio") or 0) > _num(p.get("min_volume_ratio"), 3)
                and _in(f.get("open_change"), _num(p.get("change_low"), 1.5),
                        _num(p.get("change_high"), 4))
                and (f.get("float_cap_yi") or 9999) <= _num(p.get("max_float_cap"), 10)), \
            [f"竞价高开{f.get('open_change')}%", f"量比{f.get('vol_ratio')}"]
    if code == "block_hot_rotation":
        hot = ctx.get("hot_board_syms") or set()
        return (f["symbol"] in hot
                and (f.get("pct_chg") or 0) >= _num(p.get("min_board_change"), 2)), \
            [f"所属板块热度TOP{int(p.get('board_top_n', 3))}"]
    if code == "limit_up_cluster":
        y = ctx.get("yesterday_limit") or set()
        return (f["symbol"] in y
                and ((f.get("pct_chg") or 0) >= (f.get("limit_rate") or 9.5) - 0.5
                     or (f.get("open_change") or 0) >= _num(p.get("min_open_change"), 5))), \
            ["昨日涨停", f"今高开{f.get('open_change')}%"]
    if code == "big_shareholder_increase":
        return bool(f.get("holder_increase")) and \
            (f.get("drawdown_from_high60") or 0) <= -_num(p.get("min_drawdown_from_high"), 20), \
            [f"大股东净增持{f.get('holder_increase')}万股",
             f"距60日高点{f.get('drawdown_from_high60')}%"]
    if code == "lock_up_expiry_reversal":
        return bool(f.get("lockup_soon")) and (f.get("mom20") or 0) <= -_num(p.get("min_drawdown"), 10) \
            and (f.get("vol_ratio") or 0) >= _num(p.get("min_volume_ratio"), 1.5), \
            ["临近解禁", f"20日跌{abs(f.get('mom20') or 0):.1f}%", f"量比{f.get('vol_ratio')}"]
    return False, []


NON_TECH = {"northbound_inflow", "main_force_inflow", "dragon_tiger_list", "institution_buy",
            "margin_buy_increase", "auction_breakout", "block_hot_rotation", "limit_up_cluster",
            "big_shareholder_increase", "lock_up_expiry_reversal"}

DATA_GAP = {
    "northbound_inflow": "北向资金个股净买入上游已停止披露（东财 north_history 金额字段全为 null），本策略无法给出可靠结果",
    "margin_buy_increase": "东财两融明细报表 RPTA_WEB_RZRQ_GGMX 报「TRADE_DATE 列不存在」，融资数据源不可用",
}


# --------------------------------------------------------------- 自定义代码策略
SAFE_FUNCS = {
    "abs": abs, "min": min, "max": max, "len": len, "round": round, "float": float,
    "int": int, "list": list, "sum": sum, "bool": bool,
    "range": range, "enumerate": enumerate, "zip": zip, "sorted": sorted,
    "all": all, "any": any, "str": str, "dict": dict, "tuple": tuple,
}


class Series(list):
    """只支持策略模板需要的逐元素运算，避免引入 pandas/polars 依赖"""

    def _el(self, other, fn):
        if isinstance(other, (int, float)):
            return Series(fn(a, other) for a in self)
        n = min(len(self), len(other))
        return Series(fn(self[i], other[i]) for i in range(n))

    def __gt__(self, o):
        return self._el(o, lambda a, b: bool(a > b))

    def __lt__(self, o):
        return self._el(o, lambda a, b: bool(a < b))

    def __ge__(self, o):
        return self._el(o, lambda a, b: bool(a >= b))

    def __le__(self, o):
        return self._el(o, lambda a, b: bool(a <= b))

    def __and__(self, o):
        return self._el(o, lambda a, b: bool(a and b))

    def __or__(self, o):
        return self._el(o, lambda a, b: bool(a or b))

    def __invert__(self):
        return Series(not a for a in self)

    def __add__(self, o):
        return self._el(o, lambda a, b: a + b)

    def __sub__(self, o):
        return self._el(o, lambda a, b: a - b)

    def __mul__(self, o):
        return self._el(o, lambda a, b: a * b)

    def __truediv__(self, o):
        return self._el(o, lambda a, b: (a / b) if b else 0.0)

    # 常量写在左边（38 - df["rsi14"]）是反向打分的常见写法，反射运算要补齐
    def __radd__(self, o):
        return self.__add__(o)

    def __rsub__(self, o):
        return self._el(o, lambda a, b: b - a)

    def __rmul__(self, o):
        return self.__mul__(o)

    def __rtruediv__(self, o):
        return self._el(o, lambda a, b: (b / a) if a else 0.0)

    def __neg__(self):
        return Series(-a for a in self)

    def clip(self, lo, hi):
        return Series(min(max(a, lo), hi) for a in self)

    def fillna(self, v):
        return Series(v if a is None else a for a in self)

    def mean_last(self, n=1):
        vals = [a for a in self[-n:] if a is not None]
        return (sum(vals) / len(vals)) if vals else 0.0


class Frame:
    """df[col] -> Series；列来自特征表"""

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self._cols: dict[str, Series] = {}

    def __getitem__(self, key):
        if key not in self._cols:
            self._cols[key] = Series([(r.get(key) if r.get(key) is not None else 0) for r in self.rows])
        return self._cols[key]

    def __len__(self):
        return len(self.rows)


CODE_META_RE = re.compile(r"META\s*=\s*(\{.*?\n\})", re.S)
CODE_BAD = ("import ", "__", "exec(", "eval(", "open(", "os.", "sys.", "subprocess",
            "socket", "requests", "urllib", "getattr", "setattr", "globals", "locals")

# Series 只有逐元素运算 + clip/fillna/mean_last；下面是模型爱写的 pandas 时间序列/聚合方法，
# 截面数据（一行一只股票）上即使实现出来也没有意义，所以在静态检查阶段就拒掉
CODE_UNSUPPORTED_ATTR = re.compile(
    r"\.\s*(rolling|expanding|shift|diff|pct_change|ewm|resample|groupby|apply|"
    r"sort_values|sort_index|iloc|loc|values|to_list|to_dict|head|tail|cumsum|cumprod|"
    r"quantile|std|var|sum|mean|max|min|count|where|mask|rank|abs|round)\b")


def validate_code(code: str) -> dict:
    """文档 3.5.3：必须含 META / basic_filter / scoring。只做静态安全检查，不执行"""
    problems: list[str] = []
    if not code or len(code) > 50_000:
        problems.append("代码为空或超过 50KB")
    for bad in CODE_BAD:
        if bad in code:
            problems.append(f"代码包含禁止的写法：{bad.strip()}")
    # 注释、字符串和 META 里的中文不会用到这些方法，先把它们去掉再扫，减少误杀
    bare = re.sub(r"#.*", "", CODE_META_RE.sub("", code or ""))
    bare = re.sub(r"(\"\"\".*?\"\"\"|\"[^\"]*\"|'[^']*')", " ", bare, flags=re.S)
    used = sorted({m.group(1) for m in CODE_UNSUPPORTED_ATTR.finditer(bare)})
    if used:
        problems.append("序列只支持 > < >= <= & | ~ + - * / .clip .fillna .mean_last，"
                        "代码里用了不存在的 " + "、".join("." + u for u in used)
                        + "；窗口类指标请改用已预计算的列（ma/mom/h20/limit_up_10 等）")
    for need in ("META", "def basic_filter", "def scoring"):
        if need not in code:
            problems.append(f"缺少 {need}")
    meta = None
    m = CODE_META_RE.search(code or "")
    if m:
        raw = re.sub(r",\s*([}\]])", r"\1", re.sub(r"'", '"', m.group(1)))
        try:
            meta = json.loads(raw)
        except Exception:  # noqa: BLE001
            meta = {"raw": m.group(1)[:200]}
    return {"ok": not problems, "problems": problems, "meta": meta}


def run_custom_code(code: str, rows: list[dict]) -> tuple[list[dict], list[str]]:
    """在受限命名空间执行 basic_filter/scoring，返回命中行"""
    ns: dict[str, Any] = {"__builtins__": SAFE_FUNCS}
    exec(compile(code, "<strategy>", "exec"), ns)  # noqa: S102 - 已过 validate_code 静态检查
    basic = ns.get("basic_filter")
    scoring = ns.get("scoring")
    warns: list[str] = []
    if not callable(basic) or not callable(scoring):
        return [], ["策略代码未定义 basic_filter/scoring"]
    df = Frame(rows)
    mask = list(basic(df))
    scores = list(scoring(df))
    out = []
    for i, r in enumerate(rows):
        if i >= len(mask) or not mask[i]:
            continue
        s = scores[i] if i < len(scores) else 0
        try:
            s = max(0.0, min(100.0, float(s)))
        except (TypeError, ValueError):
            s = 0.0
        out.append({**r, "score": round(s, 2), "signals": ["自定义规则"]})
    if not out:
        warns.append("自定义代码在本次扫描范围内 0 命中，可能是条件过严")
    return out, warns


# ---------------------------------------------------------------- 运行入口
def universe(trade_date: str | None = None, asset_type: str = "stock") -> tuple[str, dict, list[str]]:
    date = trade_date or market.live_quote_date()
    rows = db.query("SELECT * FROM snapshot_stocks WHERE trade_date=?", (date,))
    spot = {r["symbol"]: dict(r) for r in rows}
    warns = []
    if not spot:
        warns.append("全市场快照缺失，先跑一次快照")
    return date, spot, warns


def build_context(code: str, spot: dict, date: str) -> tuple[dict, list[str]]:
    ctx: dict[str, Any] = {}
    warns: list[str] = []
    if code == "block_hot_rotation":
        rows = db.query("SELECT code FROM board_daily WHERE trade_date=? AND kind='concept'"
                        " ORDER BY change_percent DESC LIMIT 3", (date,))
        boards = [r["code"] for r in rows]
        if boards:
            qs = ",".join("?" * len(boards))
            members = db.query(
                f"SELECT DISTINCT symbol FROM stock_board WHERE kind='concept' AND board_code IN ({qs})",
                tuple(boards))
            ctx["hot_board_syms"] = {m["symbol"] for m in members}
        else:
            warns.append("板块热度数据缺失，板块轮动策略无候选")
    if code == "limit_up_cluster":
        prev = db.query_one("SELECT MAX(trade_date) d FROM limit_pool WHERE trade_date<?", (date,))
        pd = prev["d"] if prev else None
        rows = db.query("SELECT symbol FROM limit_pool WHERE trade_date=?", (pd,)) if pd else []
        ctx["yesterday_limit"] = {r["symbol"] for r in rows}
        if not rows:
            warns.append("昨日涨停池为空")
    return ctx, warns


def evaluate(strategy_row: dict, *, persist: bool = True, run_id: int | None = None) -> dict:
    """跑一次策略，写 strategy_run / strategy_pick"""
    started = time.perf_counter()
    stype = strategy_row.get("strategy_type") or ""
    p = merged_params(strategy_row)
    if run_id is None:
        run_id = db.execute(
            "INSERT INTO strategy_run(strategy_id,user_id,status,universe_count,started_at) VALUES(?,?,?,?,?)",
            (strategy_row["id"], strategy_row.get("user_id"), "running", 0, db.now()))
    else:
        db.execute("UPDATE strategy_run SET status='running' WHERE id=?", (run_id,))
        _job(run_id, state="running")
    warnings: list[str] = []
    picks: list[dict] = []
    universe_count = 0
    candidate_count = 0
    err = None
    try:
        if stype == "composite" or (strategy_row.get("composite") not in (None, "", "[]")):
            picks, universe_count, candidate_count, warnings = _run_composite(strategy_row, p)
        elif stype == "custom_code" or (strategy_row.get("code_text") and stype not in BY_CODE):
            date, spot, w = universe()
            warnings += w
            feats, w2 = kline.full_features(spot, date)
            warnings += w2
            universe_count = len(spot)
            rows = [f for f in feats.values() if common_filter(f, p)[0]]
            _attach_tags(rows)
            if strategy_row.get("engine") == "ai_code" or stype == "custom_code":
                hit, w2 = run_custom_code(strategy_row["code_text"], rows)
                warnings += w2
            else:
                hit = [dict(r, score=score_of(r, BY_CODE.get(stype, {}).get("dims", ["strength"])),
                            signals=["内置规则"]) for r in rows]
            picks = [h for h in hit if h["score"] >= p.get("min_score", 0)]
            candidate_count = len(hit)
        else:
            picks, universe_count, candidate_count, warnings = _run_builtin(stype, p, strategy_row)
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {exc}"  # 只放 error_message，再进 warnings 会在前端显示两遍
    picks.sort(key=lambda x: x.get("score") or 0, reverse=True)
    picks = picks[: int(p.get("max_output", 100) or 100)]
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    status = "error" if err else "ready"
    summary = (f"全市场 {universe_count} 只 → 过滤后候选 {candidate_count} 只 → 命中 {len(picks)} 只"
               f"（耗时 {elapsed/1000:.1f}s）")
    if persist:
        db.execute("DELETE FROM strategy_pick WHERE run_id=?", (run_id,))
        db.executemany(
            "INSERT OR REPLACE INTO strategy_pick(run_id,symbol,name,score,price,pct_chg,amount,"
            "turnover,volume_ratio,signals,concepts,industry) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [(run_id, x["symbol"], x.get("name"), x.get("score"), x.get("close"), x.get("pct_chg"),
              x.get("amount"), x.get("turnover"), x.get("vol_ratio"),
              json.dumps(x.get("signals") or [], ensure_ascii=False),
              json.dumps(x.get("concepts") or [], ensure_ascii=False), x.get("industry"))
             for x in picks[:500]])
        db.execute("UPDATE strategy SET last_run_at=?,last_pick_count=? WHERE id=?",
                   (db.now(), len(picks), strategy_row["id"]))
    # 选股结果落库后才把运行置为 ready，否则前端轮询会读到 0 条
    db.execute("UPDATE strategy_run SET status=?,universe_count=?,candidate_count=?,pick_count=?,"
               "elapsed_ms=?,error_message=?,data_warnings=?,summary=?,finished_at=? WHERE id=?",
               (status, universe_count, candidate_count, len(picks), elapsed, err,
                json.dumps(warnings, ensure_ascii=False), summary, db.now(), run_id))
    return {"run_id": run_id, "status": status, "pick_count": len(picks),
            "candidate_count": candidate_count, "universe_count": universe_count,
            "elapsed_ms": elapsed, "summary": summary, "data_warnings": warnings,
            "error_message": err, "items": picks}


def _run_builtin(stype: str, p: dict, row: dict) -> tuple[list[dict], int, int, list[str]]:
    date, spot, warnings = universe()
    universe_count = len(spot)
    if universe_count == 0:
        return [], 0, 0, warnings
    feats, w = kline.full_features(spot, date)
    warnings += w
    if stype in NON_TECH:
        gap = DATA_GAP.get(stype)
        if gap:
            warnings.append(gap)
            return [], universe_count, 0, warnings
        if stype == "main_force_inflow":
            warnings += _enrich_fundflow(feats)
        if stype in ("dragon_tiger_list", "institution_buy"):
            warnings += _enrich_billboard(feats, days=int(p.get("lookback_days", 10)))
        if stype in ("big_shareholder_increase", "lock_up_expiry_reversal"):
            w, _ = _enrich_events(feats)
            warnings += w
    ctx, w2 = build_context(stype, spot, date)
    warnings += w2
    spec = BY_CODE.get(stype) or {"dims": ["strength"], "name": stype}
    rule = RULES.get(stype)
    if rule is None:
        return [], universe_count, 0, warnings + [f"策略 {stype} 无判定实现"]
    if stype == "auction_breakout" and not market.market_phase()["trading"]:
        return [], universe_count, 0, warnings + ["该策略依赖盘中集合竞价数据，当前非交易时段无法运行，请于明日 9:25 后尝试"]
    hits = []
    candidate_count = 0
    for f in feats.values():
        ok_c, _ = common_filter(f, p)
        if not ok_c:
            continue
        candidate_count += 1
        try:
            if stype in NON_TECH:
                ok, sig = _rule_fund_or_event(stype, f, p, ctx)
            else:
                ok, sig = rule(f, p)
        except Exception:  # noqa: BLE001
            continue
        if not ok:
            continue
        s = score_of(f, spec["dims"])
        if s < float(p.get("min_score") or 0):
            continue
        hits.append({**f, "score": s, "signals": [x for x in sig if x]})
    _attach_tags(hits)
    return hits, universe_count, candidate_count, warnings


def _attach_tags(rows: list[dict]) -> None:
    """补行业/概念标签（来自本地板块成分表）"""
    tags = db.query("SELECT symbol,kind,board_name FROM stock_board")
    m: dict[str, dict[str, list[str]]] = {}
    for t in tags:
        d = m.setdefault(t["symbol"], {"industry": [], "concept": []})
        if len(d[t["kind"]]) < 6:
            d[t["kind"]].append(t["board_name"])
    for r in rows:
        got = m.get(r["symbol"]) or {}
        r["industry"] = (got.get("industry") or [None])[0]
        r["concepts"] = got.get("concept") or []


def _run_composite(row: dict, p: dict) -> tuple[list[dict], int, int, list[str]]:
    try:
        parts = json.loads(row.get("composite") or "[]")
    except Exception:
        parts = []
    if not isinstance(parts, list) or len(parts) < 2:
        return [], 0, 0, ["叠加策略至少需要 2 个子策略"]
    saved = json.loads(row.get("params") or "{}")
    common = saved.get("filters") or {}
    weights = {}
    universe_count = 0
    cand = 0
    total = sum(float(x.get("weight") or 0) for x in parts) or 100.0
    warnings: list[str] = []
    subs: dict[str, dict[float, dict]] = {}
    for part in parts:
        code = part.get("strategy_code") or part.get("strategy_type") or part.get("code")
        spec = BY_CODE.get(code)
        if not spec:
            warnings.append(f"子策略 {code} 不存在，已跳过")
            continue
        sub_p = dict(spec["params"])
        sub_p.update({"max_output": 500, "min_score": 0})
        sub_p.setdefault("filters", common)
        sub_p.update(common)
        if code == "composite":
            continue
        items, uc, cc, w = _run_builtin(code, sub_p, {"id": 0, "user_id": row.get("user_id")})
        warnings += w
        universe_count = max(universe_count, uc)
        weights[code] = float(part.get("weight") or 0) / total * 100
        subs[code] = {i["symbol"]: i for i in items}
    symbols = set()
    for s in subs.values():
        symbols |= set(s)
    out = []
    for sym in symbols:
        base = None
        score = 0.0
        sigs: list[str] = []
        for code, m in subs.items():
            it = m.get(sym)
            if it:
                base = base or it
                score += weights.get(code, 0) / 100 * float(it.get("score") or 0)
                sigs += it.get("signals") or []
            # 未命中的子策略按 0 分计入加权和（不剔除，保留"部分命中"信息）
        if base is None:
            continue
        cand += 1
        if score < float(p.get("min_score") or 0):
            continue
        out.append({**base, "score": round(score, 2),
                    "signals": sorted(set(sigs)) + [f"叠加:{'+'.join(weights.keys())}"],
                    "composite_detail": {c: (m.get(sym) or {}).get("score") for c, m in subs.items()}})
    return out, universe_count, cand, warnings


# ------------------------------------------------------------------ 胜率回测
def backtest_win_rate(strategy_type: str, *, days: int = 12, horizon: int = 5,
                      sample: int = 900) -> dict:
    """用本地日线抽样回测：命中后第 horizon 个交易日收盘价高于买入价记为一次胜利
    成本按往返 0.1% 计（文档 3.5.14A 要求提示滑点佣金）"""
    spec = BY_CODE.get(strategy_type)
    if not spec:
        return {"ok": False, "message": f"策略 {strategy_type} 非内置，暂不支持抽样回测"}
    p = dict(spec["params"])
    p.update({"min_score": 0, "max_output": 100,
              "exclude_st": True, "price_min": 5, "price_max": 200,
              "amount_min": 50000000, "float_cap_min": 30, "float_cap_max": 1500,
              "turnover_rate_min": 0.5, "turnover_rate_max": 18,
              "boards": ["sh_main", "sz_main", "chinext", "star"]})
    rule = RULES.get(strategy_type)
    if rule is None:
        return {"ok": False, "message": "该策略依赖资金面/事件面数据，抽样回测暂不支持"}
    top = db.query(
        "SELECT symbol FROM snapshot_stocks WHERE trade_date=? ORDER BY amount DESC LIMIT ?",
        (market.live_quote_date(), sample))
    symbols = [r["symbol"] for r in top]
    all_dates = [r["trade_date"] for r in db.query(
        "SELECT DISTINCT trade_date FROM kline_cache ORDER BY trade_date")]
    if len(all_dates) < horizon + days + 3:
        return {"ok": False,
                "message": f"本地日线缓存只有 {len(all_dates)} 个交易日，回测需要至少 {horizon + days + 3} 天，请先跑全市场日线刷新",
                "sample_days": len(all_dates)}
    if not symbols:
        return {"ok": False, "message": "全市场快照为空，无法取样回测标的"}
    rule_hits = strategy_type not in NON_TECH
    wins = total = 0
    per_day: list[dict] = []
    # 一次性把样本股的日线读进内存，按交易日切片，避免每天重复查库
    all_rows = db.query("SELECT symbol,trade_date,open,high,low,close,volume,amount"
                        " FROM kline_cache WHERE symbol IN (%s) ORDER BY symbol,trade_date"
                        % ",".join("?" * len(symbols)), tuple(symbols))
    series: dict[str, list[dict]] = {}
    for r in all_rows:
        series.setdefault(r["symbol"], []).append(dict(r))
    idx = len(all_dates) - horizon - 1
    start = max(days, idx - days)
    for di in range(start, idx):
        date = all_dates[di]
        hit_today = 0
        for sym, bars_full in series.items():
            cut = [b for b in bars_full if b["trade_date"] <= date]
            if len(cut) < 25 or len(bars_full) <= len(cut):
                continue
            f = ind.build_features(
                [{"day": b["trade_date"], "open": b["open"], "high": b["high"], "low": b["low"],
                  "close": b["close"], "volume": b["volume"]} for b in cut[-BARS_WINDOW:]],
                spot=None, symbol=sym)
            if not f:
                continue
            ok_c, _ = common_filter(f, p)
            if not ok_c or not rule_hits:
                continue
            try:
                ok, _ = rule(f, p)
            except Exception:  # noqa: BLE001
                continue
            if not ok:
                continue
            entry = f["close"]
            end_date = all_dates[min(di + horizon, len(all_dates) - 1)]
            later = [b for b in bars_full if b["trade_date"] > date]
            end_bar = next((b for b in later if b["trade_date"] >= end_date), None)
            if not end_bar:
                continue
            total += 1
            hit_today += 1
            if float(end_bar["close"]) > entry * 1.001:  # 往返成本 0.1%
                wins += 1
        per_day.append({"date": date, "hits": hit_today})
    rate = round(wins / total * 100, 1) if total else None
    return {"ok": True, "strategy_type": strategy_type, "horizon_days": horizon,
            "win_rate": rate, "samples": total, "sample_universe": len(symbols),
            "cost_note": "已按往返 0.1% 成本计，未计滑点与流动性冲击",
            "doc_win_rate": spec.get("win_rate_doc"),
            "per_day": per_day,
            "note": "抽样回测不等于实盘；回测含牛熊全周期，当前可能只匹配某一阶段"}


# --------------------------------------------------------------- 异步运行管理
_jobs: dict[int, dict] = {}


def _job(run_id: int, **kw) -> dict:
    j = _jobs.setdefault(run_id, {})
    j.update(kw)
    return j


def start_run(strategy_row: dict, user_id: int | None) -> dict:
    """按文档流程：先建 pending 运行记录，后台线程执行，前端轮询 picks"""
    stype = strategy_row.get("strategy_type") or ""
    spec = BY_CODE.get(stype)
    blocked = _schedule_block(strategy_row, spec)
    if blocked:
        run_id = db.execute(
            "INSERT INTO strategy_run(strategy_id,user_id,status,started_at,finished_at,error_message)"
            " VALUES(?,?,?,?,?,?)",
            (strategy_row["id"], user_id, "schedule-blocked", db.now(), db.now(), blocked))
        return {"id": run_id, "run_id": run_id, "status": "schedule-blocked", "message": blocked}
    run_id = db.execute(
        "INSERT INTO strategy_run(strategy_id,user_id,status,started_at) VALUES(?,?,?,?)",
        (strategy_row["id"], user_id, "pending", db.now()))
    _job(run_id, state="pending", message="正在深度扫描全市场...")
    threading.Thread(target=_worker, args=(run_id, strategy_row), daemon=True).start()
    return {"id": run_id, "run_id": run_id, "status": "pending"}


def _worker(run_id: int, strategy_row: dict) -> None:
    _job(run_id, state="running")
    try:
        res = evaluate(strategy_row, run_id=run_id)
        _job(run_id, state="ready", result=res)
    except Exception as exc:  # noqa: BLE001
        _job(run_id, state="error", message=f"{type(exc).__name__}: {exc}")


def _schedule_block(row: dict, spec: dict | None) -> str | None:
    rt = (spec or {}).get("run_time_type") or row.get("run_time_type") or "any"
    if rt == "any":
        return None
    if market.market_phase()["is_weekend"]:
        return "周末休市，该策略需要交易时段数据"
    if rt == "intraday" and not market.market_phase()["trading"]:
        return "该策略依赖盘中数据，当前非交易时段无法运行，请于交易时段内尝试"
    if rt == "after_hours" and market.market_phase()["trading"]:
        return "该策略为盘后分析策略，请于 15:00 后运行"
    return None


def poll_run(strategy_id: int, run_id: int, *, limit: int = 200) -> dict:
    row = db.query_one("SELECT * FROM strategy_run WHERE id=?", (run_id,))
    if not row:
        return {"status": "not-found", "run_id": run_id}
    if row["status"] in ("pending", "running", "schedule-blocked"):
        j = _jobs.get(run_id, {})
        elapsed = _elapsed_since(row["started_at"])
        hint = ("正在深度扫描全市场..." if elapsed < 20 else
                "数据量较大，正在极速计算中..." if elapsed < 40 else
                "即将完成，请稍候...")
        return {"status": row["status"], "run_id": run_id, "message": j.get("message") or hint,
                "elapsed_s": elapsed, "error_message": row["error_message"]}
    items = db.query(
        "SELECT * FROM strategy_pick WHERE run_id=? ORDER BY score DESC LIMIT ?", (run_id, limit))
    out = []
    for it in items:
        out.append({"symbol": it["symbol"], "name": it["name"], "score": it["score"],
                    "price": it["price"], "pct_chg": it["pct_chg"], "amount": it["amount"],
                    "turnover": it["turnover"], "volume_ratio": it["volume_ratio"],
                    "signals": _jsonl(it["signals"]), "concepts": _jsonl(it["concepts"]),
                    "industry": it["industry"]})
    return {"status": "ready", "run_id": run_id, "strategy_id": strategy_id,
            "pick_count": row["pick_count"], "candidate_count": row["candidate_count"],
            "universe_count": row["universe_count"], "elapsed_ms": row["elapsed_ms"],
            "summary": row["summary"], "data_warnings": _jsonl(row["data_warnings"]),
            "error_message": row["error_message"], "items": out}


def _jsonl(v) -> list:
    try:
        d = json.loads(v or "[]")
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _elapsed_since(ts: str | None) -> float:
    if not ts:
        return 0.0
    try:
        t = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        return round((datetime.now() - t).total_seconds(), 1)
    except Exception:
        return 0.0


def run_stats() -> dict:
    out = {}
    for r in db.query(
            "SELECT strategy_id, MAX(pick_count) c FROM strategy_run"
            " WHERE status='ready' GROUP BY strategy_id"):
        out[str(r["strategy_id"])] = r["c"] or 0
    return {"stats": out, "cached_at": db.now()}


def ensure_board_map(force: bool = False) -> None:
    """板块成分映射（策略结果的概念/行业标签 + 板块轮动策略要用）
    行业=新浪 hangye_Z*（证监会分类），概念=新浪 new_*（特色分类），实测对得上"""
    ok = db.query_one("SELECT COUNT(*) c FROM stock_board WHERE kind='industry' "
                      "AND board_code LIKE 'hangye_%'")
    if not force and ok and ok["c"] > 1500:
        return
    rows = []
    for kind in ("industry", "concept"):
        try:
            boards = registry.boards(kind)
        except Exception:
            continue
        for b in boards:
            try:
                members = sina_board_stocks(b["code"], num=120)
            except Exception:
                continue
            for m in members:
                rows.append((m.get("symbol"), kind, b["code"], b["name"]))
            time.sleep(0.04)
    if rows:
        db.execute("DELETE FROM stock_board")
        db.executemany("INSERT OR IGNORE INTO stock_board(symbol,kind,board_code,board_name)"
                       " VALUES(?,?,?,?)", rows)


def sina_board_stocks(code: str, num: int = 120) -> list[dict]:
    from ..providers import sina
    return sina.board_stocks(code, num=num)
