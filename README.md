# 彪哥财经之英雄本色 · 本地版

A 股看盘 / 复盘 / 策略 / 持仓 / 模拟交易一体化工作台。按
`彪哥财经之英雄本色-产品功能拆解文档.md` 的 46 条路由逐条实现，界面与交互对齐原站
`https://124.223.215.49/`。行情全部走公开数据源，AI 分析走本机 Ollama，数据只落在本地 SQLite，
不上传任何第三方。

## 一、启动（推荐：双击 .bat）

| 脚本 | 作用 |
|------|------|
| `启动全部.bat` | 起后端 + 前端，开浏览器到 `http://127.0.0.1:5173/` |
| `启动后端.bat` | 只起后端 API（`127.0.0.1:8750`） |
| `启动前端.bat` | 只起 Vite 开发服务器（`127.0.0.1:5173`） |
| `停止服务.bat` | 按端口关掉 8750 / 5173 上还在监听的进程 |
| `初始化环境.bat` | 新建 `.venv`、装后端依赖、装前端 node_modules |

登录账号：`admin` / `Biaoge@2026`（管理员，能进管理工作台）。注册页可开普通用户账号，
普通用户看不到管理菜单。

## 二、手动启动（.bat 不能用时）

```bat
:: 后端（在项目根目录执行）
set PYTHONIOENCODING=utf-8
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8750 --app-dir backend

:: 前端
cd frontend && npm run dev
```

后端没用 `--reload`，改完 `backend/app/**.py` 必须重启进程才生效。

## 三、技术栈与规模

| 层 | 选型 | 现状 |
|----|------|------|
| 前端 | React 19 + TypeScript 5.7 + Vite 6 + Tailwind CSS 4 + zustand + axios + react-router 7 | 45 个页面组件、62 个 ts/tsx 源文件 |
| 后端 | FastAPI + uvicorn + SQLite（标准库 sqlite3，无 ORM）+ APScheduler | 17 个 router 模块、144 个接口 |
| 数据源 | 新浪财经（主）、东方财富、腾讯、CBOE（恐慌指数 VIX）、乐咕乐股（宽基指数估值历史）、百度/微博热搜；`providers/registry.py` 做主备路由并记 `provider_health` | 5 个 provider 模块、33 项能力 |
| AI | 本机 Ollama，OpenAI 兼容协议，默认 `qwen2.5:14b` @ `127.0.0.1:11434`，`keep_alive=30s` 用完即卸载 | 管理工作台-AI 设置页可改模型与地址 |
| 数据库 | `backend/data/biaoge.db`（38 张表） | 首次启动自动建表 |

端口固定 `127.0.0.1`：后端 8750，前端 5173，前端把 `/api` 代理到后端，所以浏览器只访问 5173。

## 四、功能覆盖（对应文档 2.1 路由表）

| 模块 | 路由 | 说明 |
|------|------|------|
| 登录/注册/欢迎 | `/login` `/register` `/` | JWT 双 token，`/auth/me` 返回权限码表驱动菜单 |
| 看盘核心 | `/dashboard` `/watchlist` `/stock-analysis` `/stock-analysis/:symbol` `/limit-ladder` | 大盘雷达、板块热度与龙头、涨停梯队（炸板/封单） |
| 投研分析 | `/concept-analysis` `/industry-analysis` `/global-index` `/oil-gold` `/merger-restructuring` | 概念/行业资金流、全球指数 + 恐慌指数 VIX + 大盘情绪折线、商品、并购重组线索 |
| 策略 | `/strategy` `/strategy/:strategyId` | 35 条内置策略、扫描、回测、多策略叠加、AI 生成策略 |
| 复盘 | `/review` | 每日复盘报告，含情绪与主线 |
| 学院 | `/academy/basics` `/academy/books` | 基础课与书单 |
| 资讯 | `/info/news-flash` `/info/hot-search` `/info/fund-flow` | 快讯流、热榜、个股/板块资金流 |
| 异常监控 | `/anomaly` `/anomaly/rules` | 实时异动事件 + 规则编辑，定时扫描 |
| 持仓与模拟 | `/holdings` `/holdings/alerts` `/simulation/account` `/simulation/orders` | 持仓收益与风控提醒、模拟买卖与订单流水 |
| 数据 | `/data/quotes` `/data/fundamentals` `/finance/statements` `/finance/indicators` | 行情快照、基础数据、三大报表、财务指标 + K 线/均线/布林 |
| 市场环境 | `/market-env` `/market-env/history` | 六维情绪雷达 + 历史回算序列（支持缺口回填） |
| 指数 | `/index` `/index/components` | 指数概览与成分股；宽基指数长历史估值区间（PE/PB 分位、便宜/合理/偏贵三档带）、高估低估判定；窗口可点全部/10/5/3 年或直接手填起止日期；另给「相对沪深300 的 PE 比价」一行，分开看「比自己历史便宜」和「绝对贵不贵」；覆盖 12 个宽基 + 沪/深/创业板/科创板四条全市场口径 |
| 管理与设置 | `/settings/data-sources` `/admin/workbench/*` | 数据源矩阵、监控、学员、反馈、通用/AI 设置 |
| 系统 | `/system/permissions` `/system/audit-logs` | 角色权限矩阵、审计日志 |
| 兜底 | `/403` `*` | 无权限页与 404 |

