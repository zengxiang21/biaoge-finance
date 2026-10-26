"""通知渠道：站内消息 + SMTP 邮件（拆解文档 3.13 告警通知体系）"""
from __future__ import annotations

import smtplib
from email.header import Header
from email.mime.text import MIMEText

from .. import db

DEFAULT_SMTP = {"host": "smtp.qq.com", "port": 465, "use_ssl": True,
                "user": "", "password": "", "from_mail": ""}


def smtp_config() -> dict:
    """库里可能留着建表时塞的空壳配置（含 ssl/from_name 老字段名），空值一律回落到默认"""
    raw = db.get_setting("smtp", {}) or {}
    cfg = dict(DEFAULT_SMTP)
    for key, value in raw.items():
        if key == "ssl":
            cfg["use_ssl"] = bool(value)
        elif key in cfg and value not in (None, ""):
            cfg[key] = value
    return cfg


def email_ready(cfg: dict | None = None) -> bool:
    cfg = cfg or smtp_config()
    return bool(cfg.get("user") and cfg.get("password") and cfg.get("from_mail"))


def send_email(subject: str, body: str, to: list[str] | None = None,
               html: bool = False) -> dict:
    """返回 {ok, status, reason}。status 对齐文档：success / no_channel"""
    cfg = smtp_config()
    recipients = [x for x in (to or []) if x]
    if not recipients:
        recipients = [cfg["user"]]
    if not email_ready(cfg):
        return {"ok": False, "status": "no_channel", "reason": "未配置 SMTP 发件邮箱与授权码"}
    msg = MIMEText(body, "html" if html else "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = cfg["from_mail"]
    msg["To"] = ", ".join(recipients)
    try:
        cls = smtplib.SMTP_SSL if cfg.get("use_ssl") else smtplib.SMTP
        with cls(cfg["host"], int(cfg["port"] or 465), timeout=20) as s:
            if not cfg.get("use_ssl"):
                s.starttls()
            s.login(cfg["user"], cfg["password"])
            s.sendmail(cfg["from_mail"], recipients, msg.as_string())
        return {"ok": True, "status": "success", "reason": f"已发送到 {len(recipients)} 个收件人"}
    except Exception as exc:  # SMTP 的异常类型太杂，统一转成可读状态
        return {"ok": False, "status": "failed", "reason": f"{type(exc).__name__}: {exc}"}


def notify(user_id: int, title: str, body: str, *, email_to: list[str] | None = None,
           channel: str = "both") -> dict:
    """写站内通知；channel=both 时再尝试邮件。邮件失败只记状态，不影响业务"""
    inapp_id = db.execute(
        "INSERT INTO notification(user_id,channel,title,body,status,reason,created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (user_id, "inapp", title, body, "success", "", db.now()))
    out = {"inapp_id": inapp_id, "email": None}
    if channel == "inapp":
        return out
    if not email_ready():
        db.execute("INSERT INTO notification(user_id,channel,title,body,status,reason,created_at) "
                   "VALUES(?,?,?,?,?,?,?)",
                   (user_id, "email", title, body, "no_channel", "未配置 SMTP，只留站内提醒", db.now()))
        return out
    res = send_email(title, body, email_to)
    db.execute("INSERT INTO notification(user_id,channel,title,body,status,reason,created_at) "
               "VALUES(?,?,?,?,?,?,?)",
               (user_id, "email", title, body, res["status"], res["reason"], db.now()))
    out["email"] = res
    return out
