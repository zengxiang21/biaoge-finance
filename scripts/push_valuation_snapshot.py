"""把本机 valuation 数据与 origin/main 上的云端快照做并集，再推回去

GitHub Actions 每天也会回写 data/valuation_history.json，两边都会改这一个文件，
所以先拉云端、再并本机、最后一次性提交，避免 rebase 时把对方那一侧的对象冲掉。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
DEST = ROOT / "data" / "valuation_history.json"


def run(*cmd: str, check: bool = True, env: dict | None = None) -> str:
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env)
    out = (p.stdout or "") + (p.stderr or "")
    if check and p.returncode != 0:
        print("命令失败:", " ".join(cmd), "\n", out[-800:])
        raise SystemExit(1)
    return out.strip()


# 系统级 credential.helper=helper-selector 排在 store 前面，既取不到凭证还可能弹 GUI 把命令挂死，
# 所以先清空 helper 列表再内联挂一个；令牌从 ~/.git-credentials 现取，不写进命令行
AUTH = ["-c", "credential.helper=", "-c",
        'credential.helper=!f(){ echo "username=x-access-token"; echo "password=$GITHUB_TOKEN"; };f']
PROXY = ["-c", "http.proxy=http://127.0.0.1:7897", "-c", "https.proxy=http://127.0.0.1:7897"]
# 这台机器没有全局 user.name/user.email，rebase 重放提交时缺了它会把改动停在索引里
ID = ["-c", "user.name=zengxiang21", "-c", "user.email=zengxiang21@users.noreply.github.com"]


def net_git(*args: str) -> str:
    """这台机器直连和走代理都会一阵一阵地断，两种各试一次"""
    import os
    line = next((l for l in Path.home().joinpath(".git-credentials").read_text(encoding="utf-8")
                 .splitlines() if "github.com" in l), "")
    token = line.split("://", 1)[-1].split("@github.com", 1)[0].split(":", 1)[-1]
    env = {**os.environ, "GITHUB_TOKEN": token, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo",
           "GIT_EDITOR": "true"}
    for extra in ([], PROXY):
        out = run("git", *extra, *AUTH, *ID, *args, check=False, env=env)
        if "fatal:" not in out and "error:" not in out:
            return out
        print("这一趟不通，换另一种再试:", out[-200:])
    return out


def main() -> int:
    from app import db
    from app.services import valuation

    print(net_git("fetch", "origin", "main")[-300:])
    remote = run("git", "show", "origin/main:data/valuation_history.json", check=False)
    if not remote.startswith("{"):
        print("云端还没有快照，跳过合并")
        base: dict = {"objects": {}}
    else:
        base = json.loads(remote)

    # 本机这一侧从数据库导，不读工作区那份文件：文件可能正好是云端刚回写的
    local = valuation.export_snapshot()
    merged = dict(base.get("objects") or {})
    gained = {c: v for c, v in (local.get("objects") or {}).items() if c not in merged}
    merged.update(local.get("objects") or {})
    # 同一对象两边都有：取行数多的那份，谁抓得全用谁的
    for code, val in (local.get("objects") or {}).items():
        if len(val.get("rows") or []) < len(merged[code].get("rows") or []):
            merged[code] = base["objects"][code]
    snap = {"generatedAt": local.get("generatedAt"), "objects": merged,
            "refresh": local.get("refresh") or base.get("refresh") or {},
            "mergedFrom": "cloud + local"}
    snap["generatedAt"] = db.now()
    DEST.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    rows = sum(len(v["rows"]) for v in merged.values())
    print(f"云端 {len(base.get('objects') or {})} 个 / 本机 {len(local.get('objects') or {})} 个 "
          f"-> 并集 {len(merged)} 个，rows={rows}，本机独有 {list(gained) or '无'}")

    if run("git", "status", "--porcelain", "data/valuation_history.json") == "":
        print("并集和云端一致，不用提交")
    else:
        run("git", "add", "data/valuation_history.json")
        run("git", *ID, "commit", "-m",
            f"chore(data): 云端快照与本机归档并集（{len(merged)} 个对象 / {rows} 行）")
        print("已提交并集")
    # 并集本来就是从 origin/main 的内容算出来的，冲突时留自己这份不会丢云端的行
    print(net_git("rebase", "-X", "theirs", "origin/main")[-500:])
    print(net_git("push", "origin", "main")[-500:])
    print(run("git", "log", "--oneline", "-4"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
