"""APScheduler 定时任务：每日 15:35 全量刷新 + 盘中增量"""
from __future__ import annotations

from datetime import datetime, timedelta, time as dtime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from . import config, db
from .providers import registry
from .providers.base import ProviderError
from .services import market

scheduler: BackgroundScheduler | None = None
DAILY_ID = "daily_snapshot"
INTRADAY_ID = "intraday_snapshot"
ANOMALY_ID = "anomaly_scan"
NEWS_ID = "news_flash_pull"
REVIEW_ID = "daily_review"
HOLDING_ID = "holding_risk_scan"
CATCHUP_ID = "snapshot_catchup"
VALUATION_ID = "valuation_refresh"
VALUATION_RETRY_ID = "valuation_retry"
VALUATION_RETRY_AFTER_MIN = 25
VALUATION_RETRY_MAX = 3

# 监控看板要把 job id 显示成中文（定时任务用的 id 和运行记录用的 id 都收进来）
JOB_LABELS = {
    "daily_snapshot": "每日收盘快照",
    "snapshot_catchup": "收盘快照新鲜度自检",
    "intraday_snapshot": "盘中增量刷新",
    "news_flash_pull": "快讯抓取",
    "holding_risk_scan": "持仓风控体检",
    "kline_refresh": "日线缓存刷新",
    "board_map": "板块成分映射",
    "anomaly_scan": "盘中异动扫描",
    "news_pull": "快讯抓取",
    "daily_review": "每日复盘",
    "holding_risk": "持仓风控体检",
    "merger_scan": "并购重组事件扫描",
    "market_env": "市场环境六维归档",
    "valuation_refresh": "宽基估值历史归档",
    "valuation_retry": "宽基估值补试",
    "valuation_sync": "宽基估值云端快照兜底",
}


def _log(job: str, status: str, trigger: str, detail: str = "") -> None:
    """落运行记录：started_at/finished_at 一起补上，监控页按时间窗聚合才有数据"""
    stamp = db.now()
    db.execute("INSERT INTO job_runs(job,status,trigger,started_at,finished_at,detail) "
               "VALUES(?,?,?,?,?,?)", (job, status, trigger, stamp, stamp, detail[:400]))


def start() -> BackgroundScheduler:
    global scheduler
    if scheduler is None:
        scheduler = BackgroundScheduler(timezone=config.TZ)
        scheduler.start()
    apply_settings()
    return scheduler


def _run_daily(trigger: str = "cron") -> None:
    try:
        result = market.build_snapshot(trigger=trigger)
        _log("daily_snapshot", "ok", trigger, str(result))
    except Exception as exc:  # noqa: BLE001
        _log("daily_snapshot", "error", trigger, str(exc))
        return
    # 快照落库后补日线缓存和板块成分，策略扫描才有当天数据
    from .services import kline, strategy_engine as eng
    try:
        st = kline.refresh(workers=8)
        _log("kline_refresh", "ok" if not st.get("error") else "error", trigger, str(st))
    except Exception as exc:  # noqa: BLE001
        _log("kline_refresh", "error", trigger, str(exc))
    try:
        eng.ensure_board_map()
    except Exception as exc:  # noqa: BLE001
        _log("board_map", "error", trigger, str(exc))
    # 市场环境历史页要连续序列，快照落库后立刻归档当天六维
    from .services import market_env
    try:
        _log("market_env", "ok", trigger, f"归档 {market_env.sync_history()} 天")
    except Exception as exc:  # noqa: BLE001
        _log("market_env", "error", trigger, str(exc))


