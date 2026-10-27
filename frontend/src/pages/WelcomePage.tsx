import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Chip } from "../components/ui";

const VALUE_PROPS = [
  { title: "全景看盘", text: "指数强弱、涨跌广度、市场情绪、板块热度与个股榜单一屏掌握" },
  { title: "选股有据", text: "内置策略引擎 + AI 深度诊断研报，选股逻辑可描述、可回溯" },
  { title: "边学边练", text: "投资学堂看懂主力资金逻辑，模拟交易建立铁的交易纪律" },
  { title: "全平台适配", text: "手机 / 平板 / 电脑全系统可用，随时随地看盘" },
];

export default function WelcomePage() {
  const [health, setHealth] = useState<{ ok: boolean; snapshotDate: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth({ ok: !!d.ok, snapshotDate: d.snapshotDate ?? null }))
      .catch(() => setHealth({ ok: false, snapshotDate: null }));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white px-6 py-12 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-600 text-xl font-bold text-white">曾</span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white">曾老师</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">用真实工具，建立铁的交易纪律</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
              登录
            </Link>
            <Link to="/register"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              注册
            </Link>
          </div>
        </header>

        <section className="mb-10 grid gap-4 sm:grid-cols-2">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="rounded-2xl border border-slate-200 bg-white/70 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">{v.title}</h2>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{v.text}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="mb-3 text-sm font-semibold">本轮已实现（P0 核心底座）</h2>
          <ul className="mb-4 grid gap-1.5 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <li>· 登录 / 注册 / JWT 双 Token 无感续期 / 三层权限守卫</li>
            <li>· 仪表盘：核心指数、涨跌分布、六维情绪雷达、涨停梯队</li>
            <li>· 板块热度、四类个股榜单、上证指数分时</li>
            <li>· 自选股：增删 + 实时行情，实时失败降级到收盘快照</li>
            <li>· 行情数据：日线 K 线、均线布林、枢轴压力支撑、个股搜索</li>
            <li>· 数据源矩阵：新浪 / 东财 / 腾讯 主备路由 + 健康探测</li>
            <li>· 全局调度：交易日 15:35 自动刷新（APScheduler）</li>
            <li>· AI 设置：接本机 Ollama，个股诊断与目标价推演接口</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={health?.ok ? "emerald" : "rose"}>
              后端 {health === null ? "探测中" : health.ok ? "正常" : "未启动"}
            </Chip>
            <Chip tone="slate">最近收盘快照 {health?.snapshotDate ?? "未建"}</Chip>
            <Chip tone="amber">数据为公开行情，仅供研究</Chip>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-slate-400">
          本工具不构成投资建议；AI 输出仅供参考，风险自负。
        </footer>
      </div>
    </div>
  );
}
