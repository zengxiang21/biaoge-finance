"""全市场日线缓存建库/刷新脚本：python backend/scripts/build_kline_cache.py"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.services import kline, market  # noqa: E402

db.init_db()
print("snapshot date", market.live_quote_date(), flush=True)
t0 = time.time()
print("done", kline.refresh(workers=8), "elapsed", round(time.time() - t0, 1), flush=True)
print("meta", kline.meta(), flush=True)
