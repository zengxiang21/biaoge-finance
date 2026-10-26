"""SQLite 连接、建表、种子数据"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from typing import Any

from . import config
from .permissions import ROLE_GRANTS

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  member_expire_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS role_permissions(
  role TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY(role, code)
);
CREATE TABLE IF NOT EXISTS revoked_tokens(
  jti TEXT PRIMARY KEY,
  user_id INTEGER,
  revoked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_watch_user ON watchlist_items(user_id);
CREATE TABLE IF NOT EXISTS snapshot_stocks(
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL, change_price REAL, change_percent REAL,
  open REAL, high REAL, low REAL, prev_close REAL,
  volume REAL, amount REAL, turnover_ratio REAL,
  pe REAL, pb REAL, mkt_cap REAL, nmc_cap REAL, ticktime TEXT,
  is_st INTEGER DEFAULT 0, limit_rate REAL,
  PRIMARY KEY(trade_date, symbol)
);
CREATE TABLE IF NOT EXISTS market_daily(
  trade_date TEXT PRIMARY KEY,
  total INTEGER, up INTEGER, down INTEGER, flat INTEGER,
  limit_up INTEGER, limit_down INTEGER, blown INTEGER,
  amount REAL, volume REAL,
  ma20_above_ratio REAL, new_high_count INTEGER, new_low_count INTEGER,
  amount_vs_prev REAL,
  dims TEXT, score REAL,
  built_at TEXT, source_note TEXT
);
CREATE TABLE IF NOT EXISTS amount_baseline(
  trade_date TEXT PRIMARY KEY,
  amount REAL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS board_daily(
  trade_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  change_percent REAL, stock_count INTEGER,
  amount REAL, leader_name TEXT, leader_change REAL,
  PRIMARY KEY(trade_date, kind, code)
);
CREATE TABLE IF NOT EXISTS limit_pool(
  trade_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'up',
  symbol TEXT NOT NULL,
  name TEXT, price REAL, change_percent REAL,
  lbc INTEGER, fbt TEXT, lbt TEXT, fund REAL, zb_count INTEGER,
  amount REAL, turnover REAL, sector TEXT, stat TEXT,
  PRIMARY KEY(trade_date, kind, symbol)
);
CREATE TABLE IF NOT EXISTS provider_health(
  provider TEXT NOT NULL,
  capability TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ok INTEGER, latency_ms REAL, http_status INTEGER,
  error TEXT, checked_at TEXT, hits INTEGER DEFAULT 0, fails INTEGER DEFAULT 0,
  PRIMARY KEY(provider, capability)
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_calls(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, purpose TEXT, model TEXT, engine TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER,
  latency_ms REAL, status TEXT, note TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS job_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL, status TEXT, trigger TEXT,
  started_at TEXT, finished_at TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT, target TEXT, created_at TEXT
);

/* ---- 日线缓存：策略扫描/回测靠它，避免每次跑都打新浪接口 ---- */
CREATE TABLE IF NOT EXISTS kline_cache(
  symbol TEXT NOT NULL, trade_date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume REAL, amount REAL,
  PRIMARY KEY(symbol, trade_date)
);
CREATE TABLE IF NOT EXISTS kline_meta(
  symbol TEXT PRIMARY KEY, refreshed_at TEXT, bars INTEGER, last_date TEXT
);

/* ---- 策略引擎 ---- */
CREATE TABLE IF NOT EXISTS strategy(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, code TEXT UNIQUE NOT NULL, name TEXT, description TEXT,
  strategy_type TEXT, strategy_type_label TEXT, asset_type TEXT DEFAULT 'stock',
  run_time_type TEXT DEFAULT 'any', direction TEXT DEFAULT 'long',
  params TEXT, universe TEXT, engine TEXT DEFAULT 'polars', code_text TEXT,
  is_system INTEGER DEFAULT 0, is_ai INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', composite TEXT,
  last_run_at TEXT, last_pick_count INTEGER,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS strategy_run(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER, user_id INTEGER, status TEXT,
  universe_count INTEGER, candidate_count INTEGER, pick_count INTEGER,
  elapsed_ms REAL, error_message TEXT, data_warnings TEXT, summary TEXT,
  started_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS strategy_pick(
  run_id INTEGER NOT NULL, symbol TEXT NOT NULL, name TEXT, score REAL,
  price REAL, pct_chg REAL, amount REAL, turnover REAL, volume_ratio REAL,
  signals TEXT, concepts TEXT, industry TEXT,
  PRIMARY KEY(run_id, symbol)
);

/* ---- 异常监控 ---- */
CREATE TABLE IF NOT EXISTS anomaly_rule(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, name TEXT, event_type TEXT, scope TEXT,
  params TEXT, enabled INTEGER DEFAULT 1, cooldown_min INTEGER DEFAULT 30,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS anomaly_event(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT, name TEXT, event_type TEXT, price REAL, change_percent REAL,
  volume_ratio REAL, net_amount REAL, params TEXT, rule_id INTEGER,
  trade_date TEXT, triggered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anomaly_time ON anomaly_event(triggered_at);

/* ---- 持仓管理与风控 ---- */
CREATE TABLE IF NOT EXISTS holdings_account(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, name TEXT, broker TEXT, initial_capital REAL,
  status TEXT DEFAULT 'active', created_at TEXT
);
CREATE TABLE IF NOT EXISTS holding_trade(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER, user_id INTEGER, symbol TEXT, name TEXT, side TEXT,
  price REAL, quantity REAL, fee REAL, trade_date TEXT, note TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS holding_rule(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, account_id INTEGER, rule_type TEXT, threshold REAL,
  params TEXT, enabled INTEGER DEFAULT 1, cooldown_min INTEGER DEFAULT 60,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS alert_trigger(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, rule_id INTEGER, account_id INTEGER, scope TEXT,
  triggered_at TEXT, detail TEXT, suppressed INTEGER DEFAULT 0,
  suppress_reason TEXT
);
CREATE TABLE IF NOT EXISTS notification(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, channel TEXT, title TEXT, body TEXT,
  status TEXT, reason TEXT, created_at TEXT, read_at TEXT
);

/* ---- 模拟交易 ---- */
CREATE TABLE IF NOT EXISTS sim_account(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, name TEXT, cash REAL, initial_capital REAL,
  status TEXT DEFAULT 'active', created_at TEXT
);
CREATE TABLE IF NOT EXISTS sim_order(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER, user_id INTEGER, symbol TEXT, name TEXT, side TEXT,
  price REAL, quantity REAL, status TEXT, filled_price REAL, filled_quantity REAL,
  amount REAL, fee REAL, reason TEXT, created_at TEXT, filled_at TEXT
);

/* ---- 每日复盘 / 反馈 / 资讯缓存 ---- */
CREATE TABLE IF NOT EXISTS review_report(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, trade_date TEXT, market TEXT,
  payload TEXT, markdown TEXT, score REAL, emailed INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS feedback(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, username TEXT, title TEXT, content TEXT, contact TEXT,
  status TEXT DEFAULT 'open', reply TEXT, created_at TEXT, replied_at TEXT
);
CREATE TABLE IF NOT EXISTS news_item(
  id TEXT PRIMARY KEY, source TEXT, title TEXT, summary TEXT, url TEXT,
  time TEXT, stocks TEXT, topic TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_time ON news_item(time);
CREATE TABLE IF NOT EXISTS board_fund_flow(
  trade_date TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL, name TEXT,
  change_percent REAL, net_amount REAL, in_amount REAL, out_amount REAL,
  net_ratio REAL, turnover REAL, leader_name TEXT, leader_change REAL,
  PRIMARY KEY(trade_date, kind, code)
);
CREATE TABLE IF NOT EXISTS stock_fund_flow(
  trade_date TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT, price REAL,
  change_percent REAL, net_amount REAL, in_amount REAL, out_amount REAL,
  net_ratio REAL, turnover REAL, amount REAL,
  PRIMARY KEY(trade_date, symbol)
);

/* ---- 事件（并购重组/调研/解禁/增减持）---- */
CREATE TABLE IF NOT EXISTS event_item(
  id TEXT PRIMARY KEY, event_type TEXT, symbol TEXT, name TEXT,
  title TEXT, summary TEXT, url TEXT, date TEXT, extra TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_date ON event_item(date);

/* ---- 指数成分 ---- */
CREATE TABLE IF NOT EXISTS index_constituent(
  index_code TEXT NOT NULL, trade_date TEXT NOT NULL, symbol TEXT NOT NULL,
  name TEXT, weight REAL, price REAL, change_percent REAL, amount REAL,
  PRIMARY KEY(index_code, trade_date, symbol)
);

/* ---- 宽基指数估值历史（乐咕乐股给的月度 PE/PB，抓一次就落库，不再反复打上游）---- */
CREATE TABLE IF NOT EXISTS index_valuation_history(
  index_code TEXT NOT NULL, trade_date TEXT NOT NULL, name TEXT, kind TEXT,
  close REAL, pe REAL, pb REAL, pe_equal REAL, pe_median REAL,
  updated_at TEXT,
  PRIMARY KEY(index_code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_ivh_date ON index_valuation_history(trade_date);

/* ---- 市场环境历史（六维 + 结论）---- */
CREATE TABLE IF NOT EXISTS market_env_history(
  trade_date TEXT PRIMARY KEY, score REAL, label TEXT,
  trend REAL, breadth REAL, activity REAL, seal REAL, moving_avg REAL, high_low REAL,
  amount REAL, limit_up INTEGER, note TEXT
);

/* ---- 板块成分映射（策略标签/板块轮动策略用）---- */
CREATE TABLE IF NOT EXISTS stock_board(
  symbol TEXT NOT NULL, kind TEXT NOT NULL, board_code TEXT NOT NULL, board_name TEXT,
  PRIMARY KEY(symbol, kind, board_code)
);
CREATE INDEX IF NOT EXISTS idx_board_symbol ON stock_board(symbol);
"""


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_conn: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = connect()
        return _conn


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    # 单连接被线程池共用，读也要上锁，否则并发请求会撞 sqlite3.InterfaceError
    with _lock:
        return db().execute(sql, params).fetchall()


