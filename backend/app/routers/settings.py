"""通用设置与公开设置：平台信息 / Logo / 营销配置（文档 3.18.1）"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from .. import config, db, security

router = APIRouter(tags=["settings"])

BRAND_KEY = "site_brand"
MARKETING_KEY = "marketing"

DEFAULT_BRAND = {
    "name": "彪哥财经之英雄本色", "subtitle": "A 股看盘 · 策略选股 · AI 复盘", "logo": "", "icp": "",
    "footer_note": "数据来自新浪/东财/腾讯公开接口，仅供研究参考，不构成投资建议",
}
DEFAULT_MARKETING = {
    "plans": [
        {"key": "monthly", "label": "月付", "price": 99, "days": 30, "period": "月",
         "features": ["全市场看盘", "策略选股", "AI 复盘", "持仓提醒"], "recommended": False},
        {"key": "quarterly", "label": "季付", "price": 249, "days": 90, "period": "季",
         "features": ["含月付全部权益", "复盘邮件定时推送", "策略回测"], "recommended": True},
        {"key": "yearly", "label": "年付", "price": 799, "days": 365, "period": "年",
         "features": ["含季付全部权益", "新策略优先体验"], "recommended": False},
    ],
    "qr": {"wechat": "", "alipay": ""},
    "contact": {"wechat": "", "email": "", "note": "开通会员请加客服微信并备注来意"},
    "note": "收款走人工开通，暂不接支付网关",
}

ALLOWED_IMAGE = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
                 "image/gif": ".gif"}
MAX_UPLOAD = 2 * 1024 * 1024


def brand_config() -> dict:
    raw = db.get_setting(BRAND_KEY, {}) or {}
    merged = dict(DEFAULT_BRAND)
    for key, value in raw.items():
        if key in merged and value is not None:
            merged[key] = value
    return merged


def _marketing() -> dict:
    raw = db.get_setting(MARKETING_KEY, {}) or {}
    merged = {**DEFAULT_MARKETING, **raw}
    merged["qr"] = {**DEFAULT_MARKETING["qr"], **(raw.get("qr") or {})}
    merged["contact"] = {**DEFAULT_MARKETING["contact"], **(raw.get("contact") or {})}
    if not isinstance(merged.get("plans"), list) or not merged["plans"]:
        merged["plans"] = DEFAULT_MARKETING["plans"]
    return merged


def _payload() -> dict:
    return {"brand": brand_config(), "marketing": _marketing()}


class BrandBody(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    subtitle: str | None = Field(default=None, max_length=40)
    logo: str | None = Field(default=None, max_length=300)
    icp: str | None = Field(default=None, max_length=60)
    footerNote: str | None = Field(default=None, max_length=300)


class GeneralBody(BaseModel):
    brand: BrandBody | None = None
    contact: dict | None = None
    marketing: dict | None = None


class Plan(BaseModel):
    key: str = Field(min_length=1, max_length=20)
    label: str = Field(min_length=1, max_length=20)
    price: float = Field(ge=0, le=1_000_000)
    days: int = Field(ge=1, le=3650)
    period: str | None = Field(default=None, max_length=10)
    features: list[str] = []
    recommended: bool = False


class MarketingBody(BaseModel):
    plans: list[Plan] | None = None
    qrWechat: str | None = None
    qrAlipay: str | None = None
    contact: dict | None = None
    note: str | None = Field(default=None, max_length=300)


_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _store_upload(file: UploadFile, prefix: str) -> str:
    """落盘到 backend/data/uploads，只回相对 URL，旧文件顺手清掉"""
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_IMAGE:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            detail={"code": "BAD_SYMBOL",
                                    "message": f"只支持 png/jpg/webp/gif，收到的是 {mime or '未知类型'}"})
    data = file.file.read(MAX_UPLOAD + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "BAD_SYMBOL", "message": "文件是空的"})
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail={"code": "BAD_SYMBOL", "message": "图片超过 2MB，换张小一点的"})
    ext = ALLOWED_IMAGE[mime]
    # 文件名只留字母数字，避免 ../ 之类路径穿越
    old = Path(file.filename or "")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", old.stem)[:24] or prefix
    name = f"{prefix}-{slug}-{uuid.uuid4().hex[:8]}{ext}"
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (config.UPLOAD_DIR / name).write_bytes(data)
    return f"/api/uploads/{name}"


def _drop_old_upload(url: str | None) -> None:
    if not url or not url.startswith("/api/uploads/"):
        return
    name = url.rsplit("/", 1)[-1]
    if _SAFE_NAME.match(name):
        try:
            (config.UPLOAD_DIR / name).unlink(missing_ok=True)
        except OSError:
            pass


@router.get("/settings/general")
def get_general(user: dict = Depends(security.require_perm("menu:workbench:settings:general"))) -> dict:
    out = _payload()
    out["storage"] = {"uploadDir": str(config.UPLOAD_DIR),
                      "files": sorted(p.name for p in config.UPLOAD_DIR.glob("*")
                                      if p.is_file())[:50]
                                      if config.UPLOAD_DIR.exists() else []}
    return out


@router.put("/settings/general")
def put_general(body: GeneralBody,
                user: dict = Depends(security.require_perm("settings:general:update"))) -> dict:
    brand = brand_config()
    patch = body.brand.model_dump(exclude_unset=True) if body.brand else {}
    for snake, camel in (("name", "name"), ("subtitle", "subtitle"), ("logo", "logo"),
                         ("icp", "icp"), ("footer_note", "footerNote")):
        if patch.get(camel) is not None:
            value = patch[camel].strip() if isinstance(patch[camel], str) else patch[camel]
            if snake == "logo" and value != brand["logo"]:
                _drop_old_upload(brand["logo"])
            brand[snake] = value
    db.set_setting(BRAND_KEY, brand)

    marketing = _marketing()
    if isinstance(body.contact, dict):
        marketing["contact"] = {**marketing["contact"],
                                **{k: str(v)[:120] for k, v in body.contact.items()
                                   if k in ("wechat", "email", "note")}}
    if isinstance(body.marketing, dict):
        marketing = _apply_marketing(marketing, body.marketing)
    db.set_setting(MARKETING_KEY, marketing)
    db.audit(user["id"], "settings:general:update", brand["name"])
    return _payload()


def _apply_marketing(current: dict, raw: dict) -> dict:
    out = {**current}
    if isinstance(raw.get("plans"), list) and raw["plans"]:
        plans = []
        for i, p in enumerate(raw["plans"]):
            if not isinstance(p, dict):
                continue
            plans.append({
                "key": str(p.get("key") or f"plan{i}")[:20],
                "label": str(p.get("label") or "方案")[:20],
                "price": float(p.get("price") or 0),
                "days": int(p.get("days") or 30),
                "period": str(p.get("period") or "")[:10],
                "features": [str(f)[:60] for f in (p.get("features") or [])][:8],
                "recommended": bool(p.get("recommended")),
            })
        out["plans"] = plans
    qr = dict(out.get("qr") or {})
    if "qrWechat" in raw:
        qr["wechat"] = str(raw["qrWechat"])[:300]
    if "qrAlipay" in raw:
        qr["alipay"] = str(raw["qrAlipay"])[:300]
    out["qr"] = qr
    if isinstance(raw.get("contact"), dict):
        out["contact"] = {**out["contact"],
                          **{k: str(v)[:120] for k, v in raw["contact"].items()
                             if k in ("wechat", "email", "note")}}
    if raw.get("note") is not None:
        out["note"] = str(raw["note"])[:300]
    return out


@router.put("/admin/settings/marketing")
def put_marketing(body: MarketingBody,
                  user: dict = Depends(security.require_perm("settings:general:update"))) -> dict:
    raw = body.model_dump(exclude_unset=True)
    marketing = _apply_marketing(_marketing(), raw)
    db.set_setting(MARKETING_KEY, marketing)
    db.audit(user["id"], "settings:marketing:update", f"{len(marketing['plans'])} 个方案")
    return {"marketing": marketing}


@router.post("/settings/general/logo")
def upload_logo(file: UploadFile,
                user: dict = Depends(security.require_perm("settings:general:update"))) -> dict:
    url = _store_upload(file, "logo")
    brand = brand_config()
    _drop_old_upload(brand["logo"])
    brand["logo"] = url
    db.set_setting(BRAND_KEY, brand)
    db.audit(user["id"], "settings:logo", url)
    return {"logo": url, "brand": brand}


@router.post("/settings/general/qrcode")
def upload_qrcode(file: UploadFile, kind: str = "wechat",
                 user: dict = Depends(security.require_perm("settings:general:update"))) -> dict:
    if kind not in ("wechat", "alipay"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "BAD_SYMBOL", "message": "收款码只支持 wechat/alipay"})
    url = _store_upload(file, f"qr-{kind}")
    marketing = _marketing()
    _drop_old_upload(marketing["qr"].get(kind))
    marketing["qr"][kind] = url
    db.set_setting(MARKETING_KEY, marketing)
    db.audit(user["id"], "settings:qrcode", f"{kind} -> {url}")
    return {"qr": marketing["qr"]}


@router.delete("/settings/general/image")
def clear_image(target: str,
                user: dict = Depends(security.require_perm("settings:general:update"))) -> dict:
    """清掉 Logo 或收款码：target=brand.logo / qr.wechat / qr.alipay"""
    if target == "brand.logo":
        brand = brand_config()
        _drop_old_upload(brand["logo"])
        brand["logo"] = ""
        db.set_setting(BRAND_KEY, brand)
        return _payload()
    match = re.match(r"^qr\.(wechat|alipay)$", target)
    if not match:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": "BAD_SYMBOL", "message": "target 只认 brand.logo / qr.wechat / qr.alipay"})
    marketing = _marketing()
    _drop_old_upload(marketing["qr"].get(match.group(1)))
    marketing["qr"][match.group(1)] = ""
    db.set_setting(MARKETING_KEY, marketing)
    return {"marketing": marketing}


@router.get("/settings/public")
def public_settings() -> dict:
    """登录页 / 欢迎页用，不校验身份"""
    brand = brand_config()
    marketing = _marketing()
    return {"brand": brand,
            "marketing": {"plans": marketing["plans"], "contact": marketing["contact"],
                          "note": marketing["note"]},
            "footerNote": brand["footer_note"], "icp": brand["icp"],
            "demoNote": "体验账号 demo / Demo@2026，管理员 admin / Biaoge@2026（本机库，密码登录后请改）"}
