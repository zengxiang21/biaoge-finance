"""AI 引擎：本机 Ollama（原生 /api/chat）+ OpenAI 兼容 /v1/chat/completions

16G 内存机器：调用结束用 keep_alive 让模型尽快卸载，避免和常驻服务抢内存。
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import requests

from .. import config, db
from ..providers import registry
from ..providers.base import ProviderError
from . import market

DISCLAIMER = "本内容由 AI 依据公开行情生成，仅供研究参考，不构成投资建议，不预测涨跌承诺。"


def get_config() -> dict:
    cfg = db.get_setting("ai_engine", {}) or {}
    out = dict(cfg)
    out["apiKeyFingerprint"] = _fingerprint(cfg.get("api_key", ""))
    out.pop("api_key", None)
    out.setdefault("base_url", config.OLLAMA_BASE_URL)
    out.setdefault("model", config.OLLAMA_DEFAULT_MODEL)
    return out


def save_config(patch: dict) -> dict:
    cfg = db.get_setting("ai_engine", {}) or {}
    for k, v in (patch or {}).items():
        if k in ("api_key", "apiKeyFingerprint"):
            continue
        if k in cfg:
            cfg[k] = v
    if (patch or {}).get("apiKeyPlain"):
        cfg["api_key"] = patch["apiKeyPlain"]
    db.set_setting("ai_engine", cfg)
    db.audit(None, "ai_engine:update", cfg.get("model", ""))
    return get_config()


def _fingerprint(key: str) -> str:
    if not key:
        return ""
    return f"sk-***{key[-4:]}"


def _headers(cfg: dict) -> dict:
    h = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        h["Authorization"] = f"Bearer {cfg['api_key']}"
    return h


def list_models() -> dict:
    cfg = get_config()
    base = cfg["base_url"].rstrip("/")
    try:
        if cfg.get("provider") == "ollama":
            r = requests.get(f"{base}/api/tags", timeout=8)
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
        else:
            r = requests.get(f"{base}/models", headers=_headers(cfg), timeout=8)
            r.raise_for_status()
            models = [m["id"] for m in r.json().get("data", [])]
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "models": [], "error": f"{type(exc).__name__}: {exc}",
                "base_url": base}
    return {"ok": True, "models": models, "base_url": base,
            "current": cfg.get("model"),
            "sizes_gb": {}}


def chat(messages: list[dict], *, purpose: str = "generic", user_id: int | None = None,
         temperature: float | None = None) -> dict:
    cfg = get_config()
    if not cfg.get("enabled", True):
        raise RuntimeError("AI 引擎已在设置页关闭")
    base = cfg["base_url"].rstrip("/")
    timeout = float(cfg.get("timeout_s", 180))
    temp = cfg.get("temperature", 0.3) if temperature is None else temperature
    payload = {
        "model": cfg["model"], "messages": messages, "stream": False,
        "options": {"temperature": temp, "num_predict": int(cfg.get("max_tokens", 1200)),
                    "keep_alive": cfg.get("keep_alive", config.OLLAMA_KEEP_ALIVE)},
    }
    started = time.perf_counter()
    try:
        if cfg.get("provider") == "ollama":
            r = requests.post(f"{base}/api/chat", json=payload, timeout=timeout)
            r.raise_for_status()
            data = r.json()
            content = data.get("message", {}).get("content", "")
            usage = {"prompt_tokens": data.get("prompt_eval_count", 0),
                     "completion_tokens": data.get("eval_count", 0)}
        else:
            payload.pop("options")
            payload.update({"temperature": temp,
                            "max_tokens": int(cfg.get("max_tokens", 1200)),
                            "keep_alive": cfg.get("keep_alive", config.OLLAMA_KEEP_ALIVE)})
            r = requests.post(f"{base}/v1/chat/completions", json=payload,
                              headers=_headers(cfg), timeout=timeout)
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
    except Exception as exc:  # noqa: BLE001
        _record(user_id, purpose, cfg, None, started, "error", str(exc))
        raise RuntimeError(f"AI 调用失败：{type(exc).__name__}: {exc}") from exc
    latency = (time.perf_counter() - started) * 1000
    _record(user_id, purpose, cfg, usage, started, "ok", None)
    return {"content": content, "model": cfg["model"], "engine": cfg.get("provider"),
            "latencyMs": round(latency, 1), "usage": usage, "disclaimer": DISCLAIMER}


def _record(user_id, purpose, cfg, usage, started, status, note) -> None:
    usage = usage or {}
    db.execute(
        "INSERT INTO ai_calls(user_id,purpose,model,engine,prompt_tokens,completion_tokens,"
        "latency_ms,status,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (user_id, purpose, cfg.get("model"), cfg.get("provider"),
         int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0),
         round((time.perf_counter() - started) * 1000, 1), status, (note or "")[:400], db.now()))


def _market_context(symbol: str) -> dict:
    ctx: dict[str, Any] = {"symbol": symbol}
    try:
        rows = registry.realtime([symbol])
        ctx["quote"] = rows[0] if rows else None
    except ProviderError as exc:
        ctx["quote"] = None
        ctx["quote_error"] = exc.message
    try:
        bars = registry.kline_daily(symbol, 60)
        closes = [b["close"] for b in bars]
        ctx["kline_summary"] = {
            "bars": len(bars), "first_day": bars[0]["day"] if bars else None,
            "last_day": bars[-1]["day"] if bars else None,
            "last_close": closes[-1] if closes else None,
            "ma5": round(sum(closes[-5:]) / 5, 2) if len(closes) >= 5 else None,
            "ma20": round(sum(closes[-20:]) / 20, 2) if len(closes) >= 20 else None,
            "ma60": round(sum(closes[-60:]) / 60, 2) if len(closes) >= 60 else None,
            "high_60": max(b["high"] for b in bars) if bars else None,
            "low_60": min(b["low"] for b in bars) if bars else None,
            "amount_avg_5": round(sum(b.get("amount", 0) for b in bars[-5:]) / max(len(bars[-5:]), 1) / 1e8, 2) if bars else None,
            "recent": [{"d": b["day"], "c": b["close"], "v": round(b["volume"] / 1e4)}
                       for b in bars[-10:]],
        }
    except ProviderError as exc:
        ctx["kline_error"] = exc.message
    daily = market.latest_daily()
    if daily:
        ctx["market_env"] = {
            "trade_date": daily["trade_date"], "emotion_score": daily["score"],
            "up": daily["up"], "down": daily["down"], "limit_up": daily["limit_up"],
            "blown": daily["blown"], "amount_1e8": daily["amount"],
        }
    boards = market.board_heat("industry", 5)
    ctx["hot_boards"] = [{"name": b["name"], "change_percent": b["change_percent"]}
                         for b in boards["top"][:5]]
    return ctx


SYSTEM_PROMPT = (
    "你是一名严谨的 A 股投研助理。只依据用户提供的数据推理，数据不足时明确说明缺口，"
    "不编造财报、股东、政策等未给出的事实。所有结论必须给出失效条件。"
    f"结尾必须原样附上风险提示：{DISCLAIMER}"
)


def analyze_stock(symbol: str, user_id: int | None = None) -> dict:
    ctx = _market_context(symbol)
    user_prompt = (
        "请对下面这只 A 股做一次深度诊断，用中文 Markdown 输出，包含：\n"
        "1. 一句话结论（看多/看空/观望 + 置信度低中高）\n"
        "2. 技术面与量价（均线排列、量能变化、位置高低）\n"
        "3. 资金与题材（对照热点板块，说明是否在当前主线上）\n"
        "4. 关键点位：压力位、支撑位、止损位（给具体数字）\n"
        "5. 失效风险：什么条件下上述判断作废\n"
        "6. 明日操作指南：正向因素 / 失效风险 / 止损位 / 追击条件\n"
        "不要给目标价收益率承诺，不要使用「必涨」等绝对化表述。\n\n数据：\n"
        + json.dumps(ctx, ensure_ascii=False, indent=1)[:6000]
    )
    res = chat([{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}],
               purpose="stock_analyze", user_id=user_id)
    return {"symbol": symbol, "context": ctx, **res,
            "direction": _guess_direction(res["content"])}


def predict_price_target(symbol: str, user_id: int | None = None) -> dict:
    ctx = _market_context(symbol)
    user_prompt = (
        "基于数据推演未来 5-20 个交易日目标价路径。严格输出 JSON（不要多余文字），字段：\n"
        '{"current":数字,"scenarios":[{"name":"乐观/中性/悲观","target_price":数字,'
        '"probability":0到100,"days":预计交易日数,"conditions":"达成条件","invalidation":"失效条件"}],'
        '"summary":"两句话"}\n'
        "概率三档相加应为 100。点位必须落在数据给出的高低点合理区间内。\n\n数据：\n"
        + json.dumps(ctx, ensure_ascii=False, indent=1)[:6000]
    )
    res = chat([{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}],
               purpose="predict_price_target", user_id=user_id, temperature=0.1)
    parsed = _extract_json(res["content"])
    return {"symbol": symbol, "raw": res["content"], "prediction": parsed,
            "context": ctx, "model": res["model"], "latencyMs": res["latencyMs"],
            "usage": res["usage"], "disclaimer": DISCLAIMER,
            "parse_ok": bool(parsed)}


CODE_COLUMNS = (
    "close 收盘 open 开盘 high 最高 low 最低 prev_close 昨收 pct_chg 涨幅% "
    "amount 成交额元 volume 成交量 turnover 换手% vol_vs_prev 量比昨日 "
    "ma5 ma10 ma20 ma60（及 ma5_up/ma10_up/ma20_up/ma60_up 是否向上、"
    "above_ma5/above_ma10/above_ma20/above_ma60 股价是否在均线上方） "
    "ma_bullish 均线多头排列 ma_all_up 均线全向上 ma_cross 金叉 bool ma_cross_days 金叉距今天数 "
    "mom5 mom10 mom20 mom60 动量% vol_ratio 量比 vol_ratio_20 rsi14 rsi6 "
    "macd_dif macd_dea macd_hist macd_cross macd_above_zero "
    "boll_mid boll_up boll_low boll_width boll_break 突破上轨 boll_pos 0~1 "
    "kdj_k kdj_d kdj_j kdj_cross atr_pct 真实波幅% vol20_pct 波动率% "
    "h20 l20 h60 l60 区间高低 box_width 箱体宽度% drawdown_from_high60 距60日高回撤% "
    "up_shadow 上影% gap_up 跳空% gap_unfilled 缺口未回补 "
    "price_new_low vol_new_low divergence 量价底背离 "
    "limit_up_10 limit_up_20 limit_up_60 涨停次数 days_since_limit shrink_after_limit 涨停后缩量比 "
    "one_yang_three_yin is_st is_yin open_change 高开放量% "
    "float_cap_yi 流通市值亿 board 板块(sh_main/sz_main/chinext/star/bse) "
    "symbol name limit_rate 涨停幅度小数"
)

STRATEGY_SYSTEM = (
    "你是量化策略工程师，为 A 股选股引擎写 Python 策略。\n"
    "【数据形态】df 是截面数据：一行 = 一只股票的今日快照，所有均线、动量、区间、"
    "涨停统计等指标已经预先算好并放在列里。没有历史 K 线，不能按时间轴做窗口运算。\n"
    "【运行环境】没有 pandas/numpy/polars。df[\"列名\"] 返回序列对象，"
    "它只支持：> < >= <= & | ~ + - * / 以及 .clip(lo,hi) .fillna(v) .mean_last(n)；"
    "常量写在左边也可以（38 - df[\"rsi14\"]），一元负号 -df[\"x\"] 同样可用。\n"
    "【绝对禁止】.rolling .shift .diff .ewm .pct_change .resample .groupby .apply "
    ".sort_values .iloc .loc .values .to_list 这些 pandas 方法一律不存在，写了就报错；"
    "也禁止 import、读写文件、网络、访问双下划线属性、使用下面未列出的列名。\n"
    "【需要窗口就换列】想看 5/10/20/60 日趋势→ma5 ma10 ma20 ma60 与 ma*_up、above_ma*；"
    "想看 N 日涨跌幅→mom5 mom10 mom20 mom60；想看区间高低→h20 l20 h60 l60 box_width "
    "drawdown_from_high60；想看近期涨停→limit_up_10 limit_up_20 limit_up_60 "
    "days_since_limit shrink_after_limit；想看波动幅度→atr_pct vol20_pct boll_width。\n"
    f"可用列名：{CODE_COLUMNS}。"
    "只能使用 abs min max len round float int list sum bool "
    "range enumerate zip sorted all any str dict tuple 这些内置函数。"
    "basic_filter 返回布尔序列、scoring 返回 0-100 数值序列，都用逐元素表达式写，"
    "不要用 for/if 语句块。"
)

STRATEGY_TEMPLATE = """META = {
    "name": "my_strategy",
    "display_name": "策略中文名",
    "description": "一句话说清逻辑",
    "direction": "long",
}

