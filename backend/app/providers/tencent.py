"""腾讯行情 Provider：批量实时快照（含涨/跌停价）、分时"""
from __future__ import annotations

import re

from .base import ProviderError, fetch, norm_symbol

P = "tencent"
REFERER = "https://gu.qq.com/"
QUOTE = "https://qt.gtimg.cn/q="
MINUTE = "https://web.ifzq.gtimg.cn/appstock/app/minute/query"


def batch_quotes(symbols: list[str], capability: str = "realtime") -> list[dict]:
    out: list[dict] = []
    if not symbols:
        return out
    for chunk in [symbols[i:i + 60] for i in range(0, len(symbols), 60)]:
        raw = fetch(QUOTE + ",".join(chunk), provider=P, capability=capability,
                    referer=REFERER, encoding="gbk", expect_json=False)
        for line in raw.split(";"):
            m = re.search(r'v_(\w+)="(.*)"', line)
            if not m:
                continue
            f = m.group(2).split("~")
            if len(f) < 49:
                continue
            try:
                price = float(f[3])
                prev = float(f[4]) or price
                out.append({
                    "symbol": m.group(1), "name": f[1], "code": f[2],
                    "price": price, "prev_close": prev, "open": float(f[5]),
                    "high": float(f[33]), "low": float(f[34]),
                    "change_price": float(f[31]), "change_percent": float(f[32]),
                    "volume": float(f[36]) * 100,          # 手 -> 股
                    "amount": float(f[37]) * 10000,        # 万元 -> 元
                    "turnover_ratio": float(f[38]),
                    "pe": float(f[39] or 0), "pb": float(f[46] or 0),
                    "float_cap": float(f[44] or 0) * 1e8,
                    "total_cap": float(f[45] or 0) * 1e8,
                    "limit_up": float(f[47] or 0), "limit_down": float(f[48] or 0),
                    "datetime": f[30],
                })
            except (ValueError, IndexError):
                continue
    return out


def quote_one(symbol: str) -> dict | None:
    rows = batch_quotes([norm_symbol(symbol)["symbol"]], capability="quote_one")
    return rows[0] if rows else None


def vix_quote() -> dict:
    """恐慌指数备源：CBOE 挂了才用。腾讯这条只有 36 个字段，套不进 batch_quotes 的 49 字段门槛"""
    raw = fetch(QUOTE + "us.VIX", provider=P, capability="fear_index",
                referer=REFERER, encoding="gbk", expect_json=False)
    m = re.search(r'v_[\w.]+="([^"]*)"', raw)
    f = (m.group(1).split("~") if m else [])
    if len(f) < 36:
        raise ProviderError(P, "fear_index", f"腾讯 VIX 行解析不出（{len(f)} 字段）")

    def n(i: int) -> float | None:
        try:
            return round(float(f[i]), 3)
        except (IndexError, ValueError):
            return None

    def pos(i: int) -> float | None:
        # 外盘这条里没填的字段全是 0.00，0 当成开/高/低会画出假价格
        v = n(i)
        return v if (v or 0) > 0 else None

    price, prev = n(3), n(4)
    stamp = f[30] if len(f) > 30 else ""
    return {
        "code": "VIX", "name": "恐慌指数 VIX", "source": "腾讯行情（备用，可能滞后）",
        "price": price, "prev_close": prev,
        "change_price": round(price - prev, 3) if (price is not None and prev) else None,
        "change_percent": round((price / prev - 1) * 100, 2) if (price and prev) else None,
        "open": pos(5), "high": pos(33), "low": pos(34),
        "date": stamp[:10] or None, "time": stamp[11:19] or None,
        "quoteZone": "美东时间", "tick": None,
    }


def minute_trend(symbol: str) -> list[dict]:
    n = norm_symbol(symbol)
    raw = fetch(MINUTE, provider=P, capability="minute_trend", referer=REFERER,
                params={"code": n["symbol"]})
    data = ((raw or {}).get("data") or {}).get(n["symbol"], {}).get("data", {}).get("data") or []
    out = []
    for line in data:
        f = str(line).split()
        if len(f) < 2:
            continue
        try:
            out.append({"time": f[0], "price": float(f[1]),
                        "volume": float(f[2]) if len(f) > 2 else 0.0,
                        "amount": float(f[3]) if len(f) > 3 else 0.0})
        except ValueError:
            continue
    return out