def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    with _lock:
        return db().execute(sql, params).fetchone()


def execute(sql: str, params: tuple = ()) -> int:
    with _lock:
        cur = db().execute(sql, params)
        db().commit()
        return cur.lastrowid


def executemany(sql: str, rows: list[tuple]) -> int:
    """批量写：单连接被多线程共用，必须走这把锁，否则会互相吞掉语句"""
    if not rows:
        return 0
    with _lock:
        cur = db().execute("BEGIN IMMEDIATE")
        db().executemany(sql, rows)
        db().commit()
        return cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(rows)


def rows_of(sql: str, params: tuple = ()) -> list[tuple]:
    """只读批量取原始元组，比 sqlite3.Row 省内存，用于全市场日线这类大结果集"""
    with _lock:
        cur = db().cursor()
        cur.row_factory = None
        return list(cur.execute(sql, params))


def get_setting(key: str, default: Any = None) -> Any:
    row = query_one("SELECT value FROM settings WHERE key=?", (key,))
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return default


def set_setting(key: str, value: Any) -> None:
    execute(
        "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (key, json.dumps(value, ensure_ascii=False), now()),
    )


def audit(user_id: int | None, action: str, target: str = "") -> None:
    execute("INSERT INTO audit_logs(user_id,action,target,created_at) VALUES(?,?,?,?)",
            (user_id, action, target, now()))