46/46 路由在前端 `frontend/src/App.tsx` 全部注册；权限码与文档表逐条一致
（`backend/app/permissions.py`，动态路由 `/stock-analysis/:symbol`、`/strategy/:strategyId`
继承各自父级权限码）。自检：

```bat
.venv\Scripts\python.exe scripts\check_perms.py
```

## 五、定时任务

`backend/app/scheduler.py`，间隔与时间点都能在「管理设置-通用」里改，运行结果写 `job_runs`：

| 任务 | 默认 | 内容 |
|------|------|------|
| 收盘快照 | 周一至周五 15:35 | 全市场快照、涨停池、板块热度与资金流、抽样均线 |
| 收盘快照新鲜度自检 | 开机 1 分钟后首查，之后每 10 分钟 | 当天快照该重刷就自动重刷：盘中超过 10 分钟没落库、15:35 那次错过（库里没当天）、盘后结算窗里超过 90 分钟没更新，都补；19:00 以后不再自动重刷（收盘数据已定型），每天最多 3 次 |
| 盘中刷新 | 间隔触发 | 指数与行情增量 |
| 异常扫描 | 间隔触发 | 按规则产出 `anomaly_event` |
| 快讯抓取 | 间隔触发 | 多源轮询入 `news_item` |
| 每日复盘 | 到点触发 | 生成 `review_report` |
| 持仓风控 | 间隔触发 | 触发 `holding_rule` 提醒 |
| 宽基估值历史归档 | 周一至周五 18:40 | 从乐咕乐股补 `index_valuation_history`（16 个对象：12 宽基 + 沪/深/创业板/科创板全市场）；上游按 IP 限流，整轮 1 分多钟，抓一次落库、页面只读库；单个对象失败不影响其余，缺值不会被 NULL 冲掉 |
| 宽基估值补试 | 上一轮失败后 25 分钟 | 乐咕整站 504 时不等第二天：自动排一个一次性任务再跑一轮，最多 3 次；次数记在 `settings.valuation_retry`，成功即归零，用尽后写一条 `skip` 到 `job_runs` 并交回 18:40 定时任务 |

手动补数：仪表盘或数据源矩阵页的“刷新”按钮，走同一套 `services/market.py`。

前端页面自己会拉新，不用守着点刷新：仪表盘 60 秒、全球指数 60 秒、自选股 30 秒、实时异常 30 秒、快讯默认 5 分钟（可选 1/5/15 分）、
指数页的估值区间面板 5 分钟（点「重建估值历史」后自动改成 15 秒跟进度）、
侧边栏状态 120 秒、管理工作台-全局监控 30 秒；标签页切回前台时立刻补拉一次。浏览器自己会把后台标签页的定时器压到
1 分钟一次，所以长时间挂着也不会打爆上游接口。

仪表盘顶部的时间读数也是活的：每 5 秒重算一次「多久前」，并显示「现在 HH:MM:SS · 数据 X 秒前 · 约 N 秒后再拉」。
收盘之后快照已定型，那一格改成显示「收盘快照 HH:MM」而不是越来越长的「X 分钟前」。

## 六、GitHub 与云端更新（后续更新不依赖这台机器）

仓库 `https://github.com/zengxiang21/biaoge-finance`（私有）。两个 workflow：

