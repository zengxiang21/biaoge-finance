"""给 GitHub Pages 演示站生成静态 payload。

Pages 只能放静态文件，跑不了 FastAPI。但估值的口径（分位、区间带、判定、
相对沪深300 比价）不该在前端用 TS 再抄一遍，所以这里把 Actions 抓回来的
data/valuation_history.json 灌进一个临时库，直接调用线上同一份
valuation.panel() / overview()，把返回结果原样写成静态 JSON。
前端演示模式只是把 fetch 地址换掉，算法仍然是这份 Python。

用法：python scripts/export_demo_api.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app import config  # noqa: E402

# 必须在 import db 之前改：db() 是懒连接，连的才是这个临时库，不会碰本机真库
config.DB_PATH = Path(tempfile.mkdtemp(prefix="demoapi-")) / "demo.db"

from app import db, permissions  # noqa: E402
from app.routers import settings as settings_router  # noqa: E402
from app.services import valuation  # noqa: E402

SNAP = ROOT / "data" / "valuation_history.json"
OUT = ROOT / "frontend" / "public" / "demo-api"


def write(rel: str, payload: object) -> int:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return p.stat().st_size


def main() -> int:
    if not SNAP.exists():
        sys.exit(f"没有 {SNAP}，先在 Actions 里跑一轮估值归档")
    snap = json.loads(SNAP.read_text(encoding="utf-8"))
    db.init_db()
    for code, obj in snap["objects"].items():
        valuation._upsert(code, obj["name"], obj["kind"], obj["rows"])

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    kb = {}
    kb["overview"] = write("index/valuation/overview.json", valuation.overview()) / 1024
    n = 0
    for code in snap["objects"]:
        if not valuation.BY_CODE.get(code):
            continue
        size = write(f"index/valuation/panel.{code}.json", valuation.panel(code))
        kb[f"panel.{code}"] = size / 1024
        n += 1

    perms = sorted(set(permissions.ALL_PERMISSIONS) | set(permissions.ROUTE_PERMISSIONS.values()))
    menu = [{"key": g["key"], "label": g["label"],
             "items": [dict(i, granted=True) for i in g["items"]]} for g in permissions.NAV_GROUPS]
    kb["auth/context"] = write("auth/context.json", {
        "user": {"id": 0, "username": "demo", "displayName": "演示访客", "role": "admin",
                 "roleLabel": "演示只读", "email": None, "status": "active",
                 "memberExpireAt": None, "createdAt": db.now(), "lastLoginAt": None},
        "permissions": perms, "routePermissions": permissions.ROUTE_PERMISSIONS,
        "menuTree": menu, "brand": settings_router.brand_config(),
        "quota": {"aiUnlimited": False, "note": "演示站没有后端，AI 与写操作不可用"},
    }) / 1024
    kb["settings/public"] = write("settings/public.json", {
        "brand": settings_router.brand_config(),
        "marketing": {"plans": [], "contact": "", "note": ""},
        "footerNote": "", "icp": "",
        "demoNote": "这是 GitHub Pages 静态演示站：没有后端，只有估值页有真实数据",
    }) / 1024

    total = sum(kb.values())
    print(f"{n} 个指数的估值面板 + overview + context，合计 {total:.0f} kB -> {OUT}")
    print("最大三个：", sorted(kb.items(), key=lambda kv: -kv[1])[:3])
    return 0


if __name__ == "__main__":
    sys.exit(main())
