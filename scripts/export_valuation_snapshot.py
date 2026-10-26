"""GitHub Actions 用：在云端抓一轮宽基估值历史并导出 data/valuation_history.json

本机打不通乐咕（整站 504）时，后端 `valuation.sync_from_github()` 会从仓库的
raw 地址读这份快照补数据，所以估值区间不再依赖这台机器一直开着。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import db                      # noqa: E402
from app.services import valuation      # noqa: E402


def main() -> int:
    db.init_db()
    out = valuation.refresh_all("github-actions")
    snap = valuation.export_snapshot()

    # 乐咕整站偶尔只回一部分（504 是零散的），别让一轮残缺把上一轮的对象丢掉
    dest = ROOT / "data" / "valuation_history.json"
    old: dict = {}
    if dest.exists():
        try:
            old = (json.loads(dest.read_text(encoding="utf-8")).get("objects") or {})
        except (ValueError, OSError) as exc:
            print("上一份快照读不了，忽略:", type(exc).__name__)
    objects = dict(old)
    objects.update(snap["objects"])
    dropped = [c for c in old if c not in snap["objects"]]
    snap["objects"] = objects
    snap["refresh"] = {"ok": out.get("ok"), "objects": out.get("objects"),
                       "errors": out.get("errors") or []}
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    rows = sum(len(v["rows"]) for v in objects.values())
    print(f'objects={len(objects)}/{len(valuation.UNIVERSE)} rows={rows} '
          f'本轮抓取 ok={out.get("ok")} failed={len(snap["refresh"]["errors"])}'
          + (f'（沿用上轮 {", ".join(dropped)}）' if dropped else ""))
    for line in snap["refresh"]["errors"][:5]:
        print("  -", line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
