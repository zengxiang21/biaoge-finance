"""全市场日线缓存 + 逐票特征

原平台每次扫描都要重算全市场，我们改为：每晚把 5000+ 只股票的日线落到 kline_cache，
策略扫描/胜率回测只读本地库。首次建库约 1-2 分钟，之后增量刷新只需要当天数据。
"""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from .. import db
from ..providers import registry
from . import indicators as ind
from . import market

_lock = threading.RLock()
_state: dict = {"running": False, "done": 0, "total": 0, "failed": 0,
                "started_at": None, "finished_at": None, "error": None}

BARS_WANT = 120          # 特征最多用到 60 日窗口，120 根够用


def status() -> dict:
    with _lock:
        return dict(_state)


def meta() -> dict:
    row = db.query_one("SELECT refreshed_at, bars, last_date FROM kline_meta LIMIT 1")
    total = db.query_one("SELECT COUNT(*) c FROM kline_cache")
    uniq = db.query_one("SELECT COUNT(DISTINCT symbol) c FROM kline_cache")
    return {
        "refreshed_at": row["refreshed_at"] if row else None,
        "symbols": uniq["c"] if uniq else 0,
        "rows": total["c"] if total else 0,
        "state": status(),
    }


def _cache_one(symbol: str, datalen: int = BARS_WANT) -> int:
    bars = registry.kline_daily(symbol, datalen)
    if not bars:
        raise RuntimeError("空 K 线")
    rows = []
    for b in bars:
        vol = float(b.get("volume") or 0)
        close = float(b["close"])
        rows.append((symbol, b["day"], float(b["open"]), float(b["high"]),
                     float(b["low"]), close, vol, round(vol * close, 2)))
    db.executemany(
        "INSERT OR REPLACE INTO kline_cache(symbol,trade_date,open,high,low,close,volume,amount)"
        " VALUES(?,?,?,?,?,?,?,?)", rows)
    db.execute("INSERT OR REPLACE INTO kline_meta(symbol,refreshed_at,bars,last_date) VALUES(?,?,?,?)",
               (symbol, db.now(), len(rows), rows[-1][1]))
    return len(rows)


