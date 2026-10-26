"""每日复盘 /reviews/*（拆解文档 3.15）"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, security
from ..services import review

router = APIRouter(tags=["review"])
VIEW = security.require_perm("review:view")
GEN = security.require_perm("review:generate")
SCHED = security.require_perm("review:schedule")
DEL = security.require_perm("review:delete")


@router.get("/reviews")
def lists(user: dict = Depends(VIEW)) -> dict:
    rows = review.list_reports(user["id"])
    return {"rows": rows, "total": len(rows), "sections": review.SECTIONS}


@router.get("/reviews/schedule")
def get_schedule(user: dict = Depends(VIEW)) -> dict:
    return review.schedule_config()


@router.put("/reviews/schedule")
def put_schedule(body: dict, user: dict = Depends(SCHED)) -> dict:
    out = review.save_schedule(body or {})
    from .. import scheduler
    scheduler.apply_settings()  # 开关与时间立刻反映到定时任务，不用重启后端
    db.audit(user["id"], "review:schedule", f"{out.get('time')} enabled={out.get('enabled')}")
    return out


@router.post("/reviews/generate")
def generate(date: str = Query(""), user: dict = Depends(GEN)) -> dict:
    try:
        out = review.generate(user["id"], date or None)
    except Exception as exc:  # noqa: BLE001 — 汇总链路长，把原因带回前端
        raise HTTPException(502, detail={"code": "REVIEW_FAILED", "message": str(exc)}) from exc
    db.audit(user["id"], "review:generate", out["date"])
    return out


@router.get("/reviews/{report_id}")
def get_report(report_id: int, user: dict = Depends(VIEW)) -> dict:
    row = review.get_report(user["id"], report_id)
    if not row:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "复盘报告不存在"})
    return row


@router.delete("/reviews/{report_id}")
def delete_report(report_id: int, user: dict = Depends(DEL)) -> dict:
    if not review.delete_report(user["id"], report_id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "复盘报告不存在"})
    db.audit(user["id"], "review:delete", str(report_id))
    return {"ok": True}


@router.post("/reviews/schedule/send-now")
def send_now(date: str = Query(""), user: dict = Depends(SCHED)) -> dict:
    try:
        out = review.send_now(user["id"], date or None)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "SEND_FAILED", "message": str(exc)}) from exc
    db.audit(user["id"], "review:send-now", out.get("status") or "")
    return out


@router.post("/reviews/schedule/test-email")
def test_email(body: dict, user: dict = Depends(SCHED)) -> dict:
    to = (body or {}).get("email_to") or []
    out = review.test_email(user["id"], [str(x) for x in to])
    db.audit(user["id"], "review:test-email", out.get("status") or "")
    return out