def stale_snapshot(now: datetime | None = None) -> dict | None:
    """当天全市场快照该重刷了就返回 {"date","reason"}，否则 None。
    三种情形：盘中数据过期（>10 分钟）；15:35 那次错过（库里没当天）；盘后结算窗里没再落库（>90 分钟）。
    19:00 之后不再自动重刷：收盘数据已定型，整晚翻 56 页接口没有意义，界面按「收盘快照 HH:MM」显示。"""
    now = now or datetime.now()
    phase = market.market_phase(now)
    if not phase["trading"]:
        cfg = db.get_setting("global_schedule", {}) or {}
        hh, mm = str(cfg.get("daily_time", config.DAILY_REFRESH_TIME)).split(":")[:2]
        if now.time() < dtime(int(hh), int(mm)):
            return None
    date = registry.trade_date_hint()
    if not date or date != now.strftime("%Y%m%d"):
        return None          # 周末/节假日：上游给的不是今天
    row = db.query_one("SELECT built_at FROM market_daily WHERE trade_date=?", (date,))
    if not row:
        return {"date": date, "reason": "库里没有当天收盘快照，补跑"}
    age = None
    if row["built_at"]:
        try:
            built = datetime.strptime(str(row["built_at"]), "%Y-%m-%d %H:%M:%S")
            age = int((now - built).total_seconds() // 60)
        except ValueError:
            age = None
    limit = 10 if phase["trading"] else (90 if now.time() < dtime(19, 0) else None)
    if limit is None:
        return None
    if age is None or age > limit:
        return {"date": date,
                "reason": f"当天快照已 {age if age is not None else '未知'} 分钟没更新（阈值 {limit} 分钟），重刷"}
    return None


def _run_catchup() -> None:
    need = stale_snapshot()
    if not need:
        return
    date, reason = need["date"], need["reason"]
    # 上游整天坏掉时别整晚反复打接口：每天最多自动重刷 3 次，之后就要人手点了
    used = db.query_one(
        "SELECT COUNT(*) AS c FROM job_runs WHERE job='daily_snapshot' AND trigger='catchup' "
        "AND started_at>=?", (f"{datetime.now():%Y-%m-%d} 00:00:00",))
    if (used["c"] if used else 0) >= 3:
        _log("snapshot_catchup", "skipped", "interval", f"{date}：{reason}，但今日自动重刷已用满 3 次")
        return
    _log("snapshot_catchup", "ok", "interval", f"{date}：{reason}")
    _run_daily(trigger="catchup")


def _run_intraday() -> None:
    phase = market.market_phase()
    if not phase["trading"]:
        return
    _run_daily()


def _scan_user() -> int | None:
    """后台扫描只能代表一个账号跑：用最早注册的用户，自选股范围的规则才有意义"""
    row = db.query_one("SELECT id FROM users ORDER BY id LIMIT 1")
    return row["id"] if row else None


def _run_anomaly() -> None:
    from .services import anomaly
    try:
        out = anomaly.scan("cron", _scan_user())
        if out.get("new_events"):
            _log("anomaly_scan", "ok", "cron",
                 f"新增异动 {out['new_events']} 条，扫描 {out.get('scanned')} 只")
    except Exception as exc:  # noqa: BLE001
        _log("anomaly_scan", "error", "cron", str(exc))


def _run_news() -> None:
    from .services import info
    try:
        n = info.refresh_news(80)
        _log("news_pull", "ok", "cron", f"抓取快讯 {n} 条")
    except Exception as exc:  # noqa: BLE001
        _log("news_pull", "error", "cron", str(exc))
    # 并购重组事件页靠公告流+快讯积累，跟着快讯任务一起扫最省接口
    from .services import events
    try:
        _log("merger_scan", "ok", "cron", str(events.refresh(6)))
    except Exception as exc:  # noqa: BLE001
        _log("merger_scan", "error", "cron", str(exc))


def _run_review() -> None:
    from .services import review
    try:
        out = review.run_scheduled()
        _log("daily_review", "ok" if out.get("ok") else "skipped", "cron", str(out))
    except Exception as exc:  # noqa: BLE001
        _log("daily_review", "error", "cron", str(exc))


def _run_holding_risk() -> None:
    from .services import holdings
    ids = [r["user_id"] for r in db.query(
        "SELECT DISTINCT user_id FROM holding_rule WHERE enabled=1")]
    hits = 0
    try:
        for uid in ids:
            hits += holdings.scan(uid).get("hits", 0)
        _log("holding_risk", "ok", "cron", f"体检 {len(ids)} 个账号，触发 {hits} 条")
    except Exception as exc:  # noqa: BLE001
        _log("holding_risk", "error", "cron", str(exc))


def _run_valuation(trigger: str = "cron") -> None:
    """宽基估值历史每天补一次：乐咕的序列按日更新当月那一个点，跑一轮约一分钟"""
    from .services import valuation
    try:
        out = valuation.refresh_all(trigger)
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "errors": [f"{type(exc).__name__}: {exc}"]}
    _log("valuation_refresh", "ok" if out.get("ok") else "error", trigger, str(out))
    if not out.get("ok"):
        # 乐咕挂了也别空着：改读 GitHub Actions 每天回写的云端估值快照
        try:
            sync = valuation.sync_from_github()
        except Exception as exc:  # noqa: BLE001
            sync = {"ok": False, "message": f"{type(exc).__name__}: {exc}"}
        _log("valuation_sync", "ok" if sync.get("ok") else "error", trigger,
             str(sync.get("message")))
    _valuation_retry(out)


