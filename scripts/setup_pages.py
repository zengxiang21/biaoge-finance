"""开 Pages（Actions 部署模式）+ 需要时把仓库转公开。

令牌从 ~/.git-credentials 现读，不打印、不写进仓库。
用法：
  python scripts/setup_pages.py            # 只看状态
  python scripts/setup_pages.py --enable   # 建 Pages（build_type=workflow）
  python scripts/setup_pages.py --public   # 转公开 + 建 Pages
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com/repos/zengxiang21/biaoge-finance"
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
    if "--public" in sys.argv:
        report("转公开", *call("PATCH", API, {"private": False}))
    if "--enable" in sys.argv or "--public" in sys.argv:
        code, d = pages()
        if code == 201 or code == 200:
            report("已有 Pages", code, d)
            code, d = call("PUT", API + "/pages", {"build_type": "workflow"})
        else:
            code, d = call("POST", API + "/pages", {"build_type": "workflow"})
        report("Pages=workflow", code, d)
    code, d = call("GET")
    report("仓库", code, d)
    code, d = pages()
    report("Pages", code, d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
