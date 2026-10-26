"""管理工作台：全局监控 / 学员与 Token 配额 / 反馈管理（文档 3.17）"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from .. import db, scheduler, security
from ..permissions import ROLE_LABELS
from ..providers import registry

router = APIRouter(prefix="/admin", tags=["admin"])
user_feedback_router = APIRouter(prefix="/feedbacks", tags=["feedback"])

TODAY = db.now()[:10]


def _day_start(days_ago: int = 0) -> str:
    day = datetime.now() - timedelta(days=days_ago)
    return day.strftime("%Y-%m-%d 00:00:00")


def _pct(part: float, whole: float) -> float | None:
    return round(part / whole * 100, 1) if whole else None


# ---------------- 学员使用统计 ----------------

def _usage_rows(days: int = 7) -> list[dict]:
    """一张表把账号信息 + Token 消耗 + 业务量拼齐，监控页和学员页共用"""
    week_start = _day_start(max(0, days - 1))
    calls = {
        r["user_id"]: dict(r) for r in db.query(
            "SELECT user_id, COUNT(*) calls, "
            "SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok, "
            "SUM(COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0)) tokens, "
            "AVG(latency_ms) avg_latency, MAX(created_at) last_at, "
            "SUM(CASE WHEN created_at>=? THEN COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0) ELSE 0 END) today_tokens, "
            "SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) today_calls, "
            "SUM(CASE WHEN created_at>=? THEN COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0) ELSE 0 END) window_tokens "
            "FROM ai_calls GROUP BY user_id",
            (_day_start(), _day_start(), week_start))
    }
    counts = {}
    for table, key in (("watchlist_items", "watchlist"), ("strategy", "strategies"),
                       ("holdings_account", "holdings"), ("sim_account", "simAccounts"),
                       ("review_report", "reviews")):
        for r in db.query(f"SELECT user_id, COUNT(*) n FROM {table} GROUP BY user_id"):
            counts.setdefault(r["user_id"], {})[key] = r["n"]

    rows = []
    for u in db.query("SELECT * FROM users ORDER BY id"):
        c = calls.get(u["id"])
        quota = int(u["token_quota"] or 0)
        used = int((c or {}).get("tokens") or 0)
        rows.append({
            "id": u["id"], "username": u["username"],
            "displayName": u["display_name"] or u["username"],
            "email": u["email"], "phone": u["phone"], "role": u["role"],
            "roleLabel": ROLE_LABELS.get(u["role"], u["role"]), "status": u["status"],
            "memberPlan": u["member_plan"], "memberExpireAt": u["member_expire_at"],
            "remark": u["remark"], "createdAt": u["created_at"], "lastLoginAt": u["last_login_at"],
            "tokenQuota": quota, "tokenUsed": used,
            "tokenRemaining": (quota - used) if quota > 0 else None,
            "tokenUsedPct": _pct(used, quota) if quota > 0 else None,
            "tokenToday": int((c or {}).get("today_tokens") or 0),
            "tokenWindow": int((c or {}).get("window_tokens") or 0),
            "aiCalls": int((c or {}).get("calls") or 0),
            "aiOk": int((c or {}).get("ok") or 0),
            "aiFailed": int((c or {}).get("calls") or 0) - int((c or {}).get("ok") or 0),
            "aiAvgLatency": round(float((c or {}).get("avg_latency") or 0), 1),
            "aiLastAt": (c or {}).get("last_at"),
            "callsToday": int((c or {}).get("today_calls") or 0),
            "watchlist": counts.get(u["id"], {}).get("watchlist", 0),
            "strategies": counts.get(u["id"], {}).get("strategies", 0),
            "holdings": counts.get(u["id"], {}).get("holdings", 0),
            "simAccounts": counts.get(u["id"], {}).get("simAccounts", 0),
            "reviews": counts.get(u["id"], {}).get("reviews", 0),
        })
    return rows


@router.get("/workbench/student-usage")
def student_usage(days: int = Query(7, ge=1, le=90),
                  user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    rows = _usage_rows(days)
    return {"rows": rows, "days": days,
            "totals": {
                "users": len(rows),
                "active": sum(1 for r in rows if r["status"] == "active"),
                "tokenQuota": sum(r["tokenQuota"] for r in rows),
                "tokenUsed": sum(r["tokenUsed"] for r in rows),
                "tokenToday": sum(r["tokenToday"] for r in rows),
                "aiCalls": sum(r["aiCalls"] for r in rows),
                "overQuota": sum(1 for r in rows
                                 if r["tokenQuota"] > 0 and r["tokenUsed"] > r["tokenQuota"]),
            }}


class QuotaBody(BaseModel):
    userId: int
    tokenQuota: int = Field(ge=0, le=10 ** 9)


class BatchQuotaBody(BaseModel):
    userIds: list[int]
    action: Literal["set", "add", "reduce"] = "set"
    tokenQuota: int = Field(ge=0, le=10 ** 9)


@router.put("/workbench/student-quota")
def put_quota(body: QuotaBody,
              user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    if not db.query_one("SELECT id FROM users WHERE id=?", (body.userId,)):
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "NOT_FOUND", "message": "学员不存在"})
    db.execute("UPDATE users SET token_quota=? WHERE id=?", (body.tokenQuota, body.userId))
    db.audit(user["id"], "admin:student-quota", f"user={body.userId} quota={body.tokenQuota}")
    return {"ok": True, "userId": body.userId, "tokenQuota": body.tokenQuota}


@router.post("/workbench/student-quota/batch")
def batch_quota(body: BatchQuotaBody,
               user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    ids = [i for i in dict.fromkeys(body.userIds)
           if db.query_one("SELECT id FROM users WHERE id=?", (i,))]
    if not ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "NOT_FOUND", "message": "选中的学员都不存在"})
    marks = ",".join("?" * len(ids))
    if body.action == "set":
        db.execute(f"UPDATE users SET token_quota=? WHERE id IN ({marks})", (body.tokenQuota, *ids))
    elif body.action == "add":
        db.execute(f"UPDATE users SET token_quota=COALESCE(token_quota,0)+? WHERE id IN ({marks})",
                   (body.tokenQuota, *ids))
    else:
        db.execute(f"UPDATE users SET token_quota=MAX(0, COALESCE(token_quota,0)-?) WHERE id IN ({marks})",
                   (body.tokenQuota, *ids))
    db.audit(user["id"], "admin:student-quota-batch",
             f"action={body.action} n={len(ids)} quota={body.tokenQuota}")
    return {"ok": True, "affected": len(ids), "userIds": ids}


# ---------------- 学员账号管理 ----------------

class StudentBody(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=8)
    displayName: str | None = None
    email: str | None = None
    phone: str | None = None
    role: Literal["user", "vip", "admin"] = "user"
    tokenQuota: int = Field(default=0, ge=0, le=10 ** 9)
    memberPlan: str | None = None
    memberExpireAt: str | None = None
    remark: str | None = None


class StudentPatchBody(BaseModel):
    displayName: str | None = None
    email: str | None = None
    phone: str | None = None
    role: Literal["user", "vip", "admin"] | None = None
    status: Literal["active", "disabled", "closed"] | None = None
    password: str | None = Field(default=None, min_length=8)
    tokenQuota: int | None = Field(default=None, ge=0, le=10 ** 9)
    memberPlan: str | None = None
    memberExpireAt: str | None = None
    remark: str | None = None


def _load_student(user_id: int) -> dict:
    row = db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "NOT_FOUND", "message": "学员不存在"})
    out = dict(row)
    out.pop("password_hash", None)      # SELECT * 会把哈希带出接口，这里掐掉
    return out


def _guard_admin_left(row: dict, actor: dict, new_status: str | None, new_role: str | None) -> None:
    """别把自己关在门外，也别把平台改成无政府状态"""
    is_admin = row["role"] == "admin" and row["status"] == "active"
    still_admin = (new_role or row["role"]) == "admin" and (new_status or row["status"]) == "active"
    if not (is_admin and not still_admin):
        return
    if row["id"] == actor["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PERMISSION_DENIED", "message": "不能停用或降级自己的管理员身份"})
    others = db.query_one(
        "SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active' AND id<>?", (row["id"],))
    if not (others and others["n"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PERMISSION_DENIED", "message": "至少要留一个可用管理员"})


@router.post("/students", status_code=201)
def create_student(body: StudentBody,
                   user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    if db.query_one("SELECT id FROM users WHERE username=?", (body.username,)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "USERNAME_TAKEN", "message": "这个用户名已经被用了"})
    uid = db.execute(
        "INSERT INTO users(username,email,display_name,phone,role,status,password_hash,"
        "token_quota,member_plan,member_expire_at,remark,created_at) "
        "VALUES(?,?,?,?,?,'active',?,?,?,?,?,?)",
        (body.username, body.email, body.displayName or body.username, body.phone, body.role,
         security.hash_password(body.password), body.tokenQuota, body.memberPlan,
         body.memberExpireAt, body.remark, db.now()))
    db.audit(user["id"], "admin:student-create", f"{body.username} role={body.role}")
    return {"ok": True, "user": _load_student(uid)}


@router.patch("/students/{user_id}")
def patch_student(user_id: int, body: StudentPatchBody,
                  user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    row = _load_student(user_id)
    patch = body.model_dump(exclude_unset=True)
    _guard_admin_left(row, user, patch.get("status"), patch.get("role"))
    if "password" in patch:
        pwd = patch.pop("password")
        if pwd:
            db.execute("UPDATE users SET password_hash=? WHERE id=?",
                       (security.hash_password(pwd), user_id))
    cols = {"displayName": "display_name", "email": "email", "phone": "phone", "role": "role",
            "status": "status", "tokenQuota": "token_quota", "memberPlan": "member_plan",
            "memberExpireAt": "member_expire_at", "remark": "remark"}
    sets = [(cols[k], v) for k, v in patch.items() if k in cols]
    if sets:
        marks = ",".join(f"{col}=?" for col, _ in sets)
        db.execute(f"UPDATE users SET {marks} WHERE id=?",
                   tuple(v for _, v in sets) + (user_id,))
    db.audit(user["id"], "admin:student-update", f"user={user_id} {sorted(patch)}")
    return {"ok": True, "user": _load_student(user_id)}


@router.delete("/students/{user_id}")
def close_student(user_id: int,
                  user: dict = Depends(security.require_perm("menu:workbench:students"))) -> dict:
    row = _load_student(user_id)
    if row["id"] == user["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PERMISSION_DENIED", "message": "不能注销自己"})
    _guard_admin_left(row, user, "closed", None)
    db.execute("UPDATE users SET status='closed' WHERE id=?", (user_id,))
    db.audit(user["id"], "admin:student-close", row["username"])
    return {"ok": True, "user": _load_student(user_id)}


# ---------------- 全局监控 ----------------

@router.get("/workbench/monitor")
def monitor(user: dict = Depends(security.require_perm("menu:workbench:monitor"))) -> dict:
    today = _day_start()
    yesterday = _day_start(1)
    week = _day_start(6)

    def agg(where: str, params: tuple) -> dict:
        r = dict(db.query_one(
            f"SELECT COUNT(*) calls, "
            f"SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok, "
            f"SUM(COALESCE(prompt_tokens,0)) prompt_tokens, "
            f"SUM(COALESCE(completion_tokens,0)) completion_tokens, "
            f"AVG(latency_ms) avg_latency, COUNT(DISTINCT user_id) users, "
            f"MAX(created_at) last_at FROM ai_calls WHERE {where}", params) or {})
        calls = int(r.get("calls") or 0)
        ok = int(r.get("ok") or 0)
        tokens = int(r.get("prompt_tokens") or 0) + int(r.get("completion_tokens") or 0)
        return {"calls": calls, "ok": ok, "failed": calls - ok,
                "successRate": _pct(ok, calls), "users": int(r.get("users") or 0),
                "promptTokens": int(r.get("prompt_tokens") or 0),
                "completionTokens": int(r.get("completion_tokens") or 0),
                "tokens": tokens, "avgLatencyMs": round(float(r.get("avg_latency") or 0), 1),
                "avgTokensPerCall": round(tokens / calls) if calls else 0,
                "lastAt": r.get("last_at")}

    purposes = [{"purpose": r["purpose"], "calls": r["n"],
                 "ok": int(r["n"]) - int(r["bad"]), "failed": int(r["bad"]),
                 "tokens": int(r["t"] or 0), "avgLatencyMs": round(float(r["lat"] or 0), 1)}
                for r in db.query(
                    "SELECT purpose, COUNT(*) n, SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) bad, "
                    "SUM(COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0)) t, AVG(latency_ms) lat "
                    "FROM ai_calls WHERE created_at>=? GROUP BY purpose ORDER BY t DESC", (week,))]
    models = [{"model": r["model"], "calls": r["n"], "engine": r["engine"]} for r in db.query(
        "SELECT model, engine, COUNT(*) n FROM ai_calls WHERE created_at>=? "
        "GROUP BY model, engine ORDER BY n DESC LIMIT 6", (week,))]
    failures = [{"id": r["id"], "userId": r["user_id"], "purpose": r["purpose"],
                 "model": r["model"], "note": r["note"], "createdAt": r["created_at"]}
                for r in db.query(
                    "SELECT id,user_id,purpose,model,note,created_at FROM ai_calls "
                    "WHERE status<>'ok' ORDER BY id DESC LIMIT 8")]

    # 老库里的 job_runs 可能没有 started_at，按最近 200 条在 Python 侧聚合更稳
    by_job: dict[str, dict] = {}
    for r in db.query("SELECT job,status,trigger,started_at,finished_at,detail "
                      "FROM job_runs ORDER BY id DESC LIMIT 200"):
        stamp = r["started_at"] or r["finished_at"] or ""
        item = by_job.setdefault(r["job"], {
            "job": r["job"], "label": scheduler.JOB_LABELS.get(r["job"], r["job"]),
            "runs": 0, "errors": 0, "today": 0,
            "lastAt": None, "lastStatus": None, "detail": ""})
        item["runs"] += 1
        if r["status"] == "error":
            item["errors"] += 1
        if stamp >= today:
            item["today"] += 1
        if item["lastStatus"] is None:      # 查询按 id 倒序，第一条就是最近一次
            item["lastStatus"] = r["status"]
            item["lastAt"] = stamp or None
            item["detail"] = (r["detail"] or "")[:200]
    jobs = sorted(by_job.values(), key=lambda j: (j["lastAt"] or ""), reverse=True)

    usage = _usage_rows(7)
    top = sorted(usage, key=lambda r: (-r["tokenWindow"], -r["aiCalls"]))[:8]
    over = [r for r in usage if r["tokenQuota"] > 0 and r["tokenUsed"] > r["tokenQuota"]]

    users = db.query_one("SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, "
                         "SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END) admin, "
                         "SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) new_today FROM users", (today,))
    market_row = db.query_one("SELECT trade_date,total,up,down,limit_up,score,built_at "
                              "FROM market_daily ORDER BY trade_date DESC LIMIT 1")
    label_by_score = None
    if market_row and market_row["score"] is not None:
        from ..permissions import emotion_label
        label_by_score = emotion_label(float(market_row["score"]))

    def count(table: str, where: str = "", params: tuple = ()) -> int:
        r = db.query_one(f"SELECT COUNT(*) n FROM {table} WHERE {where}" if where
                         else f"SELECT COUNT(*) n FROM {table}", params)
        return int(r["n"]) if r else 0

    return {
        "generatedAt": db.now(),
        "date": TODAY,
        "token": {"today": agg("created_at>=?", (today,)),
                  "yesterday": agg("created_at>=? AND created_at<?", (yesterday, today)),
                  "week": agg("created_at>=?", (week,)),
                  "all": agg("1=1", ())},
        "ai": {"byPurpose": purposes, "models": models, "failures": failures},
        "students": {"rows": top, "overQuota": over,
                     "totals": {"users": len(usage),
                                "active": sum(1 for r in usage if r["status"] == "active"),
                                "quota": sum(r["tokenQuota"] for r in usage),
                                "used": sum(r["tokenUsed"] for r in usage),
                                "usedToday": sum(r["tokenToday"] for r in usage)}},
        "scheduler": scheduler.status(),
        "jobs": jobs,
        "dataSources": registry.summary(),
        "users": {"total": int(users["total"] or 0), "active": int(users["active"] or 0),
                  "admin": int(users["admin"] or 0), "newToday": int(users["new_today"] or 0)},
        "market": dict(market_row) if market_row else None,
        "emotion": label_by_score,
        "content": {
            "snapshotStocks": count("snapshot_stocks", "trade_date=(SELECT MAX(trade_date) FROM market_daily)"),
            "boards": count("board_daily", "trade_date=(SELECT MAX(trade_date) FROM market_daily)"),
            "anomalyToday": count("anomaly_event", "triggered_at>=?", (yesterday,)),
            "strategies": count("strategy"),
            "strategyRunsToday": count("strategy_run", "started_at>=?", (today,)),
            "reviewsToday": count("review_report", "created_at>=?", (today,)),
            "reviewsTotal": count("review_report"),
            "feedbackOpen": count("feedback", "status='open'"),
            "feedbackTotal": count("feedback"),
            "notificationsUnread": count("notification", "read_at IS NULL"),
            "auditToday": count("audit_logs", "created_at>=?", (today,)),
            "newsToday": count("news_item", "created_at>=?", (today,)),
        },
    }


# ---------------- 反馈管理 ----------------

class FeedbackBody(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    content: str = Field(min_length=4, max_length=2000)
    contact: str | None = Field(default=None, max_length=60)


class ReplyBody(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)
    status: Literal["replied", "closed", "open"] = "replied"


def _feedback_row(row) -> dict:
    return {"id": row["id"], "userId": row["user_id"], "username": row["username"],
            "title": row["title"], "content": row["content"], "contact": row["contact"],
            "status": row["status"], "reply": row["reply"],
            "createdAt": row["created_at"], "repliedAt": row["replied_at"]}


@user_feedback_router.post("", status_code=201)
def submit_feedback(body: FeedbackBody, user: dict = Depends(security.current_user)) -> dict:
    fid = db.execute(
        "INSERT INTO feedback(user_id,username,title,content,contact,status,created_at) "
        "VALUES(?,?,?,?,?,'open',?)",
        (user["id"], user.get("display_name") or user["username"],
         body.title.strip(), body.content.strip(), (body.contact or "").strip(), db.now()))
    db.audit(user["id"], "feedback:create", f"#{fid} {body.title[:30]}")
    return {"ok": True, "id": fid}


@user_feedback_router.get("/my")
def my_feedback(user: dict = Depends(security.current_user)) -> dict:
    return {"rows": [_feedback_row(r) for r in db.query(
        "SELECT * FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT 50", (user["id"],))]}


@router.get("/feedbacks")
def admin_feedbacks(status_filter: str = Query("", alias="status"),
                    keyword: str = "", limit: int = Query(50, le=200),
                    offset: int = Query(0, ge=0),
                    user: dict = Depends(security.require_perm("menu:workbench:feedbacks"))) -> dict:
    where, params = [], []
    if status_filter in ("open", "replied", "closed"):
        where.append("status=?")
        params.append(status_filter)
    if keyword:
        where.append("(title LIKE ? OR content LIKE ? OR username LIKE ?)")
        params += [f"%{keyword}%"] * 3
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    total = db.query_one(f"SELECT COUNT(*) n FROM feedback {clause}", tuple(params))
    rows = db.query(f"SELECT * FROM feedback {clause} ORDER BY "
                    f"CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC LIMIT ? OFFSET ?",
                    tuple(params) + (limit, offset))
    counts = {r["status"]: r["n"] for r in db.query(
        "SELECT status, COUNT(*) n FROM feedback GROUP BY status")}
    return {"rows": [_feedback_row(r) for r in rows],
            "total": int(total["n"] if total else 0),
            "counts": {"open": counts.get("open", 0), "replied": counts.get("replied", 0),
                       "closed": counts.get("closed", 0), "total": sum(counts.values())}}


@router.post("/feedbacks/{fid}/reply")
def reply_feedback(fid: int, body: ReplyBody,
                   user: dict = Depends(security.require_perm("menu:workbench:feedbacks"))) -> dict:
    row = db.query_one("SELECT * FROM feedback WHERE id=?", (fid,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "NOT_FOUND", "message": "留言不存在"})
    db.execute("UPDATE feedback SET reply=?, status=?, replied_at=? WHERE id=?",
               (body.reply.strip(), body.status, db.now(), fid))
    if row["user_id"]:
        db.execute("INSERT INTO notification(user_id,channel,title,body,status,created_at) "
                   "VALUES(?,?,?,?,?,?)",
                   (row["user_id"], "inapp", f"反馈已回复：{row['title'][:30]}",
                    body.reply.strip(), "success", db.now()))
    db.audit(user["id"], "feedback:reply", f"#{fid} -> {body.status}")
    return {"ok": True, "id": fid}


@router.patch("/feedbacks/{fid}")
def patch_feedback(fid: int, body: dict,
                   user: dict = Depends(security.require_perm("menu:workbench:feedbacks"))) -> dict:
    new_status = (body or {}).get("status")
    if new_status not in ("open", "replied", "closed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "NOT_FOUND", "message": "状态只能是 open/replied/closed"})
    if not db.query_one("SELECT id FROM feedback WHERE id=?", (fid,)):
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "NOT_FOUND", "message": "留言不存在"})
    db.execute("UPDATE feedback SET status=? WHERE id=?", (new_status, fid))
    db.audit(user["id"], "feedback:status", f"#{fid} -> {new_status}")
    return {"ok": True, "id": fid, "status": new_status}


@router.delete("/feedbacks/{fid}")
def delete_feedback(fid: int,
                    user: dict = Depends(security.require_perm("menu:workbench:feedbacks"))) -> dict:
    db.execute("DELETE FROM feedback WHERE id=?", (fid,))
    db.audit(user["id"], "feedback:delete", f"#{fid}")
    return {"ok": True, "deleted": fid}
