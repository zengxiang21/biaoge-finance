"""Phase H 页面依赖接口的只读冒烟：逐个确认有数据、字段名对得上"""
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8750/api"


def token():
    pwd = os.getenv("ADMIN_PASSWORD")
    if not pwd:
        sys.exit("先 set ADMIN_PASSWORD=你的管理员口令（新库的那条打在启动后端.log 里）")
    req = urllib.request.Request(BASE + "/auth/login",
        data=json.dumps({"username": "admin", "password": pwd}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["accessToken"]


def get(path, tok):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + tok})
    return json.load(urllib.request.urlopen(req, timeout=120))


def count(d):
    out = {}
    for k, v in d.items():
        if isinstance(v, list):
            out[k] = len(v)
    return out


def main():
    tok = token()
    paths = [
        "/global-market/index",
        "/global-market/commodity",
        "/info/merger?days=90&limit=300",
        "/data/fundamentals?symbol=sh600519",
        "/data/fundamentals/events?kind=lockup&days=60&limit=120",
        "/data/fundamentals/events?kind=survey&days=30&limit=120",
        "/data/fundamentals/events?kind=holder_change&days=30&limit=120",
        "/finance/statements?symbol=600519",
        "/finance/indicators?symbol=sh600519&days=250",
        "/market-env",
        "/market-env/history?days=90",
        "/index/overview",
        "/index/components?index=hs300",
        "/index/components?index=sz50",
        "/index/components?index=zz500",
        "/index/components?index=kc50",
        "/index/components?index=bse50",
        "/index/components?index=sse180",
        "/academy/basics",
        "/academy/books",
        "/market-data/boards/heat?kind=concept&limit=40&with_flow=true",
        "/market-data/boards/heat?kind=industry&limit=40&with_flow=true",
        "/market-data/boards/flow?kind=concept&limit=60",
    ]
    for p in paths:
        try:
            d = get(p, tok)
            print(f"{p:70s} OK  {json.dumps(count(d), ensure_ascii=False)}")
            if isinstance(d, dict) and d.get("errors"):
                print("      errors:", json.dumps(d["errors"], ensure_ascii=False)[:200])
        except Exception as exc:
            print(f"{p:70s} FAIL {exc}")

    heat = get("/market-data/boards/heat?kind=concept&limit=10", tok)
    row = (heat.get("rows") or [{}])[0]
    code, name = row.get("code"), row.get("name")
    d = get("/market-data/boards/members?kind=concept&code=%s&name=%s&limit=120" % (urllib.parse.quote(str(code)), urllib.parse.quote(str(name))), tok)
    print(f"{'/market-data/boards/members (示例)':70s} OK  {json.dumps(count(d), ensure_ascii=False)}")


if __name__ == "__main__":
    main()
