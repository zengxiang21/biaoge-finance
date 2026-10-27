"""查最近一次 CI 运行的结论。令牌从 ~/.git-credentials 读，不打印。"""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

URL = "https://api.github.com/repos/zengxiang21/biaoge-finance/actions/runs?per_page=3"
TOKEN = re.search(r"x-access-token:([^@]+)@",
                  (Path.home() / ".git-credentials").read_text(encoding="utf-8")).group(1)


def fetch(proxy: str | None) -> dict:
    req = urllib.request.Request(URL, headers={
        "Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json"})
    if proxy:
        h = urllib.request.HTTPSHandler()
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"https": proxy}), h)
        return json.loads(opener.open(req, timeout=25).read())
    return json.loads(urllib.request.urlopen(req, timeout=25).read())


def show(d: dict) -> None:
    for r in d["workflow_runs"][:3]:
        print(f"{r['name']}: {r['status']} / {r.get('conclusion')} "
              f"({r['head_commit']['id'][:7]}, {r['event']})")


for label, proxy in (("直连", None), ("代理", "http://127.0.0.1:7897")):
    try:
        show(fetch(proxy))
        print(f"[{label} 可用]")
        break
    except Exception as exc:
        print(f"[{label} 失败] {type(exc).__name__}: {exc}")
