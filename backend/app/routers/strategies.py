"""策略引擎 API：/strategies/*（拆解文档 3.5.16）"""
from __future__ import annotations

import json
import re
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from .. import db, security
from ..services import ai as ai_svc
from ..services import kline
from ..services import strategy_defs as sdefs
from ..services import strategy_engine as eng

router = APIRouter(tags=["strategy"])
MENU = security.require_perm("menu:strategy")
RUN = security.require_perm("strategy:run")
CREATE = security.require_perm("strategy:create")
UPDATE = security.require_perm("strategy:update")
MANAGE = security.require_perm("strategy:manage")
DELETE = security.require_perm("strategy:delete")


def _row(r) -> dict:
    d = dict(r)
    for key in ("params", "universe", "composite"):
        try:
            d[key] = json.loads(d.get(key) or "null")
        except Exception:
            d[key] = None
    spec = sdefs.BY_CODE.get(d.get("strategy_type") or "")
    d["typeLabel"] = "内置" if d.get("is_system") else (
        "叠加" if d.get("strategy_type") == "composite" else
        "AI" if d.get("is_ai") else "自定义")
    d["family"] = (spec or {}).get("family")
    d["familyLabel"] = "叠加组合" if d.get("strategy_type") == "composite" else (
        sdefs.FAMILY_LABEL.get((spec or {}).get("family"), "自定义"))
    d["winRateDoc"] = (spec or {}).get("win_rate_doc")
    d["stars"] = (spec or {}).get("stars")
    d["scene"] = (spec or {}).get("scene")
    d["hardParams"] = _hard_params((spec or {}).get("params"))
    d["dims"] = [(x, sdefs.SCORE_DIM_LABELS.get(x, x)) for x in (spec or {}).get("dims") or []]
    return d


@router.get("/strategies")
def list_strategies(kind: str = Query("all", pattern="^(all|system|custom|ai|composite)$"),
                    user: dict = Depends(MENU)) -> dict:
    rows = [dict(r) for r in db.query(
        "SELECT * FROM strategy WHERE status IS NOT NULL ORDER BY is_system DESC, id ASC")]
    if kind == "system":
        rows = [r for r in rows if r["is_system"]]
    elif kind == "custom":
        rows = [r for r in rows if not r["is_system"] and not r["is_ai"] and r["strategy_type"] != "composite"]
    elif kind == "ai":
        rows = [r for r in rows if r["is_ai"]]
    elif kind == "composite":
        rows = [r for r in rows if r["strategy_type"] == "composite"]
    last = eng.run_stats()["stats"]
    out = []
    for r in rows:
        d = _row(r)
        d["lastPickCount"] = r.get("last_pick_count") or last.get(str(r["id"]), 0)
        out.append(d)
    return {"rows": out, "total": len(out),
            "families": [{"key": k, "label": v} for k, v in sdefs.FAMILY_LABEL.items()],
            "commonFilters": sdefs.COMMON_FILTERS,
            "scoreDims": [{"key": k, "label": v} for k, v in sdefs.SCORE_DIM_LABELS.items()]}


@router.get("/strategies/run-stats")
def run_stats(user: dict = Depends(MENU)) -> dict:
    return eng.run_stats()


@router.get("/strategies/meta")
def meta(user: dict = Depends(MENU)) -> dict:
    return {"strategies": [
        {"code": s["code"], "name": s["name"], "desc": s["desc"], "family": s["family"],
         "familyLabel": sdefs.FAMILY_LABEL[s["family"]], "run_time_type": s["run_time_type"],
         "winRateDoc": s.get("win_rate_doc"), "stars": s.get("stars"), "scene": s.get("scene"),
         "hardParams": _hard_params(s["params"]),
         "dims": [{"key": x, "label": sdefs.SCORE_DIM_LABELS.get(x, x)} for x in s["dims"]]}
        for s in sdefs.STRATEGIES],
        "commonFilters": sdefs.COMMON_FILTERS,
        "recommendedComposites": sdefs.RECOMMENDED_COMPOSITES,
        "kline": kline.meta()}


