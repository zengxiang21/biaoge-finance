"""技术指标与逐票特征表

策略引擎不直接对 K 线做循环，而是先把每只股票的日线压缩成一行特征（feature dict），
策略只在这一张宽表上做过滤+打分。这样 35 个策略共享一次计算，全市场扫描秒级完成。
"""
from __future__ import annotations

from statistics import mean, pstdev
from typing import Sequence

BAR_KEYS = ("day", "open", "high", "low", "close", "volume")


def sma(vals: Sequence[float], n: int) -> float | None:
    if len(vals) < n:
        return None
    return round(mean(vals[-n:]), 6)


def ema_series(vals: Sequence[float], n: int) -> list[float]:
    if not vals:
        return []
    k = 2.0 / (n + 1.0)
    out = [vals[0]]
    for v in vals[1:]:
        out.append(out[-1] + k * (v - out[-1]))
    return out


def macd(closes: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """返回 (dif, dea, hist) 全序列"""
    ef = ema_series(closes, fast)
    es = ema_series(closes, slow)
    dif = [a - b for a, b in zip(ef, es)]
    dea = ema_series(dif, signal)
    hist = [(a - b) * 2 for a, b in zip(dif, dea)]
    return dif, dea, hist


def rsi(closes: Sequence[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag, al = mean(gains[:n]), mean(losses[:n])
    for i in range(n, len(gains)):
        ag = (ag * (n - 1) + gains[i]) / n
        al = (al * (n - 1) + losses[i]) / n
    if al == 0:
        return 100.0
    rs = ag / al
    return round(100 - 100 / (1 + rs), 2)


def kdj(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
        n: int = 9):
    """返回 (k, d, j, k_prev, d_prev)，无数据时全 None"""
    if len(closes) < n:
        return None, None, None, None, None
    ks, ds = [], []
    k_prev, d_prev = 50.0, 50.0
    for i in range(n - 1, len(closes)):
        hh = max(highs[i - n + 1: i + 1])
        ll = min(lows[i - n + 1: i + 1])
        rsv = 50.0 if hh == ll else (closes[i] - ll) / (hh - ll) * 100
        k_prev = 2 / 3 * k_prev + 1 / 3 * rsv
        d_prev = 2 / 3 * d_prev + 1 / 3 * k_prev
        ks.append(k_prev)
        ds.append(d_prev)
    j = 3 * ks[-1] - 2 * ds[-1]
    kp = ks[-2] if len(ks) >= 2 else None
    dp = ds[-2] if len(ds) >= 2 else None
    return (round(ks[-1], 2), round(ds[-1], 2), round(j, 2),
            (round(kp, 2) if kp is not None else None),
            (round(dp, 2) if dp is not None else None))


def boll(closes: Sequence[float], n: int = 20, k: float = 2.0):
    """返回 (中轨, 上轨, 下轨, 带宽%)"""
    if len(closes) < n:
        return None, None, None, None
    window = list(closes[-n:])
    mid = mean(window)
    sd = pstdev(window)
    up, low = mid + k * sd, mid - k * sd
    width = (up - low) / mid * 100 if mid else None
    return round(mid, 4), round(up, 4), round(low, 4), (round(width, 3) if width is not None else None)


def pivot(bar: dict) -> dict | None:
    """经典枢轴点：P=(H+L+C)/3，R1=2P-L，S1=2P-H，R2=P+(H-L)，S2=P-(H-L)"""
    if not bar:
        return None
    h, l, c = bar.get("high"), bar.get("low"), bar.get("close")
    if None in (h, l, c):
        return None
    p = (h + l + c) / 3
    return {"pivot": round(p, 3), "r1": round(2 * p - l, 3), "s1": round(2 * p - h, 3),
            "r2": round(p + (h - l), 3), "s2": round(p - (h - l), 3)}


def atr_pct(highs, lows, closes, n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
                        abs(lows[i] - closes[i - 1])))
    a = mean(trs[-n:])
    return round(a / closes[-1] * 100, 3) if closes[-1] else None


def _mom(closes: Sequence[float], n: int) -> float | None:
    if len(closes) <= n:
        return None
    base = closes[-1 - n]
    return round((closes[-1] - base) / base * 100, 3) if base else None


def board_of(symbol: str) -> str:
    code = symbol.split(".")[0]
    if code.startswith(("300", "301", "302")):
        return "chinext"
    if code.startswith(("688", "689")):
        return "star"
    if code.startswith(("83", "87", "88", "43", "92")):
        return "bse"
    if code.startswith("6"):
        return "sh_main"
    return "sz_main"


def limit_threshold(symbol: str, limit_rate: float | None) -> float:
    """涨停幅度阈值（百分数）：优先用快照里的 limit_rate（0.10/0.20/0.30/0.05），留 0.5% 容差"""
    if limit_rate:
        pct = limit_rate * 100 if limit_rate <= 1 else limit_rate
        if pct >= 5:
            return pct - 0.5
    code = symbol.split(".")[0].lstrip("abcdefghijklmnopqrstuvwxyz")
    if code.startswith(("300", "301", "688", "689")):
        return 19.5
    if code.startswith(("83", "87", "88", "43", "92")):
        return 29.5
    return 9.5


def build_features(bars: list[dict], *, spot: dict | None = None,
                   symbol: str = "", limit_rate: float | None = None) -> dict | None:
    """把一只股票的日线压成一行特征；bars 需按时间升序"""
    bars = [b for b in bars if b.get("close")]
    if len(bars) < 25:
        return None
    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"] or b["close"]) for b in bars]
    lows = [float(b["low"] or b["close"]) for b in bars]
    opens = [float(b["open"] or b["close"]) for b in bars]
    vols = [float(b["volume"] or 0) for b in bars]
    c = closes[-1]
    pc = closes[-2]

    def _ma(n):
        return sma(closes, n)

    ma5, ma10, ma20, ma60 = _ma(5), _ma(10), _ma(20), _ma(60)
    ma5_1 = sma(closes[:-1], 5)
    ma10_1 = sma(closes[:-1], 10)
    ma20_1 = sma(closes[:-1], 20)
    ma60_1 = sma(closes[:-1], 60)
    ma_by_period = {5: ma5, 10: ma10, 20: ma20, 60: ma60}
    ma5_up = bool(ma5 and ma5_1 and ma5 > ma5_1)
    ma10_up = bool(ma10 and ma10_1 and ma10 > ma10_1)
    ma20_up = bool(ma20 and ma20_1 and ma20 > ma20_1)
    ma60_up = bool(ma60 and ma60_1 and ma60 > ma60_1)

    dif, dea, hist = macd(closes)
    rsi14 = rsi(closes, 14)
    rsi6 = rsi(closes, 6)
    k, d, j, k_prev, d_prev = kdj(highs, lows, closes)
    bmid, bup, blow, bwidth = boll(closes, 20)

    v5 = mean(vols[-6:-1]) if len(vols) >= 6 else 0
    v20 = mean(vols[-20:])
    vol_ratio = round(vols[-1] / v5, 3) if v5 else None
    vol_ratio_20 = round(vols[-1] / v20, 3) if v20 else None

    # 涨跌停/涨停基因
    thr = limit_threshold(symbol, limit_rate)
    chg_series = []
    for i in range(1, len(closes)):
        chg_series.append((closes[i] - closes[i - 1]) / closes[i - 1] * 100 if closes[i - 1] else 0)
    def _count(window: int) -> tuple[int, int | None]:
        seg = chg_series[-window:]
        n_up = sum(1 for x in seg if x >= thr)
        days_ago = None
        for idx in range(len(seg) - 1, -1, -1):
            if seg[idx] >= thr:
                days_ago = len(seg) - 1 - idx
                break
        return n_up, days_ago
    limit_up_10, ago10 = _count(10)
    limit_up_20, ago20 = _count(20)
    limit_up_60, ago60 = _count(60)

    # 涨停后的缩量程度：以最近一次涨停日为界，之后均量 / 涨停日量
    shrink_after_limit = None
    ago = ago60
    if ago is not None and ago < len(vols):
        after = vols[len(vols) - 1 - ago:]
        base = vols[len(vols) - 1 - ago]
        if after and base:
            shrink_after_limit = round(mean(after) / base, 3)

    h20, l20 = max(highs[-20:]), min(lows[-20:])
    h60, l60 = max(highs[-60:]), min(lows[-60:])
    box_width = round((h20 - l20) / l20 * 100, 3) if l20 else None
    drawdown_from_high60 = round((c - h60) / h60 * 100, 3) if h60 else None
    mom60 = _mom(closes, 60)
    vol20_pct = round(pstdev(chg_series[-20:]), 3) if len(chg_series) >= 20 else None

    # 上影线：最高点相对实体上沿
    body_top = max(opens[-1], c)
    up_shadow = round((highs[-1] - body_top) / body_top * 100, 3) if body_top else None

    # 跳空缺口：今日最低 > 昨日最高
    gap_up = round((lows[-1] - highs[-2]) / highs[-2] * 100, 3) if len(highs) >= 2 else None
    gap_filled = None
    if gap_up is not None and gap_up > 0 and len(closes) >= 4:
        gap_filled = min(lows[-3:]) < highs[-2]

    # 量价底背离：价格创 20 日新低但量未创 20 日新低
    price_new_low = c <= l20 * 1.001
    vol_new_low = vols[-1] <= min(vols[-20:]) * 1.001
    divergence = bool(price_new_low and not vol_new_low and len(vols) >= 20)

    yin = [closes[i] < opens[i] for i in range(len(closes))]
    one_yang_three_yin = bool(
        len(chg_series) >= 4 and chg_series[-1] > 3
        and yin[-2] and yin[-3] and yin[-4]
        and (vols[-2] < vols[-3] and vols[-3] < vols[-4] if len(vols) >= 4 else False)
    )

    # 5/10 日均线金叉距今几天（None=未处于金叉状态）
    ma_cross_days = None
    if len(closes) >= 16 and ma5 and ma10 and ma5 > ma10:
        for back in range(0, 6):
            a = sma(closes[:len(closes) - back], 5) if len(closes) - back >= 5 else None
            b = sma(closes[:len(closes) - back], 10) if len(closes) - back >= 10 else None
            a1 = sma(closes[:len(closes) - back - 1], 5) if len(closes) - back - 1 >= 5 else None
            b1 = sma(closes[:len(closes) - back - 1], 10) if len(closes) - back - 1 >= 10 else None
            if None in (a, b, a1, b1):
                break
            if a1 <= b1 and a > b:
                ma_cross_days = back
                break

    amount = spot.get("amount") if spot else None
    if amount is None:
        amount = round(vols[-1] * c, 0)  # 新浪日线无成交额，用量*收盘价近似
    turnover = spot.get("turnover_ratio") if spot else None
    nmc_cap = spot.get("nmc_cap") if spot else None

    f = {
        "symbol": symbol,
        "name": (spot or {}).get("name", ""),
        "date": bars[-1].get("day", ""),
        "close": round(c, 3), "prev_close": round(pc, 3),
        "open": round(opens[-1], 3), "high": round(highs[-1], 3), "low": round(lows[-1], 3),
        "open_change": round((opens[-1] - pc) / pc * 100, 3) if pc else None,
        "pct_chg": round((c - pc) / pc * 100, 3) if pc else None,
        "amount": amount, "volume": vols[-1],
        "turnover": turnover,
        "vol_vs_prev": round(vols[-1] / vols[-2], 3) if len(vols) >= 2 and vols[-2] else None,
        "is_yin": bool(c < opens[-1]),
        "ma_by_period": ma_by_period,
        "ma_cross_days": ma_cross_days,
        "board": board_of(symbol),
        "float_cap_yi": round(nmc_cap / 1e8, 3) if nmc_cap else None,  # 快照里已换算成元
        "is_st": 1 if (spot or {}).get("is_st") else 0,
        "ma5": ma5, "ma10": ma10, "ma20": ma20, "ma60": ma60,
        "ma5_up": bool(ma5 and ma5_1 and ma5 > ma5_1),
        "ma10_up": bool(ma10 and ma10_1 and ma10 > ma10_1),
        "ma20_up": bool(ma20 and ma20_1 and ma20 > ma20_1),
        "ma60_up": bool(ma60 and ma60_1 and ma60 > ma60_1),
        "ma_all_up": bool(ma5_up and ma10_up and ma20_up and ma60_up),
        "ma_bullish": bool(ma5 and ma10 and ma20 and ma5 > ma10 > ma20),
        "above_ma5": bool(ma5 and c >= ma5 * 0.99),
        "above_ma10": bool(ma10 and c >= ma10 * 0.97),
        "above_ma20": bool(ma20 and c >= ma20 * 0.97),
        "above_ma60": bool(ma60 and c >= ma60 * 0.97),
        "mom5": _mom(closes, 5), "mom10": _mom(closes, 10),
        "mom20": _mom(closes, 20), "mom60": mom60,
        "vol_ratio": vol_ratio, "vol_ratio_20": vol_ratio_20,
        "rsi14": rsi14, "rsi6": rsi6,
        "macd_dif": round(dif[-1], 4), "macd_dea": round(dea[-1], 4),
        "macd_hist": round(hist[-1], 4),
        "macd_cross": bool(len(dif) >= 2 and (dif[-2] - dea[-2]) < 0 <= (dif[-1] - dea[-1])),
        "macd_above_zero": bool(dif[-1] > 0),
        "ma_cross": bool(ma5 and ma10 and ma5_1 and ma10_1 and ma5_1 <= ma10_1 and ma5 > ma10),
        "boll_mid": bmid, "boll_up": bup, "boll_low": blow, "boll_width": bwidth,
        "boll_break": bool(bup and c > bup),
        "boll_pos": round((c - blow) / (bup - blow), 3) if (bup and blow and bup != blow) else None,
        "kdj_k": k, "kdj_d": d, "kdj_j": j,
        "kdj_cross": bool(k is not None and d is not None and k_prev is not None
                          and d_prev is not None and k_prev <= d_prev and k > d),
        "atr_pct": atr_pct(highs, lows, closes),
        "vol20_pct": vol20_pct,
        "h20": round(h20, 3), "l20": round(l20, 3), "h60": round(h60, 3), "l60": round(l60, 3),
        "box_width": box_width,
        "drawdown_from_high60": drawdown_from_high60,
        "up_shadow": up_shadow,
        "gap_up": gap_up, "gap_unfilled": bool(gap_up and gap_up > 0 and not gap_filled),
        "price_new_low": bool(price_new_low), "vol_new_low": bool(vol_new_low),
        "divergence": divergence,
        "limit_up_10": limit_up_10, "limit_up_20": limit_up_20, "limit_up_60": limit_up_60,
        "days_since_limit": ago60,
        "shrink_after_limit": shrink_after_limit,
        "one_yang_three_yin": one_yang_three_yin,
        "limit_rate": limit_rate,
        "bars": len(bars),
    }
    return f
