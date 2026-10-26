"""把文档 2.1 路由表的权限码和 backend/app/permissions.py 的 ROUTE_PERMISSIONS 对齐比较。"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = Path(r"C:/Users/Administrator/Downloads/彪哥财经之英雄本色-产品功能拆解文档.md")
sys.path.insert(0, str(ROOT / "backend"))

from app.permissions import ROUTE_PERMISSIONS  # noqa: E402

text = SPEC.read_text(encoding="utf-8")
start = text.index("### 2.1 完整路由表")
end = text.index("### 2.2", start)
rows = []
for line in text[start:end].splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) != 5 or not cells[0].isdigit():
        continue
    path = cells[2].strip("`")
    perm = cells[4].strip("`")
    rows.append((path, "-" if perm in {"-", ""} else perm))

print(f"doc rows: {len(rows)} | ROUTE_PERMISSIONS: {len(ROUTE_PERMISSIONS)}")

dynamic = {p for p, _ in rows if ":" in p}
need = {p: perm for p, perm in rows if perm != "-" and ":" not in p}
missing = sorted(set(need) - set(ROUTE_PERMISSIONS))
extra = sorted(set(ROUTE_PERMISSIONS) - set(need))
mismatch = [(p, need[p], ROUTE_PERMISSIONS[p])
            for p in sorted(set(need) & set(ROUTE_PERMISSIONS)) if need[p] != ROUTE_PERMISSIONS[p]]
print("dynamic (继承父权限):", sorted(dynamic))
print("missing:", missing)
print("extra:", extra)
print("mismatch:", mismatch)