def _hard_params(raw: dict | None) -> list[dict]:
    # bool 是 int 的子类，先判 bool，否则开关会被前端渲染成数字框
    return [{"key": k, "label": HARD_LABELS.get(k, k),
             "type": "boolean" if isinstance(v, bool) else "number", "default": v}
            for k, v in (raw or {}).items()]


HARD_LABELS = {
    "require_ma_bullish": "要求均线多头排列", "require_momentum_20d_positive": "要求 20 日动量为正",
    "ma_short_period": "短期均线", "ma_mid_period": "中期均线", "ma_long_period": "长期均线",
    "enable_volume_filter": "启用量比过滤", "min_volume_ratio": "最低量比",
    "macd_fast_period": "MACD 快线", "macd_slow_period": "MACD 慢线",
    "macd_signal_period": "MACD 信号线", "lookback_days": "回看天数", "min_limit_up": "最少涨停次数",
    "ma_support_period": "支撑均线周期", "tolerance": "均线容差(%)", "boll_period": "布林周期",
    "boll_k": "布林倍数", "breakout_lookback": "突破回看天数", "rsi_period": "RSI 周期",
    "rsi_oversold": "RSI 超卖线", "require_close_up": "要求收阳", "ma_fast_period": "快均线",
    "box_lookback": "箱体回看天数",
    "ma_slow_period": "慢均线", "min_drawdown": "最小跌幅(%)", "max_box_width": "箱体最大宽度(%)",
    "bottom_tolerance": "箱底容差(%)", "structure_lookback": "结构回看", "min_change": "最低涨幅(%)",
    "min_turnover": "最低换手(%)", "max_up_shadow": "最大上影(%)", "rsi_ice": "RSI 冰点",
    "rsi_low": "RSI 下限", "rsi_high": "RSI 上限", "min_momentum_20d": "20 日动量下限(%)",
    "min_momentum_60d": "60 日动量下限(%)", "max_volatility": "最大波动率(%)",
    "min_amount": "最低成交额(元)", "max_shrink_ratio": "最大缩量比", "board_rank_top": "板块排名前N",
    "limit_lookback": "涨停回看天数", "max_pullback_volume_ratio": "回调最大量比",
    "wave_lookback": "波形回看", "min_days": "最少连续天数", "min_net_amount": "最小净额(元)",
    "min_net_ratio": "最小净占比(%)", "min_hot_seats": "最少游资席位", "change_low": "涨幅下限(%)",
    "change_high": "涨幅上限(%)", "max_float_cap": "流通市值上限(亿)", "board_top_n": "板块排名前N",
    "min_board_change": "板块最低涨幅(%)", "min_open_change": "最低高开幅度(%)",
    "min_drawdown_from_high": "距高点回撤(%)", "days_before": "提前天数",
    "max_j": "J 线上限", "max_band_width": "最大带宽(%)", "require_all_ma_up": "要求均线全部向上",
    "recent_cross_days": "金叉发生在N日内", "gap_low": "缺口下限(%)", "gap_high": "缺口上限(%)",
    "require_unfilled": "要求缺口未回补",
}


@router.get("/strategies/{sid}")
def detail(sid: int, user: dict = Depends(MENU)) -> dict:
    r = db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    d = _row(r)
    d["mergedParams"] = eng.merged_params(dict(r))
    latest = db.query_one(
        "SELECT * FROM strategy_run WHERE strategy_id=? ORDER BY id DESC LIMIT 1", (sid,))
    d["latest"] = dict(latest) if latest else None
    if d["latest"]:
        try:
            d["latest"]["data_warnings"] = json.loads(d["latest"].get("data_warnings") or "[]")
        except Exception:
            d["latest"]["data_warnings"] = []
    return d


def _own_or_500(row, user) -> dict:
    if row["is_system"]:
        raise HTTPException(400, detail={"code": "PERMISSION_DENIED", "message": "内置策略不可修改，请先另存为自定义策略"})
    if user["role"] != "admin" and row["user_id"] != user["id"]:
        raise HTTPException(403, detail={"code": "PERMISSION_DENIED", "message": "只能操作自己的策略"})
    return dict(row)