def _ensure_columns(table: str, cols: dict[str, str]) -> None:
    """给老库补列：SCHEMA 里的 CREATE TABLE IF NOT EXISTS 不会改已存在的表"""
    have = {r["name"] for r in query(f"PRAGMA table_info({table})")}
    for name, decl in cols.items():
        if name not in have:
            execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def _migrate_limit_pool_kind() -> None:
    """涨停池要分涨停/炸板/跌停三池，老库主键只有 (trade_date,symbol)，重建一次。
    旧表迁完并核对过行数才删，对不上就留着叫 limit_pool_old。"""
    cols = list(query("PRAGMA table_info(limit_pool)"))
    pk = [r["name"] for r in cols if r["pk"]]
    if not cols or pk == ["trade_date", "kind", "symbol"]:
        return
    before = query_one("SELECT COUNT(*) c FROM limit_pool")["c"]
    execute("DROP TABLE IF EXISTS limit_pool_old")
    execute("ALTER TABLE limit_pool RENAME TO limit_pool_old")
    with _lock:
        c = db()
        c.executescript("CREATE TABLE IF NOT EXISTS limit_pool("
                        "trade_date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'up',"
                        "symbol TEXT NOT NULL, name TEXT, price REAL, change_percent REAL,"
                        "lbc INTEGER, fbt TEXT, lbt TEXT, fund REAL, zb_count INTEGER,"
                        "amount REAL, turnover REAL, sector TEXT,"
                        "PRIMARY KEY(trade_date, kind, symbol));")
        c.commit()
    execute("INSERT OR IGNORE INTO limit_pool(trade_date,kind,symbol,name,price,"
            "change_percent,lbc,fbt,lbt,fund,zb_count,amount,turnover,sector) "
            "SELECT trade_date,'up',symbol,name,price,change_percent,lbc,fbt,lbt,fund,"
            "zb_count,amount,turnover,sector FROM limit_pool_old")
    after = query_one("SELECT COUNT(*) c FROM limit_pool")["c"]
    if after >= before:
        execute("DROP TABLE limit_pool_old")
        print(f"[migrate] limit_pool 主键改为 (trade_date,kind,symbol)，迁走 {after} 行")
    else:
        print(f"[migrate] limit_pool 迁移后只有 {after}/{before} 行，旧表保留为 limit_pool_old")


