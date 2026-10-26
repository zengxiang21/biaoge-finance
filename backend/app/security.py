"""JWT 双 Token + PBKDF2 口令 + 三层权限守卫"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, status

from . import config, db
from .permissions import ROUTE_PERMISSIONS

PBKDF2_ROUNDS = 240_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds)).hex()
    except Exception:
        return False
    return hmac.compare_digest(calc, digest)


def _make_token(kind: str, user_id: int, role: str, ttl: timedelta) -> tuple[str, str, int]:
    jti = uuid.uuid4().hex
    exp = datetime.now(timezone.utc) + ttl
    payload = {
        "sub": str(user_id), "role": role, "typ": kind,
        "jti": jti, "exp": exp, "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALG), jti, int(exp.timestamp())


def make_pair(user_id: int, role: str) -> dict[str, Any]:
    at, at_jti, at_exp = _make_token("access", user_id, role, timedelta(minutes=config.ACCESS_TOKEN_TTL_MIN))
    rt, rt_jti, rt_exp = _make_token("refresh", user_id, role, timedelta(days=config.REFRESH_TOKEN_TTL_DAYS))
    return {
        "accessToken": at, "accessTokenExpiresAt": at_exp,
        "refreshToken": rt, "refreshTokenExpiresAt": rt_exp,
        "tokenType": "Bearer",
    }


def _decode(token: str, expect: str) -> dict:
    try:
        data = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "TOKEN_EXPIRED", "message": "登录已过期，请重新登录"})
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "TOKEN_INVALID", "message": "凭证无效"})
    if data.get("typ") != expect:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "TOKEN_INVALID", "message": "凭证类型不对"})
    if db.query_one("SELECT jti FROM revoked_tokens WHERE jti=?", (data.get("jti"),)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "TOKEN_REVOKED", "message": "凭证已失效，请重新登录"})
    return data


def current_user(authorization: str | None = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHORIZED", "message": "请先登录"})
    data = _decode(authorization.split(" ", 1)[1].strip(), "access")
    row = db.query_one("SELECT * FROM users WHERE id=?", (int(data["sub"]),))
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "USER_GONE", "message": "账号不存在"})
    if row["status"] != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "ACCOUNT_DISABLED", "message": "账号已停用"})
    if row["member_expire_at"] and row["member_expire_at"] < db.now():
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "ACCOUNT_EXPIRED", "message": "会员已过期"})
    return dict(row)


def permissions_of(user_id: int, role: str) -> list[str]:
    rows = db.query("SELECT code FROM role_permissions WHERE role=?", (role,))
    return sorted({r["code"] for r in rows})


def has_perm(user: dict, code: str) -> bool:
    return code in permissions_of(user["id"], user["role"])


def require_perm(code: str):
    """操作级守卫：Depends(require_perm('watchlist:item_create'))"""
    def _dep(user: dict = Depends(current_user)) -> dict:
        if not has_perm(user, code):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "PERMISSION_DENIED", "message": f"缺少权限 {code}"})
        return user
    return _dep


def require_route(path: str):
    """路由级守卫：按 ROUTE_PERMISSIONS 校验"""
    return require_perm(ROUTE_PERMISSIONS.get(path, "menu:dashboard"))


def revoke(jti: str, user_id: int) -> None:
    db.execute("INSERT OR IGNORE INTO revoked_tokens(jti,user_id,revoked_at) VALUES(?,?,?)", (jti, user_id, db.now()))