@router.post("/strategies")
def create(payload: dict, user: dict = Depends(CREATE)) -> dict:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, detail={"code": "BAD_NAME", "message": "策略名称必填"})
    code = _slug(payload.get("code") or name, user["id"])
    stype = payload.get("strategy_type") or "custom"
    params = payload.get("params") or {}
    code_text = params.get("code") or ""
    is_ai = bool(params.get("ai"))
    engine = params.get("engine") or ("polars" if code_text else "builtin")
    problems: list[str] = []
    if code_text:
        v = eng.validate_code(code_text)
        problems = v["problems"]
        if not v["ok"]:
            raise HTTPException(400, detail={"code": "BAD_CODE", "message": "；".join(problems)})
        stype = "custom_code"
        engine = "code"
    if stype == "composite":
        parts = params.get("composite") or []
        if len(parts) < 2:
            raise HTTPException(400, detail={"code": "BAD_COMPOSITE", "message": "叠加策略至少需要 2 个子策略"})
        if any(float(p.get("weight") or 0) <= 0 for p in parts):
            raise HTTPException(400, detail={"code": "BAD_COMPOSITE", "message": "每个子策略权重必须大于 0"})
        total = sum(float(p["weight"]) for p in parts)
        parts = [{"strategy_code": (x.get("strategy_code") or x.get("strategy_type")
                                    or x.get("code")),
                  "name": (sdefs.BY_CODE.get(x.get("strategy_code") or x.get("strategy_type")
                                             or x.get("code") or "") or {}).get("name"),
                  "weight": round(float(x["weight"]) / total * 100, 2)} for x in parts]
        unknown = [x["strategy_code"] for x in parts if x["strategy_code"] not in sdefs.BY_CODE]
        if unknown:
            raise HTTPException(400, detail={"code": "BAD_COMPOSITE",
                                             "message": f"子策略不存在：{'、'.join(map(str, unknown))}"})
        params = {**params, "composite": parts}
    if db.query_one("SELECT id FROM strategy WHERE code=?", (code,)):
        raise HTTPException(400, detail={"code": "USERNAME_TAKEN", "message": "策略标识已存在"})
    spec = sdefs.BY_CODE.get(stype) or {}
    saved = {"max_output": int(params.get("max_output") or 100),
             "min_score": float(params.get("min_score") or 55),
             "hard": params.get("hard") or spec.get("params") or {},
             "filters": params.get("filters") or {c["key"]: c["default"] for c in sdefs.COMMON_FILTERS}}
    if is_ai:
        saved["ai"] = {"direction": params.get("direction"), "rules": params.get("rules"),
                       "auto_iterate": params.get("auto_iterate")}
    sid = db.execute(
        "INSERT INTO strategy(user_id,code,name,description,strategy_type,strategy_type_label,"
        "run_time_type,direction,params,universe,engine,code_text,is_ai,is_system,status,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"], code, name, payload.get("description") or spec.get("desc") or "",
         stype, spec.get("name") or name, spec.get("run_time_type") or "any",
         payload.get("direction") or "long",
         json.dumps(saved, ensure_ascii=False),
         json.dumps(payload.get("default_universe") or {"kind": "all_a_share"}, ensure_ascii=False),
         engine, code_text, 1 if is_ai else 0, 0, "active", db.now(), db.now()))
    if stype == "composite":
        db.execute("UPDATE strategy SET composite=? WHERE id=?",
                   (json.dumps(params.get("composite"), ensure_ascii=False), sid))
    db.audit(user["id"], "strategy.create", code)
    return _row(dict(db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))))