def init_db() -> None:
    with _lock:
        c = db()
        c.executescript(SCHEMA)
        c.commit()

    _ensure_columns("market_daily", {"ma5_above_ratio": "REAL", "ma60_above_ratio": "REAL",
                                     "sample_total": "INTEGER"})
    # 第十二章额度/会员体系：老库补列
    _ensure_columns("users", {"phone": "TEXT", "token_quota": "INTEGER DEFAULT 0",
                              "token_used": "INTEGER DEFAULT 0", "member_plan": "TEXT",
                              "avatar": "TEXT", "remark": "TEXT"})
    _ensure_columns("strategy", {"strategy_type_label": "TEXT", "direction": "TEXT",
                                 "composite": "TEXT", "last_pick_count": "INTEGER"})
    _migrate_limit_pool_kind()
    # 涨停统计「11天7板」：梯队页要看几天几板，比连板数更能说明强度
    _ensure_columns("limit_pool", {"stat": "TEXT"})

    # 角色权限种子
    for role, codes in ROLE_GRANTS.items():
        for code in codes:
            execute("INSERT OR IGNORE INTO role_permissions(role,code) VALUES(?,?)", (role, code))

    # 内置账号：首次启动才建，密码写在启动日志里
    from .security import hash_password

    seeds = [
        ("admin", "彪哥", "admin", "Biaoge@2026"),
        ("demo", "体验用户", "user", "Demo@2026"),
    ]
    for username, display, role, pwd in seeds:
        if not query_one("SELECT id FROM users WHERE username=?", (username,)):
            execute(
                "INSERT INTO users(username,display_name,role,password_hash,created_at) "
                "VALUES(?,?,?,?,?)",
                (username, display, role, hash_password(pwd), now()),
            )
            print(f"[seed] 已创建账号 {username} / 密码 {pwd}（角色 {role}），请登录后修改")

    # 默认设置
    if get_setting("global_schedule") is None:
        set_setting("global_schedule", {
            "enabled": True,
            "daily_time": config.DAILY_REFRESH_TIME,
            "intraday_interval_min": 5,
            "tasks": ["quotes", "index", "breadth", "boards", "limit_pool"],
            "note": "每个交易日 15:35 自动刷新行情、板块、指数、涨停池快照",
        })
    if get_setting("data_sources") is None:
        set_setting("data_sources", {
            "sina": {"enabled": True, "priority": 1},
            "eastmoney": {"enabled": True, "priority": 2},
            "tencent": {"enabled": True, "priority": 3},
        })
    if get_setting("ai_engine") is None:
        set_setting("ai_engine", {
            "provider": "ollama",
            "base_url": config.OLLAMA_BASE_URL,
            "model": config.OLLAMA_DEFAULT_MODEL,
            "api_key": "",
            "temperature": 0.3,
            "max_tokens": 1200,
            "timeout_s": 180,
            "keep_alive": config.OLLAMA_KEEP_ALIVE,
            "enabled": True,
        })
    _seed_strategies()
    _seed_settings()