def basic_filter(df):
    return (df["ma_bullish"] & (df["vol_ratio"] > 1.5) & (df["close"] > df["ma20"]))

def scoring(df):
    return (df["vol_ratio"].clip(0, 5) * 10
            + df["mom20"].clip(-10, 30) * 1.2
            + (df["above_ma20"] * 20))
"""


def generate_strategy(rules: str, *, user: dict | None = None) -> dict:
    """自然语言 → 策略代码（文档 3.5.3 / 9.5.5）；AI 不可用时退回最接近的内置策略"""
    from . import strategy_defs as sdefs
    from . import strategy_engine as eng

    rules = (rules or "").strip()
    if len(rules) < 4:
        raise RuntimeError("请先用一句话描述选股逻辑")
    notes: list[str] = []
    prompt = (
        "根据下面的选股逻辑写出策略代码。\n\n"
        f"选股逻辑：{rules[:2000]}\n\n"
        "硬性要求：\n"
        "1. 必须包含 META（含 name/display_name/description/direction）\n"
        "2. 必须包含 def basic_filter(df)，返回与行数等长的布尔序列\n"
        "3. 必须包含 def scoring(df)，返回 0-100 的分数序列\n"
        "4. 只能用上面列出的列名，不许出现 import\n"
        "5. 只输出 Python 代码，不要解释、不要 Markdown 之外的文字\n\n"
        f"模板：\n{STRATEGY_TEMPLATE}"
    )
    code, meta, model, latency = None, None, None, None
    try:
        res = chat([{"role": "system", "content": STRATEGY_SYSTEM},
                    {"role": "user", "content": prompt}],
                   purpose="strategy_generate", user_id=(user or {}).get("id"), temperature=0.1)
        model, latency = res["model"], res["latencyMs"]
        code = _extract_code(res["content"])
        check = eng.validate_code(code)
        if not check["ok"]:
            fix = chat([{"role": "system", "content": STRATEGY_SYSTEM},
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": code[:4000]},
                        {"role": "user", "content": "这段代码有问题：" + "；".join(check["problems"])
                         + "。请修正后只重新输出完整代码。"}],
                       purpose="strategy_generate_fix", user_id=(user or {}).get("id"),
                       temperature=0.0)
            model, latency = fix["model"], (latency or 0) + fix["latencyMs"]
            code = _extract_code(fix["content"])
            check = eng.validate_code(code)
            notes.append("首次生成未通过校验，已自动修正一次")
        if not check["ok"]:
            raise RuntimeError("；".join(check["problems"]))
        meta = check["meta"]
        run = _dry_run_strategy_code(code)
        if not run["ok"]:
            # 静态检查放过、真跑才炸的写法（例如 pandas 的 .rolling）在这里修一次
            fix2 = chat([{"role": "system", "content": STRATEGY_SYSTEM},
                         {"role": "user", "content": prompt},
                         {"role": "assistant", "content": code[:4000]},
                         {"role": "user", "content": "这段代码在真实数据上执行失败：" + str(run["error"])
                          + "。请改用上面列出的已预计算列名，只重新输出完整代码。"}],
                        purpose="strategy_generate_fix", user_id=(user or {}).get("id"),
                        temperature=0.0)
            model, latency = fix2["model"], (latency or 0) + fix2["latencyMs"]
            code = _extract_code(fix2["content"])
            check = eng.validate_code(code)
            if not check["ok"]:
                raise RuntimeError("；".join(check["problems"]))
            meta = check["meta"]
            run = _dry_run_strategy_code(code)
            notes.append("首次生成试运行失败，已自动改写一次")
        if not run["ok"]:
            raise RuntimeError(f"代码试运行失败：{run['error']}")
        notes.append(f"试运行覆盖 {run['rows']} 只样本，命中 {run['hits']} 只")
    except Exception as exc:  # noqa: BLE001
        fb = _fallback_strategy(rules, sdefs)
        return {**fb, "source": "fallback", "model": model, "note": f"AI 生成不可用（{type(exc).__name__}: {exc}），已按关键词匹配内置策略",
                "fallbackReason": str(exc)[:300]}
    return {
        "source": "ai",
        "name": (meta or {}).get("display_name") or (meta or {}).get("name") or rules[:20],
        "description": (meta or {}).get("description") or rules[:200],
        "direction": (meta or {}).get("direction") or "long",
        "code": code, "rules": rules, "min_score": 45,
        "strategyType": "custom_code", "engine": "ai_code",
        "validation": {"ok": True, "meta": meta},
        "dryRun": run, "model": model, "latencyMs": latency,
        "note": "；".join(notes) or None, "disclaimer": DISCLAIMER,
    }


def _dry_run_strategy_code(code: str) -> dict:
    """拿缓存里的少量真实 K 线跑一遍，确认代码真能执行，而不是只过静态检查"""
    from . import kline
    from . import strategy_engine as eng
    date = market.live_quote_date()
    ranked = [r["symbol"] for r in db.query(
        "SELECT symbol FROM snapshot_stocks WHERE trade_date=? ORDER BY amount DESC", (date,))]
    # 等距抽样，龙头和小盘都要覆盖，否则只看成交额前 40 会让命中数失真
    syms = ranked[::max(1, len(ranked) // 200)][:200]
    if not syms:
        return {"ok": False, "error": "没有全市场快照，无法试运行", "rows": 0, "hits": 0}
    spot = {r["symbol"]: dict(r) for r in db.query(
        "SELECT * FROM snapshot_stocks WHERE trade_date=? AND symbol IN (%s)"
        % ",".join("?" * len(syms)), (date, *syms))}
    feats = kline.features(syms, spot)
    rows = list(feats.values())
    if not rows:
        return {"ok": False, "error": "样本股没有日线缓存，无法试运行", "rows": 0, "hits": 0}
    try:
        hits, warns = eng.run_custom_code(code, rows)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300], "rows": len(rows), "hits": 0}
    return {"ok": True, "error": None, "rows": len(rows), "hits": len(hits),
            "warnings": warns[:3]}


def _fallback_strategy(rules: str, sdefs) -> dict:
    """AI 不可用时的降级：按关键词命中最接近的内置策略，不编造代码"""
    text = rules.lower()
    scored = []
    for s in sdefs.STRATEGIES:
        keys = [s["name"], s.get("desc") or "", s.get("scene") or "", s["code"]]
        hit = sum(1 for k in keys if k and any(w and w in text for w in _kw(k)))
        kw_overlap = sum(1 for w in _kw(s["name"]) if w in text) * 3 + hit
        scored.append((kw_overlap, s))
    scored.sort(key=lambda x: (-x[0], x[1]["code"]))
    best, spec = scored[0]
    return {
        "name": spec["name"], "description": spec.get("desc") or rules[:200],
        "direction": "long", "code": "", "rules": rules, "min_score": 55,
        "strategyType": spec["code"], "engine": "builtin",
        "validation": {"ok": True, "meta": None},
        "matchScore": best,
        "note": f"按关键词匹配到内置策略「{spec['name']}」，可直接运行后另存调参",
    }


def _kw(phrase: str) -> list[str]:
    parts = re.split(r"[，,、\s（）()]+", phrase or "")
    out = []
    for p in parts:
        p = p.strip().lower()
        if len(p) >= 2:
            out.append(p)
    if len(phrase) >= 4:          # 中文短语再切两字词
        zh = re.sub(r"[^一-鿿]", "", phrase)
        out += [zh[i:i + 2] for i in range(len(zh) - 1)]
    return [x for x in out if x]


def _extract_code(text: str) -> str:
    m = re.search(r"```(?:python)?\s*(.*?)```", text or "", re.S)
    body = m.group(1) if m else (text or "")
    lines = []
    for ln in body.splitlines():
        if re.match(r"^\s*(import |from \S+ import )", ln):
            continue
        lines.append(ln.rstrip())
    return "\n".join(lines).strip()


def _extract_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    for candidate in (m.group(0), _strip_trailing(m.group(0))):
        try:
            return json.loads(candidate)
        except Exception:  # noqa: BLE001
            continue
    return None


def _strip_trailing(s: str) -> str:
    return re.sub(r",\s*([}\]])", r"\1", s)


def _guess_direction(text: str) -> str:
    head = text[:400]
    if re.search(r"看多|偏多|逢低|可参与", head):
        return "bullish"
    if re.search(r"看空|偏空|回避|减仓|离场", head):
        return "bearish"
    return "neutral"


def usage_stat(days: int = 7) -> dict:
    row = db.query_one(
        "SELECT COUNT(*) n, SUM(prompt_tokens) p, SUM(completion_tokens) c, "
        "AVG(latency_ms) lat, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok "
        "FROM ai_calls WHERE created_at >= datetime('now', ?)", (f"-{days} day",))
    return {"calls": row["n"] or 0, "promptTokens": row["p"] or 0,
            "completionTokens": row["c"] or 0, "avgLatencyMs": round(row["lat"] or 0, 1),
            "ok": row["ok"] or 0, "window_days": days}