@router.patch("/strategies/{sid}")
def update(sid: int, payload: dict, user: dict = Depends(UPDATE)) -> dict:
    r = db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    _own_or_500(r, user)
    cur = json.loads(r["params"] or "{}")
    if "name" in payload:
        db.execute("UPDATE strategy SET name=? WHERE id=?", (payload["name"], sid))
    if "description" in payload:
        db.execute("UPDATE strategy SET description=? WHERE id=?", (payload["description"], sid))
    if "status" in payload:
        db.execute("UPDATE strategy SET status=? WHERE id=?", (payload["status"], sid))
    saved = {**cur, **(payload.get("params") or {})}
    if payload.get("hard"):
        saved["hard"] = {**(cur.get("hard") or {}), **payload["hard"]}
    if payload.get("filters"):
        saved["filters"] = {**(cur.get("filters") or {}), **payload["filters"]}
    if payload.get("composite") is not None:
        db.execute("UPDATE strategy SET composite=? WHERE id=?",
                   (json.dumps(payload["composite"], ensure_ascii=False), sid))
    if payload.get("code") is not None:
        v = eng.validate_code(payload["code"])
        if not v["ok"]:
            raise HTTPException(400, detail={"code": "BAD_CODE", "message": "；".join(v["problems"])})
        saved["code"] = payload["code"]
        saved["engine"] = payload.get("engine") or "code"
        db.execute("UPDATE strategy SET code_text=?, engine=?, strategy_type='custom_code' WHERE id=?",
                   (payload["code"], saved["engine"], sid))
    db.execute("UPDATE strategy SET params=?,updated_at=? WHERE id=?",
               (json.dumps(saved, ensure_ascii=False), db.now(), sid))
    db.audit(user["id"], "strategy.update", r["code"])
    return _row(dict(db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))))


@router.delete("/strategies/{sid}")
def delete(sid: int, user: dict = Depends(DELETE)) -> dict:
    r = db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    _own_or_500(r, user)
    db.execute("DELETE FROM strategy WHERE id=?", (sid,))
    db.execute("DELETE FROM strategy_pick WHERE run_id IN (SELECT id FROM strategy_run WHERE strategy_id=?)", (sid,))
    db.execute("DELETE FROM strategy_run WHERE strategy_id=?", (sid,))
    db.audit(user["id"], "strategy.delete", r["code"])
    return {"ok": True}


@router.post("/strategies/{sid}/run")
def run(sid: int, user: dict = Depends(RUN)) -> dict:
    r = db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    quota = _quota_left(user)
    if quota is not None and quota <= 0:
        raise HTTPException(403, detail={"code": "QUOTA_EXHAUSTED",
                                         "message": "额度已耗尽，请升级或联系管理员"})
    res = eng.start_run(dict(r), user["id"])
    if quota is not None:
        db.execute("UPDATE users SET token_used=token_used+? WHERE id=?", (2000, user["id"]))
    db.audit(user["id"], "strategy.run", r["code"])
    return res


def _quota_left(user: dict) -> int | None:
    q = user.get("token_quota") or 0
    if not q:      # 未配额的账号不限制
        return None
    return q - (user.get("token_used") or 0)


@router.get("/strategies/{sid}/picks")
def picks(sid: int, run_id: int = Query(...), asset_type: str = Query("stock"),
          limit: int = Query(200, le=500), user: dict = Depends(MENU)) -> dict:
    return eng.poll_run(sid, run_id, limit=limit)


@router.get("/strategies/{sid}/runs")
def runs(sid: int, page: int = Query(1, ge=1), size: int = Query(20, le=100),
         user: dict = Depends(MENU)) -> dict:
    rows = db.query("SELECT * FROM strategy_run WHERE strategy_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
                    (sid, size, (page - 1) * size))
    total = db.query_one("SELECT COUNT(*) c FROM strategy_run WHERE strategy_id=?", (sid,))["c"]
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["data_warnings"] = json.loads(d.get("data_warnings") or "[]")
        except Exception:
            d["data_warnings"] = []
        out.append(d)
    return {"rows": out, "total": total, "page": page, "size": size}


@router.get("/strategies/runs/{run_id}/picks")
def run_picks(run_id: int, limit: int = Query(200, le=500), user: dict = Depends(MENU)) -> dict:
    r = db.query_one("SELECT strategy_id FROM strategy_run WHERE id=?", (run_id,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "运行记录不存在"})
    return eng.poll_run(r["strategy_id"], run_id, limit=limit)