def _valuation_retry(out: dict) -> None:
    """乐咕整站 504 时别等第二天：25 分钟后再试一轮，最多 3 次"""
    sched = scheduler
    if sched is None:
        return
    state = db.get_setting("valuation_retry", {}) or {}
    count = int(state.get("count") or 0)
    if out.get("ok"):
        if count:
            db.set_setting("valuation_retry", {"count": 0, "at": db.now()})
        return
    if count >= VALUATION_RETRY_MAX:
        _log("valuation_refresh", "skip", "retry",
             f"已补试 {count} 次仍失败，等下一个 18:40 定时任务")
        return
    count += 1
    db.set_setting("valuation_retry", {"count": count, "at": db.now(),
                                       "errors": (out.get("errors") or [])[:3]})
    try:
        # run_date 用无时区的本地时间，和这个文件里其它一次性任务保持一致
        sched.add_job(_run_valuation, args=["retry"],
                      trigger=DateTrigger(run_date=datetime.now()
                                          + timedelta(minutes=VALUATION_RETRY_AFTER_MIN)),
                      id=VALUATION_RETRY_ID, name="宽基估值补试", replace_existing=True,
                      misfire_grace_time=3600, max_instances=1)
    except Exception as exc:  # noqa: BLE001
        _log("valuation_refresh", "error", "retry", f"排补试任务失败: {type(exc).__name__}: {exc}")


def valuation_rebuild() -> None:
    """页面「重建估值历史」按钮走的后台线程入口：和定时任务同一套逻辑，失败后同样自动补试"""
    _run_valuation("manual")


