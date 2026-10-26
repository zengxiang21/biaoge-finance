"""认证与权限接口：/auth/*"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db, security
from ..permissions import NAV_GROUPS, ROUTE_PERMISSIONS, ROLE_LABELS
from .settings import brand_config as site_brand

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class RegisterBody(LoginBody):
    email: str | None = None
    displayName: str | None = None


class RefreshBody(BaseModel):
    refreshToken: str


def _profile(row: db.sqlite3.Row) -> dict:
    return {
        "id": row["id"], "username": row["username"], "email": row["email"],
        "displayName": row["display_name"] or row["username"], "role": row["role"],
        "roleLabel": ROLE_LABELS.get(row["role"], row["role"]), "status": row["status"],
        "memberExpireAt": row["member_expire_at"], "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
    }


@router.post("/login")
def login(body: LoginBody) -> dict:
    row = db.query_one("SELECT * FROM users WHERE username=? OR email=?", (body.username, body.username))
    if not row or not security.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "CREDENTIAL_INVALID", "message": "用户名或密码不对"})
    if row["status"] != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail={"code": "ACCOUNT_DISABLED", "message": "账号已停用，联系管理员"})
    if row["member_expire_at"] and row["member_expire_at"] < db.now():
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail={"code": "ACCOUNT_EXPIRED", "message": "会员已过期"})
    db.execute("UPDATE users SET last_login_at=? WHERE id=?", (db.now(), row["id"]))
    tokens = security.make_pair(row["id"], row["role"])
    db.audit(row["id"], "auth:login", row["username"])
    return {**tokens, "user": _profile(row)}


@router.post("/register", status_code=201)
def register(body: RegisterBody) -> dict:
    if db.query_one("SELECT id FROM users WHERE username=?", (body.username,)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "USERNAME_TAKEN", "message": "这个用户名已经被用了"})
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "WEAK_PASSWORD", "message": "密码至少 8 位"})
    user_id = db.execute(
        "INSERT INTO users(username,email,display_name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)",
        (body.username, body.email, body.displayName or body.username, "user",
         security.hash_password(body.password), db.now()))
    db.audit(user_id, "auth:register", body.username)
    row = db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
    return {**security.make_pair(user_id, "user"), "user": _profile(row)}


@router.post("/refresh")
def refresh(body: RefreshBody) -> dict:
    data = security._decode(body.refreshToken, "refresh")
    row = db.query_one("SELECT * FROM users WHERE id=?", (int(data["sub"]),))
    if not row or row["status"] != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "USER_GONE", "message": "账号不可用"})
    return security.make_pair(row["id"], row["role"])


@router.post("/logout")
def logout(body: dict, user: dict = Depends(security.current_user)) -> dict:
    auth: str = body.get("refreshToken") or ""
    if auth:
        try:
            data = security._decode(auth, "refresh")
            security.revoke(data["jti"], user["id"])
        except HTTPException:
            pass
    db.audit(user["id"], "auth:logout", user["username"])
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(security.current_user)) -> dict:
    return {"user": _profile(user), "permissions": security.permissions_of(user["id"], user["role"])}


@router.get("/context")
def context(user: dict = Depends(security.current_user)) -> dict:
    perms = set(security.permissions_of(user["id"], user["role"]))
    visible_groups = []
    for g in NAV_GROUPS:
        items = [dict(i, granted=(i["perm"] in perms)) for i in g["items"] if i["perm"] in perms]
        if items:
            visible_groups.append({"key": g["key"], "label": g["label"], "items": items})
    return {
        "user": _profile(user),
        "permissions": sorted(perms),
        "routePermissions": ROUTE_PERMISSIONS,
        "menuTree": visible_groups,
        "brand": site_brand(),
        "quota": {"aiUnlimited": True, "note": "会员/配额体系在文档第十二章，本轮未启用"},
    }