| workflow | 触发 | 干什么 |
|----------|------|--------|
| `CI` | 每次 push / PR | 云端干净环境跑 `compileall backend/app` + 导入 `app.main` 冒烟 + 前端 `typecheck` / `build` |
| `估值历史云端刷新` | 周一至周五 18:40 与 22:40（北京时间），也能手动 dispatch | 在云端跑 `scripts/export_valuation_snapshot.py`，抓 16 个宽基/全市场估值序列并回写 `data/valuation_history.json`。两个时间槽是因为 GitHub 的 `schedule` 会整轮跳过（10-27 的 18:40 那槽至今没响过），多一槽兜底；脚本与上一版快照做并集，重复跑不会把已有对象跑丢 |

本机读云端快照的三条路，自动依次尝试：

1. 乐咕能通就照旧直接抓；
2. 整轮失败时（`_run_valuation`）自动改读 `data/valuation_history.json` 并写一条 `valuation_sync` 到 `job_runs`；
3. 开机发现 16 个对象没齐，也用这份快照补一次。

仓库是私有的，raw 地址读不到，所以 `_github_token()` 按「设置里的 `github_token` > 环境变量 `GITHUB_TOKEN`/`GH_TOKEN` > 本机 `~/.git-credentials` 里 github.com 那行」取令牌改走 API。令牌只留在这台机器上，不进仓库。
指数页估值一览表那里有「从云端补数」按钮，点一下就是第 2 条路。

推送要先 `-c credential.helper=` 清空再挂一个内联 helper：系统级的 `helper-selector` 排在 `store` 前面，既取不到凭证又可能弹 GUI 把命令挂死。令牌从 `~/.git-credentials` 里 github.com 那行现取，不进命令行历史也不打印。网络这条 2026-10-27 实测直连可用（走 `127.0.0.1:7897` 反而 `TLS connect error: unexpected eof`）；直连不通时再加 `-c http.proxy=http://127.0.0.1:7897 -c https.proxy=同`。

## 七、验收自检

```bat
:: 后端语法
.venv\Scripts\python.exe -m compileall -q backend\app

:: 前端类型检查 + 构建（tsc --noEmit 开了 noUnusedLocals/noUnusedParameters）
cd frontend && npm run typecheck && npm run build

:: 接口冒烟（只读，不写用户数据）
.venv\Scripts\python.exe scripts\smoke_phase_h.py
```

## 八、目录

```
backend/app/         config.py db.py permissions.py security.py scheduler.py main.py
  routers/           按域拆分的 17 个 APIRouter
  services/          业务编排：行情快照、策略引擎、AI、复盘、模拟盘、异动…
  providers/         sina / eastmoney / tencent / external + registry 主备路由
backend/data/        biaoge.db、jwt.secret、uploads/（都在 .gitignore 里，不上传）
data/                valuation_history.json — Actions 回写的云端估值快照
frontend/src/        pages/ components/ lib/ store/ App.tsx
scripts/             check_perms.py、export_valuation_snapshot.py（Actions 用）与只读冒烟脚本
.github/workflows/   ci.yml、valuation-snapshot.yml
```

## 九、常见问题

| 现象 | 处理 |
|------|------|
| `.bat` 里中文显示成乱码 | 这些脚本按 GBK(代码页 936) 保存，别用 UTF-8 重存；cmd 用 `chcp` 改过默认页也会花屏 |
| `pip` / `venv` / `ensurepip` 坏了（清理工具削过） | 退路：`python -m pip install --target=libs -r backend\requirements.txt`，再用 `set PYTHONPATH=%CD%\libs` 启动 |
| 8750 被占用 | `停止服务.bat`，或先 `netstat -ano` 配合 `findstr :8750` 拿 PID，再 `taskkill /PID <pid> /F` |
| 改了后端代码没生效 | 没开 `--reload`，重启 uvicorn 进程 |
| AI 无结果 | 先确认 Ollama 在跑：`curl http://127.0.0.1:11434/api/tags`，再看模型名与 AI 设置页一致 |
| 板块/历史某天为空 | 非交易日或上游当日未返回；用市场环境历史页的回填补，缺口日的涨停池无法追溯，留空是正常的 |
| 内存吃紧（16GB 机器） | AI 用 `keep_alive=30s` 自动卸载；快照任务有互斥锁，同一时间只跑一个 |
