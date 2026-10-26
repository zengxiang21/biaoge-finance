import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { MonitorResult, StudentUsageRow } from "../lib/types";
import { num, timeAgo } from "../lib/format";
import { Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, type Column } from "../components/ui";
import { toast } from "../store/toast";

/** 管理工作台 · 全局监控（拆解文档 3.17.1） */

const PURPOSE_LABEL: Record<string, string> = {
  stock_analyze: "个股诊断",
  predict_price_target: "目标价预测",
  daily_review: "每日复盘",
  strategy_generate: "AI 创建策略",
  strategy_generate_fix: "AI 修策略",
  connection_test: "连通性测试",
  news_summary: "快讯摘要",
};

function tok(v: number) {
  return num(v, 0);
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rose" | "emerald" | "amber" | "sky" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={
        tone === "rose" ? "mt-0.5 text-lg font-semibold text-rose-600"
          : tone === "emerald" ? "mt-0.5 text-lg font-semibold text-emerald-600"
            : tone === "amber" ? "mt-0.5 text-lg font-semibold text-amber-600"
              : "mt-0.5 text-lg font-semibold"
      }>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={hint}>{hint}</p>}
    </div>
  );
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await api.get<MonitorResult>("/admin/workbench/monitor", undefined, 30000));
    } catch (e) {
      if (!silent) toast(messageOf(e), "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 这页全是「多久前」，不自己拉一次就会越写越旧；静默刷新，别把表格刷成骨架屏
    const timer = window.setInterval(() => { void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const usageCols: Column<StudentUsageRow>[] = [
    { key: "name", label: "学员", value: (r) => `${r.displayName}（${r.username}）`,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <Link to={`/admin/workbench/students?q=${encodeURIComponent(r.username)}`}
            className="truncate font-medium text-slate-800 hover:text-rose-600 dark:text-slate-100">
            {r.displayName}
          </Link>
          <Chip tone={r.role === "admin" ? "violet" : "slate"}>{r.roleLabel}</Chip>
          {r.status !== "active" && <Chip tone="amber">{r.status === "closed" ? "已注销" : "停用"}</Chip>}
        </span>
      ) },
    { key: "tokenWindow", label: "近7天 Token", align: "right", value: (r) => r.tokenWindow,
      render: (r) => <span className="tabular-nums">{tok(r.tokenWindow)}</span> },
    { key: "tokenToday", label: "今日", align: "right", sortable: true, value: (r) => r.tokenToday,
      render: (r) => <span className="tabular-nums">{tok(r.tokenToday)}</span> },
    { key: "tokenUsed", label: "累计 / 配额", align: "right", value: (r) => r.tokenUsed,
      render: (r) => (
        <span className="tabular-nums" title={r.tokenQuota ? `已用 ${r.tokenUsedPct ?? 0}%` : "未设配额"}>
          {tok(r.tokenUsed)} / {r.tokenQuota ? tok(r.tokenQuota) : "不限"}
        </span>
      ) },
    { key: "quotaBar", label: "配额占用", width: "w-28", value: (r) => r.tokenUsedPct ?? 0,
      render: (r) => (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={
            (r.tokenUsedPct ?? 0) > 100 ? "h-full bg-rose-500"
              : (r.tokenUsedPct ?? 0) > 80 ? "h-full bg-amber-500" : "h-full bg-emerald-500"
          } style={{ width: `${Math.min(100, r.tokenUsedPct ?? 0)}%` }} />
        </div>
      ) },
    { key: "aiCalls", label: "调用 成功/失败", align: "right", value: (r) => r.aiCalls,
      render: (r) => (
        <span className="tabular-nums">
          {r.aiCalls} <span className="text-emerald-600">{r.aiOk}</span>
          <span className="text-slate-400"> / </span><span className={r.aiFailed ? "text-rose-600" : "text-slate-400"}>{r.aiFailed}</span>
        </span>
      ) },
    { key: "aiAvgLatency", label: "平均耗时", align: "right", value: (r) => r.aiAvgLatency,
      render: (r) => `${num(r.aiAvgLatency, 0)} ms` },
    { key: "aiLastAt", label: "最近调用", value: (r) => r.aiLastAt ?? "", render: (r) => timeAgo(r.aiLastAt) },
  ];

  const jobCols: Column<MonitorResult["jobs"][number]>[] = [
    { key: "label", label: "任务", value: (r) => r.label,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{r.label}</span>
          <span className="shrink-0 font-mono text-[10px] text-slate-400" title={r.job}>{r.job}</span>
        </span>
      ) },
    { key: "today", label: "今日", align: "right", value: (r) => r.today, render: (r) => r.today || "—" },
    { key: "runs", label: "近 200 次", align: "right", value: (r) => r.runs },
    { key: "errors", label: "失败", align: "right", value: (r) => r.errors,
      render: (r) => <span className={r.errors ? "text-rose-600" : "text-slate-400"}>{r.errors}</span> },
    { key: "lastStatus", label: "最近状态", value: (r) => r.lastStatus ?? "",
      render: (r) => <Chip tone={r.lastStatus === "error" ? "rose" : r.lastStatus === "ok" ? "emerald" : "slate"}>
        {r.lastStatus === "error" ? "失败" : r.lastStatus === "skipped" ? "跳过" : r.lastStatus ? "正常" : "无"}
      </Chip> },
    { key: "lastAt", label: "最近执行", value: (r) => r.lastAt ?? "",
      render: (r) => <span title={r.lastAt ?? "无记录"}>{r.lastAt ? timeAgo(r.lastAt) : "无记录"}</span> },
    { key: "detail", label: "最近详情", value: (r) => r.detail,
      render: (r) => <span className="block max-w-[320px] truncate text-[11px] text-slate-500" title={r.detail}>{r.detail || "—"}</span> },
  ];

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) return <EmptyState text="监控数据取不到" hint="确认后端 8750 已启动后重试" />;

  const t = data.token;
  const c = data.content;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            管理员视角 · 汇总到 {data.generatedAt}，Token 与调用统计口径为本机 ai_calls 流水
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>刷新</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="今日 Token 消耗" value={tok(t.today.tokens)} tone="sky"
          hint={`提示 ${tok(t.today.promptTokens)} / 生成 ${tok(t.today.completionTokens)}，单次均 ${tok(t.today.avgTokensPerCall)}`} />
        <Stat label="今日 AI 调用" value={`${t.today.calls} 次`} tone={t.today.failed ? "amber" : "emerald"}
          hint={`成功 ${t.today.ok} · 失败 ${t.today.failed}${t.today.successRate === null ? "" : ` · 成功率 ${t.today.successRate}%`}，均耗时 ${num(t.today.avgLatencyMs, 0)} ms`} />
        <Stat label="昨日 Token" value={tok(t.yesterday.tokens)}
          hint={`环比 ${t.yesterday.tokens ? Math.round((t.today.tokens / t.yesterday.tokens - 1) * 100) : "—"}%（近 7 天累计 ${tok(t.week.tokens)}）`} />
        <Stat label="在册学员" value={`${data.students.totals.active} / ${data.students.totals.users}`}
          tone={data.students.overQuota.length ? "rose" : undefined}
          hint={`配额已发放 ${tok(data.students.totals.quota)}，已消耗 ${tok(data.students.totals.used)}${data.students.overQuota.length ? `，${data.students.overQuota.length} 人超额` : ""}`} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="学员计费明细" subtitle="按近 7 天 Token 消耗排序，点名字进学员管理调价"
          right={<Link to="/admin/workbench/students" className="text-xs text-rose-600 hover:underline">全部学员</Link>}
          loading={loading}>
          {data.students.rows.length ? (
            <DataTable columns={usageCols} rows={data.students.rows} rowKey={(r) => r.id} dense
              sortInitial={{ key: "tokenWindow", desc: true }} />
          ) : <EmptyState text="还没有学员用过 AI" hint="首次登录后生成一次个股诊断就会出现记录" />}
        </Panel>

        <Panel title="AI 调用质量" subtitle="近 7 天按用途聚合，失败样本留最近 8 条" loading={loading}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {data.ai.models.map((m) => (
                <Chip key={`${m.model}-${m.engine}`} tone="slate">{m.model || "未知模型"} · {m.calls} 次</Chip>
              ))}
              {!data.ai.models.length && <Chip tone="slate">近 7 天无调用</Chip>}
            </div>
            <DataTable dense sortInitial={{ key: "tokens", desc: true }} rows={data.ai.byPurpose} rowKey={(r) => r.purpose} columns={[
              { key: "purpose", label: "用途", value: (r) => r.purpose,
                render: (r) => PURPOSE_LABEL[r.purpose] ?? r.purpose },
              { key: "calls", label: "次数", align: "right", value: (r) => r.calls },
              { key: "ok", label: "成功", align: "right", value: (r) => r.ok,
                render: (r) => <span className="text-emerald-600">{r.ok}</span> },
              { key: "failed", label: "失败", align: "right", value: (r) => r.failed,
                render: (r) => <span className={r.failed ? "text-rose-600" : "text-slate-400"}>{r.failed}</span> },
              { key: "tokens", label: "Token", align: "right", sortable: true, value: (r) => r.tokens,
                render: (r) => tok(r.tokens) },
              { key: "avgLatencyMs", label: "均耗时", align: "right", value: (r) => r.avgLatencyMs,
                render: (r) => `${num(r.avgLatencyMs, 0)} ms` },
            ]} />
            {data.ai.failures.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">最近的失败调用</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {data.ai.failures.map((f) => (
                    <li key={f.id} className="flex items-start gap-2 text-[11px]">
                      <span className="shrink-0 tabular-nums text-slate-400">{f.createdAt?.slice(5, 16)}</span>
                      <span className="shrink-0 text-slate-500">{PURPOSE_LABEL[f.purpose] ?? f.purpose}</span>
                      <span className="min-w-0 flex-1 truncate text-rose-600" title={f.note ?? ""}>{f.note || "无错误说明"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="调度与全量更新" subtitle={`全局调度${data.scheduler.enabled ? "已开启" : "已关闭"}，每日 ${data.scheduler.dailyTime ?? "—"} 收盘快照`}
          loading={loading}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {data.scheduler.jobs.length ? data.scheduler.jobs.map((j) => (
                <Chip key={j.id} tone="sky">
                  <span className="max-w-[150px] truncate" title={`${j.name} → ${j.nextRun ?? "未排期"}`}>
                    {j.name} · {j.nextRun?.slice(5, 16) ?? "未排期"}
                  </span>
                </Chip>
              )) : <Chip tone="amber">当前没有排期任务</Chip>}
            </div>
            <DataTable dense rows={data.jobs} rowKey={(r) => r.job} columns={jobCols} sortInitial={{ key: "lastAt", desc: true }} />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              数据源健康：{data.dataSources.ok} 正常 / {data.dataSources.error} 异常 / {data.dataSources.unknown} 未探测
              {data.dataSources.healthy !== null && `，健康度 ${data.dataSources.healthy}%`}
              ，最近探测 {timeAgo(data.dataSources.lastCheck)}。
              <Link to="/settings/data-sources" className="ml-1 text-rose-600 hover:underline">去数据源矩阵</Link>
            </p>
          </div>
        </Panel>

        <Panel title="平台运行量" subtitle="今日快照与内容积压" loading={loading}>
          <div className="space-y-3">
            {data.market && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                <span className="font-medium">交易日 {data.market.trade_date}</span>
                <span className="text-slate-400">全市场 {data.market.total ?? "—"} 家</span>
                <UpDown value={((data.market.up ?? 0) - (data.market.down ?? 0))} sign suffix=" 家差" strong />
                <span>上涨 {data.market.up ?? "—"}</span>
                <span>涨停 {data.market.limit_up ?? "—"}</span>
                {data.emotion && <Chip tone="violet">情绪 {data.market?.score ?? "—"} · {data.emotion.label}</Chip>}
                <span className="text-slate-400">建快照 {timeAgo(data.market.built_at)}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: "自选股样本", v: c.snapshotStocks, note: "只" },
                { k: "板块记录", v: c.boards, note: "条" },
                { k: "今日异动", v: c.anomalyToday, note: "起" },
                { k: "今日快讯", v: c.newsToday, note: "条" },
                { k: "策略总数", v: c.strategies, note: "个" },
                { k: "今日跑策略", v: c.strategyRunsToday, note: "次" },
                { k: "今日复盘", v: c.reviewsToday, note: "份" },
                { k: "待回反馈", v: c.feedbackOpen, note: "条" },
              ].map((x) => (
                <div key={x.k} className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-800">
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={x.k}>{x.k}</p>
                  <p className="text-sm font-semibold tabular-nums">{x.v ?? 0} {x.note}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              账号 {data.users.total} 个（在册 {data.users.active}、管理员 {data.users.admin}、今日新增 {data.users.newToday}）；
              今日操作审计 {c.auditToday} 条，未读站内信 {c.notificationsUnread} 条。
              <Link to="/system/audit-logs" className="ml-1 text-rose-600 hover:underline">看审计</Link>
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
