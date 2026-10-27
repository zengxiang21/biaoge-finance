"""给 GitHub Pages 演示站生成静态 payload。

Pages 只能放静态文件，跑不了 FastAPI。但接口口径（估值分位、梯队、板块热度）
不该在前端用 TS 再抄一遍，所以这里把数据灌进一个临时库，直接调线上同一份
router / service，把返回结果原样写成静态 JSON。前端演示模式只是把 fetch
地址换掉，算法仍然是这份 Python。

两种模式：
  python scripts/export_demo_api.py          只出估值页（读仓库里的 data/valuation_history.json）
  python scripts/export_demo_api.py --live   先现抓一轮行情，再把白名单接口全导出

--live 依赖外部数据源，单个源挂了不能拖垮整站：每一步单独 try/except，
失败就跳过对应 JSON，最后打印一份「哪个接口抓到了什么」的清单当证据。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app import config  # noqa: E402

# 必须在 import db 之前改：db() 是懒连接，连的才是这个临时库，不会碰本机真库
config.DB_PATH = Path(tempfile.mkdtemp(prefix="demoapi-")) / "demo.db"
config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)   # main.py 要 mount 这个目录

from app import db, permissions  # noqa: E402
from app.routers import settings as settings_router  # noqa: E402
from app.services import valuation  # noqa: E402

SNAP = ROOT / "data" / "valuation_history.json"
OUT = ROOT / "frontend" / "public" / "demo-api"
LIVE = "--live" in sys.argv

# 时间预算（实测 2026-10-27 云端一轮：快照 214s + 板块成分 302s + 其余六步 <40s，
# 整轮 14 分钟）。放宽到 22 分钟当保险：宁可少出几个面板，也不能把 job 拖到 30 分钟
# 被砍 —— 那样 Pages 连上一版都发不出去。
START = time.monotonic()
DEADLINE = START + float(os.environ.get("DEMO_BUDGET_MIN", 22 if LIVE else 10_000)) * 60


def left() -> float:
    return DEADLINE - time.monotonic()


# 演示站白名单：(接口, 参数)。参数抄页面里 api.get 实际传的那一份，
# 前端用同一个 canon() 规则算文件名才能对上。只收免登录、不依赖本机 AI 的读接口。
LIVE_ENDPOINTS: list[tuple[str, dict]] = [
    ("/health", {}),
    ("/dashboard/overview", {}),
    ("/dashboard/ladder", {"full": True}),
    ("/dashboard/intraday", {}),
    ("/dashboard/daily", {}),
    ("/market-data/summary", {}),
    ("/market-data/breadth", {}),
    ("/market-data/rankings", {}),
    ("/market-data/boards/heat", {"kind": "industry", "limit": 40, "with_flow": True}),
    ("/market-data/boards/heat", {"kind": "concept", "limit": 40, "with_flow": True}),
    ("/market-data/boards/flow", {"kind": "industry", "limit": 60}),
    ("/market-data/boards/flow", {"kind": "concept", "limit": 60}),
    ("/market-data/boards", {"kind": "industry", "limit": 60}),
    ("/market-data/boards", {"kind": "concept", "limit": 60}),
    ("/global-market/index", {}),
    ("/global-market/commodity", {}),
    ("/info/news-flash", {"size": 80}),
    ("/info/news-radar", {}),
    ("/info/hot-search", {"num": 30}),
    ("/info/merger", {"days": 120, "limit": 300}),
    ("/info/fund-flow/market", {}),
    ("/info/fund-flow/sectors", {"kind": "industry", "limit": 60}),
    ("/info/fund-flow/stocks", {"direction": "in", "limit": 60}),
    ("/info/fund-flow/stocks", {"direction": "out", "limit": 60}),
    ("/market-env", {}),
    ("/market-env/history", {"days": 60}),
    ("/index/overview", {}),
    ("/index/components", {"index": "hs300"}),
    ("/index/components", {"index": "zz500"}),
    ("/index/components", {"index": "kc50"}),
    ("/academy/basics", {}),
    ("/academy/books", {}),
    ("/anomaly/summary", {}),
    ("/anomaly/events", {"limit": 300}),
    ("/anomaly/rules", {}),
    # 行情数据页默认看上证指数，个股类页面默认看贵州茅台；换标的会明确提示没预生成
    ("/market-data/quotes/realtime", {"symbols": "sh000001"}),
    ("/market-data/quotes/daily", {"symbol": "sh000001", "days": 120}),
    ("/market-data/minute", {"symbol": "sh000001"}),
    ("/market-data/quotes/realtime", {"symbols": "sh600519"}),
    ("/market-data/quotes/daily", {"symbol": "sh600519", "days": 120}),
    ("/market-data/minute", {"symbol": "sh600519"}),
    ("/data/fundamentals", {"symbol": "sh600519"}),
    ("/data/fundamentals/events", {"kind": "lockup", "days": 60, "limit": 120}),
    ("/data/fundamentals/events", {"kind": "survey", "days": 60, "limit": 120}),
    ("/data/fundamentals/events", {"kind": "holder_change", "days": 60, "limit": 120}),
    ("/finance/statements", {"symbol": "sh600519"}),
    ("/finance/indicators", {"symbol": "sh600519", "days": 250}),
    ("/stock-analysis/detail", {"symbol": "sh600519", "days": 120}),
    ("/stock-analysis/news", {"symbol": "sh600519"}),
]


def _val(v: object) -> str:
    if v is True:
        return "true"
    if v is False:
        return "false"
    return str(v)


def canon(url: str, params: dict | None = None) -> str:
    """把「接口 + 参数」压成稳定的 key：空值丢掉、布尔写成 true/false、按键排序。

    前端 demoFile() 用同一条规则算文件名，两边才不会各算各的。
    """
    path, _, query = url.partition("?")
    merged: dict[str, str] = {}
    for chunk in query.split("&"):
        if "=" in chunk:
            k, v = chunk.split("=", 1)
            if v:
                merged[k] = v
    for k, v in (params or {}).items():
        if v is None or v == "":
            continue
        merged[k] = _val(v)
    if not merged:
        return path.lstrip("/")
    return path.lstrip("/") + "?" + "&".join(f"{k}={merged[k]}" for k in sorted(merged))


def filename(key: str) -> str:
    head, _, query = key.partition("?")
    flat = re.sub(r"[^A-Za-z0-9._-]", "_", query.replace("&", "_").replace("=", "-"))
    return f"{head}.{flat}.json" if flat else f"{head}.json"


def write(rel: str, payload: object) -> int:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return p.stat().st_size


def ingest() -> list[str]:
    """现抓一轮：每步单独兜底，返回失败摘要（进 Actions 日志当「哪些源抓得动」的证据）"""
    from app.services import anomaly, events, info, kline, market, market_env
    from app.services import strategy_engine as eng

    admin = db.query_one("SELECT id FROM users ORDER BY id LIMIT 1")
    uid = admin["id"] if admin else None
    steps = [
        ("全市场收盘快照", lambda: market.build_snapshot(trigger="demo")),
        ("板块成分映射", lambda: eng.ensure_board_map()),
        # 市场环境六维要读日线缓存算均线，日线必须先灌好，所以这条排在 kline 之后
        ("日线缓存", lambda: kline.refresh(workers=8, limit=300)),
        ("市场环境历史", lambda: market_env.backfill(days=60)),
        ("快讯", lambda: info.refresh_news(80)),
        ("并购重组", lambda: events.refresh(6)),
        # 盘中异动扫描只在交易时段跑，演示站用收盘口径按当天快照生成一轮
        ("异动事件（收盘口径）", lambda: anomaly.scan_close_basis(uid)),
    ]
    failures: list[str] = []
    for name, fn in steps:
        if left() < 120:
            failures.append(f"{name}: 时间预算用完，跳过")
            print(f"[ingest] {name}: SKIP，预算只剩 {left():.0f}s", flush=True)
            continue
        t0 = time.time()
        try:
            out = fn()
            print(f"[ingest] {name}: ok {time.time() - t0:.0f}s {str(out)[:120]}", flush=True)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
            print(f"[ingest] {name}: FAIL {type(exc).__name__}: {exc}", flush=True)
    return failures


async def _ask(app, path: str, query: str, token: str) -> tuple[int, bytes]:
    """不启服务，直接按 ASGI 协议调 app：省掉 httpx 依赖，序列化路径和线上完全一致"""
    scope = {"type": "http", "asgi": {"version": "3.0", "http_version": "1.1"},
             "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": "/" + path, "raw_path": ("/" + path).encode(),
             "query_string": query.encode(), "root_path": "",
             "headers": [(b"host", b"localhost"),
                         (b"authorization", f"Bearer {token}".encode()),
                         (b"accept", b"application/json")],
             "client": ("127.0.0.1", 0), "server": ("localhost", 80)}
    box: dict = {"status": 0, "body": b""}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(msg):
        if msg["type"] == "http.response.start":
            box["status"] = msg["status"]
        elif msg["type"] == "http.response.body":
            box["body"] += msg.get("body", b"")

    await app(scope, receive, send)
    return box["status"], box["body"]


def export_live(failures: list[str]) -> list[dict]:
    from app import security
    from app.main import app

    row = db.query_one("SELECT id, role FROM users WHERE username='admin'")
    token = security.make_pair(row["id"], row["role"])["accessToken"]

    entries: list[dict] = []
    for url, params in LIVE_ENDPOINTS:
        key = canon(url, params)
        path = key.partition("?")[0]
        query = urlencode({k: _val(v) for k, v in params.items() if v not in (None, "")})
        t0 = time.time()
        rec = {"key": key, "ms": 0, "bytes": 0, "status": 0}
        if left() < 30:
            rec["error"] = "时间预算用完，未导出"
            entries.append(rec)
            print(f"[export] {key}: SKIP，预算只剩 {left():.0f}s", flush=True)
            continue
        try:
            status, body = asyncio.run(_ask(app, f"api/{path}", query, token))
        except Exception as exc:  # noqa: BLE001
            rec.update(ms=int((time.time() - t0) * 1000), error=f"{type(exc).__name__}: {exc}"[:160])
            entries.append(rec)
            print(f"[export] {key}: EXCEPTION {rec['error']}", flush=True)
            continue
        rec["ms"] = int((time.time() - t0) * 1000)
        if status != 200:
            rec.update(status=status, error=body.decode("utf-8", "replace")[:160])
            entries.append(rec)
            print(f"[export] {key}: HTTP {status} {rec['error']}", flush=True)
            continue
        rec.update(status=200, file=filename(key), bytes=write(filename(key), json.loads(body)))
        entries.append(rec)

    ok = [e for e in entries if e["status"] == 200]
    print(f"\n{'接口':<50}{'kB':>7}{'ms':>8}")
    for e in ok:
        print(f"{e['key']:<50}{e['bytes'] / 1024:>7.0f}{e['ms']:>8}")
    print(f"实时接口导出 {len(ok)}/{len(entries)}，合计 {sum(e['bytes'] for e in ok) / 1024:.0f} kB")
    for e in entries:
        if e["status"] != 200:
            print(f"  未出：{e['key']} -> {e.get('error', '')[:90]}")
    if failures:
        print("抓取失败的环节：" + " | ".join(failures))
    return entries


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

    failures = ingest() if LIVE else []

    kb: dict[str, float] = {}
    manifest: list[dict] = []
    kb["overview"] = write("index/valuation/overview.json", valuation.overview()) / 1024
    manifest.append({"key": canon("/index/valuation/overview", {}),
                     "file": "index/valuation/overview.json", "bytes": int(kb["overview"] * 1024)})
    n = 0
    for code in snap["objects"]:
        if not valuation.BY_CODE.get(code):
            continue
        # 参数要和估值面板默认发出的那份对上：years=0 就是「全部历史」
        key = canon("/index/valuation", {"code": code, "years": 0, "refresh": "false"})
        size = write(filename(key), valuation.panel(code))
        kb[f"panel.{code}"] = size / 1024
        manifest.append({"key": key, "file": filename(key), "bytes": size})
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
        "demoNote": "这是 GitHub Pages 静态演示站：数据由 Actions 定时抓取后冻结，"
                    "写操作和 AI 分析要连本机后端",
    }) / 1024
    for extra in ("auth/context", "settings/public"):
        manifest.append({"key": extra, "file": f"{extra}.json", "bytes": int(kb[extra] * 1024)})

    if LIVE:
        manifest += export_live(failures)

    write("_index.json", {"generatedAt": db.now(), "live": LIVE,
                          "ingestFailures": failures,
                          "entries": [{k: v for k, v in e.items() if k != "error"}
                                      for e in manifest]})

    total = sum(e.get("bytes", 0) for e in manifest) / 1024
    print(f"{n} 个估值面板 + {len(manifest) - n} 份静态 payload，合计 {total:.0f} kB -> {OUT}")
    if LIVE:
        print(f"本轮用时 {time.monotonic() - START:.0f}s")
    print("最大三个：", sorted(((e["file"], e.get("bytes", 0)) for e in manifest),
                              key=lambda kv: -kv[1])[:3])
    return 0


if __name__ == "__main__":
    sys.exit(main())
