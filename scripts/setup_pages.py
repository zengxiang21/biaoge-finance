"""开 Pages（Actions 部署模式）+ 重跑发布 + 验收线上地址。

令牌从 ~/.git-credentials 现读，不打印、不写进仓库。
注意：fine-grained 令牌改不了仓库可见性（GitHub 不给这个能力），
转公开必须网页上手动点；其余都能跑。

用法：
  python scripts/setup_pages.py            # 只看状态
  python scripts/setup_pages.py --enable   # 建/改 Pages 为 Actions 部署模式
  python scripts/setup_pages.py --rerun    # 触发一次 Pages 工作流
  python scripts/setup_pages.py --verify   # 拉线上地址并请求一次
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com/repos/zengxiang21/biaoge-finance"
SITE = "https://zengxiang21.github.io/biaoge-finance/"
TOKEN = re.search(r"x-access-token:([^@]+)@",
                  (Path.home() / ".git-credentials").read_text(encoding="utf-8")).group(1)


def call(method: str, url: str = API, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        **({"Content-Type": "application/json"} if body else {})},
        data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def pages() -> tuple[int, dict]:
    return call("GET", API + "/pages")


def report(tag: str, code: int, d: dict) -> None:
    keep = {k: d.get(k) for k in
            ("private", "html_url", "build_type", "status", "source") if k in d}
    print(f"{tag}: HTTP {code} {json.dumps(keep, ensure_ascii=False)}")


def main() -> int:
    if "--public" in sys.argv:  # fine-grained 令牌多半会被拒，留着给 classic 令牌用
        report("转公开", *call("PATCH", API, {"private": False}))
    if "--enable" in sys.argv:
        code, d = pages()
        method = "PUT" if code in (200, 201) else "POST"
        report(f"Pages=workflow({method})", *call(method, API + "/pages", {"build_type": "workflow"}))
    if "--rerun" in sys.argv:
        report("已触发 Pages 工作流", *call(
            "POST", API + "/actions/workflows/deploy-pages.yml/dispatches",
            {"ref": "main"}))
    if "--verify" in sys.argv:
        try:
            with urllib.request.urlopen(urllib.request.Request(SITE, headers={
                    "User-Agent": "demo-check"}), timeout=30) as r:
                body = r.read(4000).decode("utf-8", "replace")
            print(f"线上 HTTP {r.status}，{SITE}")
            print("标题：", re.search(r"<title>(.*?)</title>", body).group(1)
                  if "<title>" in body else "（还没渲染出 index.html）")
        except Exception as exc:
            print(f"线上还打不开：{type(exc).__name__} {exc}")
    code, d = call("GET")
    report("仓库", code, d)
    code, d = pages()
    report("Pages", code, d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
