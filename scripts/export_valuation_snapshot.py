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
    snap["refresh"] = {"ok": out.get("ok"), "objects": out.get("objects"),
                       "errors": out.get("errors") or []}
    dest = ROOT / "data" / "valuation_history.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    rows = sum(len(v["rows"]) for v in snap["objects"].values())
    print(f'objects={len(snap["objects"])}/{len(valuation.UNIVERSE)} rows={rows} '
          f'ok={out.get("ok")} failed={len(snap["refresh"]["errors"])}')
    for line in snap["refresh"]["errors"][:5]:
        print("  -", line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