def refresh(symbols: list[str] | None = None, *, workers: int = 8,
            limit: int | None = None, force: bool = False) -> dict:
    """批量刷新日线缓存。symbols 缺省为全市场快照"""
    with _lock:
        if _state["running"]:
            return dict(_state)
        _state.update(running=True, done=0, failed=0, error=None,
                      started_at=db.now(), finished_at=None)
    try:
        if symbols is None:
            date = market.live_quote_date()
            rows = db.query("SELECT symbol FROM snapshot_stocks WHERE trade_date=? ORDER BY symbol",
                            (date,))
            symbols = [r["symbol"] for r in rows]
            if not symbols:
                date = market.build_snapshot()
                rows = db.query("SELECT symbol FROM snapshot_stocks WHERE trade_date=? ORDER BY symbol",
                                (date,))
                symbols = [r["symbol"] for r in rows]
        if not force:
            last = {r["symbol"]: (r["last_date"] or "").replace("-", "") for r in
                    db.query("SELECT symbol, last_date FROM kline_meta")}
            today = (market.live_quote_date() or "").replace("-", "")
            symbols = [s for s in symbols if last.get(s) != today]
        if limit:
            symbols = symbols[:limit]
        with _lock:
            _state["total"] = len(symbols)
        if not symbols:
            _state.update(running=False, finished_at=db.now())
            return dict(_state)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_cache_one, s): s for s in symbols}
            for fut in as_completed(futs):
                try:
                    fut.result()
                    with _lock:
                        _state["done"] += 1
                except Exception:
                    with _lock:
                        _state["failed"] += 1
                        _state["done"] += 1
    except Exception as exc:
        with _lock:
            _state["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = db.now()
    db.execute("INSERT INTO job_runs(job,status,trigger,started_at,finished_at,detail) VALUES(?,?,?,?,?,?)",
               ("kline_refresh", "ok" if not _state["error"] else "error", "manual",
                _state["started_at"], _state["finished_at"],
                json.dumps({"done": _state["done"], "failed": _state["failed"]}, ensure_ascii=False)))
    return dict(_state)


def refresh_in_background(**kw) -> None:
    threading.Thread(target=refresh, kwargs=kw, daemon=True).start()


def bars(symbol: str, days: int = 120) -> list[dict]:
    rows = db.query(
        "SELECT trade_date AS day,open,high,low,close,volume,amount FROM kline_cache"
        " WHERE symbol=? ORDER BY trade_date DESC LIMIT ?", (symbol, days))
    return [dict(r) for r in reversed(rows)]


def cached_symbols() -> set[str]:
    return {r["symbol"] for r in db.query("SELECT DISTINCT symbol FROM kline_cache")}


def bars_bulk(symbols: list[str]) -> dict[str, list[dict]]:
    """一次 SQL 取回全部日线，按标的切好。逐票查询在 Windows 上开销极大，不用"""
    if not symbols:
        return {}
    want = set(symbols)
    out: dict[str, list[dict]] = {}
    for row in db.rows_of("SELECT symbol,trade_date,open,high,low,close,volume,amount"
                          " FROM kline_cache ORDER BY symbol,trade_date"):
        if row[0] not in want:
            continue
        out.setdefault(row[0], []).append(
            {"day": row[1], "open": row[2], "high": row[3], "low": row[4],
             "close": row[5], "volume": row[6], "amount": row[7]})
    return {s: out.get(s, [])[-BARS_WANT:] for s in symbols}


# 全市场特征表按交易日缓存：35 个策略共享一次计算
_ft_lock = threading.RLock()
_ft_cache: dict[str, dict[str, dict]] = {}
_FT_KEEP = 2


def full_features(spot: dict[str, dict], date: str) -> tuple[dict[str, dict], list[str]]:
    """返回 {symbol: 特征行}，同一交易日只算一次"""
    key = f"{date}|{len(spot)}"
    with _ft_lock:
        hit = _ft_cache.get(key)
        if hit:
            return hit, []
    symbols = list(spot)
    have = cached_symbols()
    missing = [s for s in symbols if s not in have]
    warns: list[str] = []
    if missing:
        st = refresh(missing, workers=8)
        warns.append(f"补缓存 {st['done']}/{len(missing)} 只，失败 {st['failed']} 只")
        have = cached_symbols()
    bar_map = bars_bulk([s for s in symbols if s in have])
    out: dict[str, dict] = {}
    for s, bars_ in bar_map.items():
        try:
            row = ind.build_features(bars_, spot=spot.get(s), symbol=s,
                                     limit_rate=(spot.get(s) or {}).get("limit_rate"))
        except Exception:  # noqa: BLE001
            continue
        if row:
            out[s] = row
    uncached = len(symbols) - len(have & set(symbols))
    if uncached:
        warns.append(f"{uncached} 只标的没有日线缓存，未参与本次计算")
    with _ft_lock:
        _ft_cache[key] = out
        for old in list(_ft_cache)[:-_FT_KEEP]:
            _ft_cache.pop(old, None)
    return out, warns


def features(symbols: list[str], spot_map: dict[str, dict]) -> dict[str, dict]:
    """批量取特征：优先走全市场缓存，只扫请求的这批"""
    if not symbols:
        return {}
    date = market.live_quote_date() or ""
    if len(symbols) > 800 and date:
        table, _ = full_features(spot_map or {}, date)
        return {s: table[s] for s in symbols if s in table}
    return {s: v for s, v in _features_one_by_one(symbols, spot_map or {}).items()}


def _features_one_by_one(symbols: list[str], spot_map: dict[str, dict]) -> dict[str, dict]:
    have = cached_symbols()
    missing = [s for s in symbols if s not in have]
    if missing:
        try:
            refresh(missing, workers=8)
        except Exception:  # noqa: BLE001
            pass
    bar_map = bars_bulk(symbols)
    out: dict[str, dict] = {}
    for s in symbols:
        try:
            f = ind.build_features(bar_map.get(s) or [], spot=spot_map.get(s), symbol=s,
                                   limit_rate=(spot_map.get(s) or {}).get("limit_rate"))
        except Exception:  # noqa: BLE001
            continue
        if f:
            out[s] = f
    return out


def invalidate() -> None:
    """重建快照/缓存后调用，让特征表重算"""
    with _ft_lock:
        _ft_cache.clear()
    with _tb_lock:
        _tb_cache.clear()


# 全市场均线 breadth / 成交额基准：同样按交易日缓存
_tb_lock = threading.RLock()
_tb_cache: dict[str, dict] = {}
_TB_KEEP = 4


def trend_breadth(date: str) -> dict:
    """站上 5/20/60 日线比例 + 60 日新高新低。

    缓存里 5576 只票的日线是齐的，直接全量算，比抽样 300 只准。
    返回 {ma5, ma20, ma60, new_high, new_low, total, high_base, low_base}，比例为 0~1。
    """
    key = (date or "").replace("-", "")
    if len(key) != 8:
        return {}
    with _tb_lock:
        hit = _tb_cache.get(key)
    if hit:
        return hit
    dashed = f"{key[:4]}-{key[4:6]}-{key[6:]}"
    start = (datetime.strptime(dashed, "%Y-%m-%d") - timedelta(days=200)).strftime("%Y-%m-%d")
    above = {5: 0, 20: 0, 60: 0}
    base = {5: 0, 20: 0, 60: 0}
    total = new_high = new_low = hl_base = 0
    cur: list[str] = [""]
    closes: list[float] = []
    last_day: list[str] = [""]

    def flush() -> None:
        nonlocal total, new_high, new_low, hl_base
        if not cur[0] or len(closes) < 6:
            return
        c = closes[-1]
        for n in (5, 20, 60):
            if len(closes) >= n:
                base[n] += 1
                if c >= sum(closes[-n:]) / n:
                    above[n] += 1
        if last_day[0] == dashed:
            total += 1
            w = closes[-60:] if len(closes) >= 60 else closes
            hl_base += 1
            if c >= max(w):
                new_high += 1
            if c <= min(w):
                new_low += 1

    for sym, day, close in db.rows_of(
            "SELECT symbol,trade_date,close FROM kline_cache WHERE trade_date>? AND trade_date<=?"
            " ORDER BY symbol,trade_date", (start, dashed)):
        if sym != cur[0]:
            flush()
            cur[0], closes, last_day[0] = sym, [], ""
        if close is not None:
            closes.append(float(close))
            last_day[0] = day
    flush()
    if not total:
        return {}
    out = {"ma5": round(above[5] / base[5], 4) if base[5] else None,
           "ma20": round(above[20] / base[20], 4) if base[20] else None,
           "ma60": round(above[60] / base[60], 4) if base[60] else None,
           "new_high": new_high, "new_low": new_low, "total": total,
           "high_base": hl_base, "low_base": hl_base}
    with _tb_lock:
        _tb_cache[key] = out
        while len(_tb_cache) > _TB_KEEP:
            _tb_cache.pop(next(iter(_tb_cache)))
    return out


def backfill_amount_baseline(upto: str) -> int:
    """用日线缓存补历史全市场成交额（亿元），成交额环比从此有基准"""
    dashed = (upto or "").replace("-", "")
    if len(dashed) != 8:
        return 0
    dashed = f"{dashed[:4]}-{dashed[4:6]}-{dashed[6:]}"
    have = {r["trade_date"] for r in db.query("SELECT trade_date FROM amount_baseline")}
    have = {d.replace("-", "") for d in have}
    rows = db.rows_of("SELECT trade_date,SUM(amount) FROM kline_cache WHERE trade_date<=?"
                      " GROUP BY trade_date ORDER BY trade_date DESC LIMIT 40", (dashed,))
    added = 0
    for day, amt in rows:
        if not amt or day.replace("-", "") in have:
            continue
        db.execute("INSERT OR REPLACE INTO amount_baseline(trade_date,amount,source) VALUES(?,?,?)",
                   (day.replace("-", ""), round(float(amt) / 1e8, 2), "kline_cache"))
        added += 1
    return added