def _seed_strategies() -> None:
    """35 个内置策略（文档 3.5.5 / 3.5.5A）以 is_system=1 落库，用户可复制成自定义策略"""
    from .services.strategy_defs import BY_CODE, COMMON_FILTERS, RECOMMENDED_COMPOSITES

    for spec in BY_CODE.values():
        row = query_one("SELECT id FROM strategy WHERE code=?", (spec["code"],))
        params = json.dumps({"hard": spec["params"], "max_output": 100, "min_score": 55,
                             "filters": {c["key"]: c["default"] for c in COMMON_FILTERS},
                             "win_rate_doc": spec.get("win_rate_doc"),
                             "family": spec.get("family"),
                             "needs": spec.get("needs", ["kline"])}, ensure_ascii=False)
        if row:
            execute("UPDATE strategy SET name=?,description=?,strategy_type=?,run_time_type=?,"
                    "params=?,updated_at=? WHERE id=?",
                    (spec["name"], spec["desc"], spec["code"], spec.get("run_time_type", "any"),
                     params, now(), row["id"]))
            continue
        execute(
            "INSERT INTO strategy(code,name,description,strategy_type,strategy_type_label,"
            "run_time_type,direction,params,universe,engine,is_system,status,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (spec["code"], spec["name"], spec["desc"], spec["code"], spec["name"],
             spec.get("run_time_type", "any"), "long", params,
             json.dumps({"kind": "all_a_share"}, ensure_ascii=False), "builtin", 1, "active",
             now(), now()))
    for i, comp in enumerate(RECOMMENDED_COMPOSITES):
        code = f"composite_recommended_{i + 1}"
        if query_one("SELECT id FROM strategy WHERE code=?", (code,)):
            continue
        execute(
            "INSERT INTO strategy(code,name,description,strategy_type,run_time_type,direction,"
            "params,universe,composite,engine,is_system,status,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (code, comp["name"], comp["note"], "composite", "any", "long",
             json.dumps({"max_output": 100, "min_score": comp["min_score"]}, ensure_ascii=False),
             json.dumps({"kind": "all_a_share"}, ensure_ascii=False),
             json.dumps(comp["parts"], ensure_ascii=False), "builtin", 1, "active", now(), now()))


def _seed_settings() -> None:
    if get_setting("review_schedule") is None:
        set_setting("review_schedule", {
            "enabled": False, "time": "15:45", "weekday_only": True,
            "email_to": [], "note": "每日复盘自动生成并可邮件推送，默认关闭"})
    if get_setting("news_radar") is None:
        set_setting("news_radar", {
            "enabled": True, "interval_min": 5,
            "keywords": ["涨停", "重组", "并购", "回购", "增持", "减持", "解禁", "业绩预告",
                         "中标", "签订", "合同", "专利", "新药", "订单", "国资", "退市"],
            "exclude": ["停牌"], "min_importance": 1,
            "sources": ["eastmoney_fast", "sina_roll", "announcement"]})
    if get_setting("anomaly_rules") is None:
        set_setting("anomaly_rules", {
            "surge_pct": 5.0, "plunge_pct": -5.0, "limit_open": True,
            "volume_ratio_min": 3.0, "big_buy_amount": 50000000,
            "cooldown_min": 30, "noise_min_amount": 30000000})
    if get_setting("marketing_plans") is None:
        set_setting("marketing_plans", [
            {"key": "free", "name": "免费体验", "price": 0, "days": 0,
             "token_quota": 20000, "features": ["仪表盘", "自选股", "涨停梯队"], "hot": False},
            {"key": "month", "name": "月度会员", "price": 99, "days": 30,
             "token_quota": 500000, "features": ["全部看盘", "策略选股", "AI 诊断", "每日复盘"],
             "hot": True},
            {"key": "year", "name": "年度会员", "price": 799, "days": 365,
             "token_quota": 6000000,
             "features": ["全部看盘", "策略选股", "AI 诊断", "每日复盘", "持仓风控"], "hot": False}])
    if get_setting("site_brand") is None:
        set_setting("site_brand", {
            "name": "彪哥财经之英雄本色", "subtitle": "A 股看盘 · 策略选股 · AI 复盘",
            "logo": "", "icp": "", "footer_note":
                "数据来自新浪/东财/腾讯公开接口，仅供研究参考，不构成投资建议"})
    if get_setting("smtp") is None:
        set_setting("smtp", {"host": "smtp.qq.com", "port": 465, "use_ssl": True,
                             "user": "", "password": "", "from_mail": ""})
    if get_setting("ai_quality") is None:
        set_setting("ai_quality", {
            "max_tokens_per_call": 2000, "cache_ttl_min": 30,
            "block_purposes": [], "note": "AI 诊断结果按 30 分钟缓存，避免重复消耗本地 14B 算力"})
