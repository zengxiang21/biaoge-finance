"""AI 引擎配置与调用：/settings/ai*、/ai/*"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .. import db, security
from ..services import ai

router = APIRouter(tags=["ai"])


class AiConfigBody(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    timeout_s: int | None = None
    keep_alive: str | None = None
    enabled: bool | None = None
    apiKeyPlain: str | None = None


class AnalyzeBody(BaseModel):
    symbol: str
    mode: str = "deep"


@router.get("/settings/ai", dependencies=[Depends(security.require_perm("menu:workbench:settings:ai"))])
def get_ai_config() -> dict:
    cfg = ai.get_config()
    models = ai.list_models()
    return {"config": cfg, "reachable": models["ok"], "models": models["models"],
            "error": models.get("error"), "usage": ai.usage_stat()}


@router.put("/settings/ai")
def put_ai_config(body: AiConfigBody,
                  user: dict = Depends(security.require_perm("settings:ai:update"))) -> dict:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return {"config": ai.save_config(patch), "usage": ai.usage_stat()}


@router.post("/settings/ai/test", dependencies=[Depends(security.require_perm("settings:ai:test"))])
def test_ai(prompt: str = Query("用一句话说明沪深300指数是什么")) -> dict:
    try:
        res = ai.chat([{"role": "user", "content": prompt}], purpose="connection_test",
                      user_id=None)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "AI_UNREACHABLE", "message": str(exc)[:300]})
    return {"ok": True, "answer": res["content"][:600], "model": res["model"],
            "latencyMs": res["latencyMs"], "usage": res["usage"]}


@router.get("/settings/ai/models")
def ai_models(user: dict = Depends(security.current_user)) -> dict:
    return ai.list_models()


@router.post("/ai/analyze")
def analyze(body: AnalyzeBody, user: dict = Depends(security.current_user)) -> dict:
    try:
        return ai.analyze_stock(body.symbol, user["id"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "AI_FAILED", "message": str(exc)[:300]})


@router.post("/ai/predict-price-target")
def predict(body: AnalyzeBody, user: dict = Depends(security.current_user)) -> dict:
    try:
        return ai.predict_price_target(body.symbol, user["id"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "AI_FAILED", "message": str(exc)[:300]})


@router.get("/ai/usage")
def usage(user: dict = Depends(security.current_user)) -> dict:
    rows = [dict(r) for r in db.query(
        "SELECT id,purpose,model,engine,prompt_tokens,completion_tokens,latency_ms,status,"
        "note,created_at FROM ai_calls ORDER BY id DESC LIMIT 20")]
    return {"stat": ai.usage_stat(), "recent": rows}
