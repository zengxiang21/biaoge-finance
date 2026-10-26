import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { AcademyBasicsResult } from "../lib/types";
import {
  Chip, EmptyState, Panel, Skeleton, cn,
} from "../components/ui";

export default function AcademyBasicsPage() {
  const [data, setData] = useState<AcademyBasicsResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string>("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get<AcademyBasicsResult>("/academy/basics");
      setData(r);
      setActive((cur) => cur || r.modules[0]?.id || "");
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const mod = data?.modules.find((m) => m.id === active) ?? data?.modules[0] ?? null;

  return (
    <div className="space-y-4">
      <Panel
        title="投资学堂 · 看盘基础"
        subtitle={data
          ? `${data.modules.length} 个模块 · ${data.note}`
          : error ?? "正在读取讲义…"}
        right={(
          <Link to="/academy/books"
            className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            推荐书籍
          </Link>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : (
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {(data?.readingPath ?? []).map((s) => (
              <li key={s.step}
                className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  <span className="nums mr-1 text-slate-400">第 {s.step} 步</span>{s.title}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{s.goal}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <Panel title="模块" subtitle={data ? `${data.modules.length} 讲` : ""}>
          {busy && !data ? <Skeleton className="h-40 w-full" /> : (
            <nav className="space-y-1">
              {(data?.modules ?? []).map((m, i) => (
                <button key={m.id} type="button" onClick={() => setActive(m.id)}
                  className={cn("w-full rounded-lg px-2.5 py-2 text-left text-xs transition",
                    mod?.id === m.id
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  <p className="font-semibold">
                    <span className={cn("nums mr-1.5", mod?.id === m.id ? "opacity-70" : "text-slate-400")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {m.title}
                  </p>
                  <p className={cn("mt-0.5 leading-snug", mod?.id === m.id ? "opacity-80" : "text-slate-400")}>
                    {m.subtitle}
                  </p>
                </button>
              ))}
            </nav>
          )}
        </Panel>

        {busy && !data ? <Skeleton className="h-72 w-full" /> : !mod ? (
          <Panel title="讲义"><EmptyState text="没有讲义内容" hint={error ?? "后端 academy 服务未返回模块"} /></Panel>
        ) : (
          <div className="space-y-4">
            <Panel title={mod.title} subtitle={mod.subtitle}>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{mod.summary}</p>

              <div className="mt-3 space-y-3">
                {mod.sections.map((s) => (
                  <section key={s.h}>
                    <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">{s.h}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{s.body}</p>
                  </section>
                ))}
              </div>

              {mod.formula && (
                <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <p className="text-xs font-semibold text-sky-800 dark:text-sky-200">核心公式</p>
                  <p className="nums mt-1 text-sm font-medium text-sky-900 dark:text-sky-100">{mod.formula}</p>
                  {mod.formulaExample && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-sky-800/90 dark:text-sky-200/90">
                      {mod.formulaExample}
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="要点" subtitle={`${mod.keys.length} 条，可直接对照盘面逐条打勾`}>
                <ul className="space-y-1.5">
                  {mod.keys.map((k) => (
                    <li key={k} className="flex gap-2 text-[13px] leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                      <span className="min-w-0 text-slate-600 dark:text-slate-300">{k}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="常见误区" subtitle="这些动作会直接把方法论用反">
                <ul className="space-y-1.5">
                  {mod.pitfalls.map((p) => (
                    <li key={p} className="flex gap-2 text-[13px] leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span className="min-w-0 text-slate-600 dark:text-slate-300">{p}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel title="在本项目里练一遍" subtitle="讲义讲的是判据，下面的页面把判据变成可复核的数字">
              <div className="flex flex-wrap gap-2">
                <ToolLink to="/limit-ladder" label="涨停梯队" hint="验证「上涨是否成群」" />
                <ToolLink to="/market-env" label="市场环境" hint="用六维分数代替情绪感觉" />
                <ToolLink to="/finance/indicators" label="财务指标" hint="看均线/MACD/KDJ 的原始计算值" />
                <ToolLink to="/strategy" label="策略引擎" hint="把规则写成条件并回测胜率" />
                <ToolLink to="/concept-analysis" label="概念分析" hint="看题材板块的成分与龙头" />
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <Chip tone="slate">讲义不含个股推荐</Chip>
                <Chip tone="slate">口径与策略引擎一致</Chip>
                指标定义以本项目后端为准，和行情软件默认参数可能差一档（如 RSI 周期 14、BOLL 取 20,2）。
              </p>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolLink({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link to={to}
      className="rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-800/60">
      <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
    </Link>
  );
}