def apply_settings() -> dict:
    cfg = db.get_setting("global_schedule", {}) or {}
    sched = scheduler
    if sched is None:
        return {"ok": False, "message": "调度器未启动"}
    for job_id in (DAILY_ID, INTRADAY_ID, ANOMALY_ID, NEWS_ID, REVIEW_ID, HOLDING_ID, CATCHUP_ID,
                   VALUATION_ID):
        if sched.get_job(job_id):
            sched.remove_job(job_id)
    if not cfg.get("enabled", True):
        return {"ok": True, "running": False, "message": "全局调度已关闭"}

    hh, mm = str(cfg.get("daily_time", config.DAILY_REFRESH_TIME)).split(":")
    sched.add_job(_run_daily, CronTrigger(day_of_week="mon-fri", hour=int(hh), minute=int(mm),
                                          timezone=config.TZ), id=DAILY_ID,
                  name="每日收盘快照", replace_existing=True, misfire_grace_time=3600)

    # 开机一小时后才错过收盘点的情况靠这个自检补：起来 1 分钟先查一次，之后每 10 分钟查
    sched.add_job(_run_catchup, "interval", minutes=10, id=CATCHUP_ID,
                  name="收盘快照新鲜度自检", replace_existing=True, max_instances=1,
                  start_date=datetime.now() + timedelta(minutes=1))

    interval = int(cfg.get("intraday_interval_min", 5) or 0)
    if interval > 0:
        sched.add_job(_run_intraday, "interval", minutes=interval, id=INTRADAY_ID,
                      name="盘中增量刷新", replace_existing=True)

    # 盘中异动扫描每 30 秒一次；非交易时段 _scan 内部会直接返回，不产生请求
    sec = int(cfg.get("anomaly_scan_sec", 30) or 0)
    if sec > 0:
        sched.add_job(_run_anomaly, "interval", seconds=sec, id=ANOMALY_ID,
                      name="盘中异动扫描", replace_existing=True, max_instances=1)

    news_min = int(cfg.get("news_pull_min", 5) or 0)
    if news_min > 0:
        sched.add_job(_run_news, "interval", minutes=news_min, id=NEWS_ID,
                      name="快讯抓取", replace_existing=True, max_instances=1)

    # 复盘时间由 /reviews/schedule 自己管，enabled 关掉时就不挂
    rcfg = db.get_setting("review_schedule", {}) or {}
    if rcfg.get("enabled"):
        rh, rm = str(rcfg.get("time") or "15:45").split(":")[:2]
        dow = "mon-fri" if rcfg.get("weekday_only", True) else "*"
        sched.add_job(_run_review, CronTrigger(day_of_week=dow, hour=int(rh), minute=int(rm),
                                               timezone=config.TZ), id=REVIEW_ID,
                      name="每日复盘", replace_existing=True, misfire_grace_time=1800)

    hold_min = int(cfg.get("holding_scan_min", 10) or 0)
    if hold_min > 0:
        sched.add_job(_run_holding_risk, "interval", minutes=hold_min, id=HOLDING_ID,
                      name="持仓风控体检", replace_existing=True, max_instances=1)

    # 估值历史是月度序列，一天一次就够；错开收盘快照和复盘，18:40 走
    sched.add_job(_run_valuation, CronTrigger(day_of_week="mon-fri", hour=18, minute=40,
                                              timezone=config.TZ), id=VALUATION_ID,
                  name="宽基估值历史归档", replace_existing=True, misfire_grace_time=3600,
                  max_instances=1)

    jobs = [{"id": j.id, "name": j.name, "nextRun": j.next_run_time.strftime("%Y-%m-%d %H:%M:%S")
             if j.next_run_time else None} for j in sched.get_jobs()]
    return {"ok": True, "running": True, "jobs": jobs, "daily_time": f"{hh}:{mm}",
            "intraday_interval_min": interval, "anomaly_scan_sec": sec,
            "holding_scan_min": hold_min, "review_enabled": bool(rcfg.get("enabled"))}


def status() -> dict:
    cfg = db.get_setting("global_schedule", {}) or {}
    jobs = []
    if scheduler:
        for j in scheduler.get_jobs():
            jobs.append({"id": j.id, "name": j.name,
                         "nextRun": j.next_run_time.strftime("%Y-%m-%d %H:%M:%S") if j.next_run_time else None})
    runs = [{"job": r["job"], "label": JOB_LABELS.get(r["job"], r["job"]),
             "status": r["status"], "trigger": r["trigger"], "startedAt": r["started_at"],
             "finishedAt": r["finished_at"], "detail": r["detail"]}
            for r in db.query(
                "SELECT job,status,trigger,started_at,finished_at,detail FROM job_runs "
                "ORDER BY id DESC LIMIT 10")]
    return {"enabled": bool(cfg.get("enabled")), "dailyTime": cfg.get("daily_time"),
            "intradayIntervalMin": cfg.get("intraday_interval_min"), "tasks": cfg.get("tasks"),
            "note": cfg.get("note"), "jobs": jobs, "recentRuns": runs,
            "jobLabels": JOB_LABELS,
            "now": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "clock": dtime().strftime("%H:%M")}


def recent_health() -> dict:
    try:
        date = registry.trade_date_hint()
        registry.index_quotes()
        registry.limit_pools(date)
    except ProviderError as exc:
        return {"ok": False, "error": exc.message}
    return {"ok": True, "matrix": registry.matrix()}