@router.get("/strategies/{sid}/history-win-rate")
def win_rate(sid: int, days: int = Query(12, le=40), horizon: int = Query(5, le=20),
             sample: int = Query(600, le=2000), user: dict = Depends(MENU)) -> dict:
    r = db.query_one("SELECT * FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    cache = db.get_setting("win_rate_cache", {}) or {}
    key = f"{r['strategy_type']}|{days}|{horizon}|{sample}"
    if cache.get(key) and not r["is_ai"]:
        return {**cache[key], "cached": True}
    res = eng.backtest_win_rate(r["strategy_type"], days=days, horizon=horizon, sample=sample)
    if res.get("ok"):
        cache[key] = res
        db.set_setting("win_rate_cache", cache)
    return {**res, "strategy_code": r["code"], "is_system": bool(r["is_system"])}


@router.post("/strategies/import")
async def import_strategy(upload: UploadFile = File(...), user: dict = Depends(CREATE)) -> dict:
    """multipart 上传 .json/.txt/.md（<50KB），Python 文件一律拒绝"""
    name = upload.filename or ""
    low = name.lower()
    if low.endswith(".py"):
        raise HTTPException(400, detail={"code": "PY_REJECTED",
                                         "message": "出于安全限制不接受 Python 文件上传，请用 .json/.txt/.md"})
    if not low.endswith((".json", ".txt", ".md")):
        raise HTTPException(400, detail={"code": "BAD_EXT", "message": "仅支持 .json / .txt / .md"})
    raw = await upload.read()
    if len(raw) > 50_000:
        raise HTTPException(400, detail={"code": "TOO_LARGE", "message": "文件超过 50KB"})
    text = raw.decode("utf-8", errors="ignore")
    if low.endswith(".json"):
        try:
            obj = json.loads(text)
        except Exception as exc:
            raise HTTPException(400, detail={"code": "BAD_JSON", "message": f"JSON 解析失败：{exc}"})
        payload = {"name": obj.get("name") or obj.get("display_name"),
                   "description": obj.get("description"),
                   "strategy_type": obj.get("strategy_type") or "custom",
                   "params": obj.get("params") or {}}
        if not payload["name"]:
            raise HTTPException(400, detail={"code": "BAD_JSON", "message": "导入文件缺少 name/display_name"})
        return {"mode": "json", "created": create(payload, user=user)}
    gen = ai_svc.generate_strategy(text[:8000], user=user)
    created = create(_gen_payload(gen), user=user)
    return {"mode": "ai" if gen.get("source") == "ai" else "builtin-fallback",
            "created": created, "note": gen.get("note"), "generation": _gen_echo(gen)}


def _gen_payload(gen: dict) -> dict:
    return {"name": gen.get("name"), "description": gen.get("description"),
            "direction": gen.get("direction"),
            "strategy_type": gen.get("strategyType") or "custom_code",
            "params": {"ai": True, "code": gen.get("code") or "",
                       "engine": gen.get("engine"), "rules": gen.get("rules"),
                       "min_score": gen.get("min_score") or 50,
                       "source": gen.get("source"), "dryRun": gen.get("dryRun")}}


def _gen_echo(gen: dict) -> dict:
    return {k: gen.get(k) for k in ("source", "name", "description", "direction", "strategyType",
                                    "engine", "model", "latencyMs", "validation", "dryRun",
                                    "note", "matchScore", "fallbackReason")}


@router.post("/strategies/ai-generate")
def ai_generate(payload: dict, user: dict = Depends(CREATE)) -> dict:
    """自然语言生成策略代码；不落库，供前端预览后再保存"""
    text = payload.get("description") or payload.get("rules") or ""
    if len(text) < 4:
        raise HTTPException(400, detail={"code": "BAD_INPUT", "message": "请用一句话描述选股逻辑"})
    if payload.get("save"):
        gen = ai_svc.generate_strategy(text, user=user)
        created = create(_gen_payload(gen), user=user)
        return {"created": created, "generation": _gen_echo(gen)}
    return ai_svc.generate_strategy(text, user=user)


@router.get("/strategies/{sid}/code")
def get_code(sid: int, user: dict = Depends(MENU)) -> dict:
    r = db.query_one("SELECT code,code_text,name FROM strategy WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "策略不存在"})
    return {"name": r["name"], "code": r["code"], "codeText": r["code_text"] or ""}


def _slug(raw: str, user_id: int) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", (raw or "").lower()).strip("_")[:40]
    base = f"custom_{s or 'code'}"
    cand = f"{base}_{user_id}"
    while db.query_one("SELECT id FROM strategy WHERE code=?", (cand,)):
        cand = f"{base}_{user_id}_{secrets.token_hex(2)}"
    return cand
