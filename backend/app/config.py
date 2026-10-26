"""彪哥财经之英雄本色 — 后端配置"""
from __future__ import annotations

import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
PROJECT_DIR = BASE_DIR.parent                              # 项目根
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
# 通用设置页上传的 Logo / 收款码
UPLOAD_DIR = DATA_DIR / "uploads"

DB_PATH = DATA_DIR / "biaoge.db"
API_TIMEOUT = float(12.0)

HOST = "127.0.0.1"
PORT = 8750
ACCESS_TOKEN_TTL_MIN = 12 * 60
REFRESH_TOKEN_TTL_DAYS = 14


def _secret_file() -> Path:
    p = DATA_DIR / "jwt.secret"
    if not p.exists():
        p.write_text(secrets.token_hex(32), encoding="ascii")
    return p


JWT_SECRET = _secret_file().read_text(encoding="ascii").strip()
JWT_ALG = "HS256"

# AI 引擎默认指向本机 Ollama（OpenAI 兼容协议），可在 AI 设置页覆盖
OLLAMA_BASE_URL = "http://127.0.0.1:11434"
OLLAMA_DEFAULT_MODEL = "qwen2.5:14b"
# 16G 内存机器：AI 调用结束立刻卸载，避免和 QuantMind 抢内存
OLLAMA_KEEP_ALIVE = "30s"

TZ = "Asia/Shanghai"
SNAPSHOT_PAGES = 60          # 新浪每页 100 条，最多翻 60 页
SNAPSHOT_SAMPLE_K_LINES = 300  # 抽成交额前 N 只算均线/新高新低
DAILY_REFRESH_TIME = "15:35"

# 云端兜底：GitHub Actions 每天定时抓宽基估值历史并回写 data/valuation_history.json，
# 本机打不通乐咕（整站 504）时读这份快照续数据；换仓库只改这一行。
GITHUB_SNAPSHOT_URL = ("https://raw.githubusercontent.com/zengxiang21/biaoge-finance/"
                       "main/data/valuation_history.json")
