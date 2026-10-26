import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { clock, tradeDate } from "../lib/format";
import type {
  CommonFilter, PicksResult, StrategyMeta, StrategyRow, StrategyRun, WinRate,
} from "../lib/types";
import { familyChip, progressText, scheduleWarning, stars } from "../lib/strategy";
import {
  Button, Chip, EmptyState, Field, Panel, PermissionGate, Skeleton, UpDown,
  cn, inputClass,
} from "../components/ui";
import {
  CodeEditor, CompositeEditor, type CompositePart, defaultDraft, ParamsEditor,
  type ParamDraft, PickTable, RunSummary,
} from "../components/strategy";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

const RT_LABEL: Record<string, string> = { intraday: "盘中实时", after_hours: "盘后分析", any: "随时可用" };

export default function StrategyDetailPage() {
  const { sid } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hasPerm = useSession((s) => s.hasPerm);
  const id = Number(sid);

  const [row, setRow] = useState<StrategyRow | null>(null);
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [runs, setRuns] = useState<StrategyRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParamDraft | null>(null);
  const [parts, setParts] = useState<CompositePart[]>([]);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const [result, setResult] = useState<PicksResult | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewRunId, setViewRunId] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, r] = await Promise.all([
        api.get<StrategyRow>(`/strategies/${id}`, undefined, 30_000),
        api.get<{ rows: StrategyRun[] }>(`/strategies/${id}/runs?size=20`, undefined, 30_000),
      ]);
      setRow(d);
      setRuns(r.rows);
      setDraft(defaultDraft(d, COMMON_FALLBACK));
      setParts(d.composite ?? []);
      setCode(d.code_text ?? "");
      if (!meta) {
        try {
          setMeta(await api.get<StrategyMeta>("/strategies/meta"));
        } catch { /* 拿不到 meta 时用行数据自带的硬条件即可 */ }
      }
    } catch (e) {
      setError(messageOf(e));
      toast(messageOf(e), "error");
    }
  }, [id, meta]);

  useEffect(() => { void load(); }, [load]);

  const filters = useMemo<CommonFilter[]>(() => meta?.commonFilters ?? COMMON_FALLBACK, [meta]);
  useEffect(() => {
    if (row && meta) setDraft(defaultDraft(row, filters));
  }, [row, meta, filters]);

  const stopPoll = () => {
    cancelled.current = true;
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => stopPoll, []);

  // 用 setTimeout 串起来而不是 setInterval：请求慢的时候 setInterval 会叠发，
  // 后回来的旧状态会把已经结束的 running 又点亮
  const poll = useCallback((runId: number) => {
    stopPoll();
    cancelled.current = false;
    const t0 = Date.now();
    const step = async () => {
      if (cancelled.current) return;
      setElapsed(Math.round((Date.now() - t0) / 1000));
      try {
        const r = await api.get<PicksResult>(`/strategies/${id}/picks`, { run_id: runId }, 60_000);
        if (cancelled.current) return;
        setResult(r);
        if (r.status !== "pending" && r.status !== "running") {
          setRunning(false);
          void load();
          return;
        }
      } catch (e) {
        setRunning(false);
        setError(messageOf(e));
        return;
      }
      timer.current = window.setTimeout(step, 2000);
    };
    void step();
  }, [id, load]);

  const startRun = async () => {
    if (!row) return;
    const warn = scheduleWarning(row);
    if (warn) toast(warn, "warn");
    setRunning(true);
    setError(null);
    setElapsed(0);
    try {
      const r = await api.post<{ run_id: number; status: string; message?: string }>(
        `/strategies/${row.id}/run`, undefined, 60_000);
      setViewRunId(r.run_id);
      if (r.status === "schedule-blocked") {
        setRunning(false);
        setResult({ status: "schedule-blocked", run_id: r.run_id, error_message: r.message ?? "调度占用" });
        return;
      }
      poll(r.run_id);
    } catch (e) {
      setRunning(false);
      toast(messageOf(e), "error");
    }
  };

  // 列表页「运行」跳过来带 ?run=，直接接着轮询同一次运行
  useEffect(() => {
    const q = Number(params.get("run"));
    if (!q || !row) return;
    setViewRunId(q);
    setRunning(true);
    poll(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, params]);

  const showRun = async (runId: number) => {
    setViewRunId(runId);
    setResult(null);
    try {
      const r = await api.get<PicksResult>(`/strategies/runs/${runId}/picks`, { limit: 200 }, 60_000);
      setResult(r);
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const saveParams = async () => {
    if (!row || !draft) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        params: { max_output: draft.max_output, min_score: draft.min_score,
                  hard: draft.hard, filters: draft.filters },
      };
      if (row.strategy_type === "composite" && parts.length) body.composite = normalizeParts(parts);
      if (row.code_text && code !== row.code_text) body.code = code;
      const next = await api.patch<StrategyRow>(`/strategies/${row.id}`, body, 60_000);
      // PATCH 只回精简行，直接覆盖会把 latest/胜率/维度等字段抹掉
      setRow((prev) => ({ ...(prev ?? next), ...next }));
      toast("参数已保存", "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!row) return;
    try {
      const next = await api.patch<StrategyRow>(`/strategies/${row.id}`,
        { status: row.status === "active" ? "inactive" : "active" });
      setRow((prev) => ({ ...(prev ?? next), ...next }));
      toast(row.status === "active" ? "策略已停用" : "策略已启用", "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const remove = async () => {
    if (!row || !window.confirm(`删除策略「${row.name}」？`)) return;
    try {
      await api.del(`/strategies/${row.id}`);
      toast("已删除", "ok");
      navigate("/strategy");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  if (!row) {
    return (
      <div className="space-y-4">
        <Panel title="策略详情" loading>
          {error
            ? <p className="text-xs text-rose-600">{error}</p>
            : <Skeleton className="h-40 w-full" />}
        </Panel>
      </div>
    );
  }

  const readOnly = Boolean(row.is_system) || !hasPerm("strategy:update");
  const fam = familyChip(row);
  const items = result?.items ?? [];

  return (
    <div className="space-y-4">
      <Panel
        title={<>{row.name}
          <span className="nums ml-2 text-[11px] font-normal text-slate-400">{row.code}</span></>}
        subtitle={row.description || "（无描述）"}
        right={(
          <>
            <PermissionGate code="strategy:run">
              <Button size="sm" loading={running} onClick={() => void startRun()}>运行策略</Button>
            </PermissionGate>
            {!readOnly && <Button size="sm" variant="outline" loading={saving} onClick={() => void saveParams()}>保存参数</Button>}
            {!row.is_system && hasPerm("strategy:update") && (
              <Button size="sm" variant="ghost" onClick={() => void toggleStatus()}>
                {row.status === "active" ? "停用" : "启用"}
              </Button>
            )}
            {!row.is_system && hasPerm("strategy:delete") && (
              <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => void remove()}>删除</Button>
            )}
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          <Chip tone={row.is_system ? "slate" : row.strategy_type === "composite" ? "rose" : row.is_ai ? "violet" : "sky"}>
            {row.typeLabel}
          </Chip>
          {fam && (
            <Chip tone={fam === "技术面" ? "emerald" : fam === "资金面" ? "sky" : "amber"}>
              {fam}
            </Chip>
          )}
          {row.stars ? <span className="nums text-amber-500" title="推荐指数">{stars(row.stars)}</span> : null}
          <span title="运行时段要求">运行时段：{RT_LABEL[row.run_time_type] ?? row.run_time_type}</span>
          <span className="nums">文档胜率 {row.winRateDoc ?? "—"}%</span>
          {row.scene && <span>适用：{row.scene}</span>}
          <span>引擎 {row.engine ?? "builtin"}</span>
          <span>更新 {clock(row.updated_at)}</span>
        </div>
        {!!row.dims.length && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-slate-400">评分维度</span>
            {row.dims.map(([k, label]) => <Chip key={k} tone="sky" className="max-w-full truncate">{label}</Chip>)}
          </div>
        )}
        {row.run_time_type !== "any" && scheduleWarning(row) && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {scheduleWarning(row)}
          </p>
        )}
      </Panel>

      <Panel title="选股结果" subtitle={running
        ? `${progressText(elapsed)}（已等待 ${elapsed} 秒）`
        : result ? "本次运行已完成" : "点右上角「运行策略」跑一次全市场扫描"}
        right={viewRunId ? <span className="nums text-[11px] text-slate-400">run #{viewRunId}</span> : undefined}>
        {running && !result?.items && (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-200" />
            {result?.message ?? progressText(elapsed)}
          </div>
        )}
        {result?.status === "failed" && (
          <p className="text-xs text-rose-600">{result.error_message ?? "运行失败"}</p>
        )}
        {result?.status === "schedule-blocked" && (
          <EmptyState text="调度拦截，未执行扫描" hint={result.error_message ?? undefined} />
        )}
        {result?.items && (
          <>
            <div className="mb-3">
              <RunSummary result={result} />
            </div>
            <PickTable items={items} />
          </>
        )}
        {!result && !running && (row.latest ? (
          <div className="space-y-3">
            <p className="text-[11.5px] text-slate-500">
              下面是 {tradeDate(row.latest.started_at)} 那次运行的摘要，点要看股票清单就在下方运行历史里选一次运行。
            </p>
            <RunSummary result={row.latest} />
          </div>
        ) : <EmptyState text="这个策略还没跑过" hint="内置策略第一次跑大约 8-30 秒，全市场 5000+ 只" />)}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={readOnly ? "策略参数（内置策略只读）" : "策略参数"}
          subtitle="硬条件不满足直接淘汰；最低评分填 0 表示只用硬条件筛">
          <ParamsEditor hard={row.hardParams} filters={filters} value={draft ?? defaultDraft(row, filters)}
            onChange={setDraft} readOnly={readOnly} />
        </Panel>

        <div className="space-y-4">
          {row.strategy_type === "composite" && (
            <Panel title="叠加组合" subtitle="第一个子策略的类型与标的池作为基准；结果 = 各子策略评分 × 权重">
              <CompositeEditor pool={(meta?.strategies ?? []).map((s) => ({ code: s.code, name: s.name }))}
                parts={parts} onChange={setParts} readOnly={readOnly} />
            </Panel>
          )}
          {!!row.code_text && (
            <Panel title="策略代码" subtitle={readOnly ? "内置/无更新权限时只读" : "改完点右上角「保存参数」一起提交"}>
              <CodeEditor value={code} onChange={readOnly ? undefined : setCode} readOnly={readOnly} />
            </Panel>
          )}
          <WinRatePanel row={row} />
        </div>
      </div>

      <Panel title="运行历史" subtitle={`共 ${runs.length} 次（最多显示 20 次），点一行看那次的选股结果`}>
        {!runs.length ? <EmptyState text="还没有运行记录" /> : (
          <div className="overflow-auto rounded-lg">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50/95 text-xs text-slate-500 dark:bg-slate-800/95 dark:text-slate-400">
                <tr>
                  {["run", "状态", "全市场", "候选", "命中", "耗时", "开始", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={cn("border-t border-slate-100 dark:border-slate-800",
                    viewRunId === r.id && "bg-slate-50 dark:bg-slate-800/50")}>
                    <td className="nums px-3 py-1.5">#{r.id}</td>
                    <td className="px-3 py-1.5"><RunStatusChip run={r} /></td>
                    <td className="nums px-3 py-1.5">{r.universe_count ?? "—"}</td>
                    <td className="nums px-3 py-1.5">{r.candidate_count ?? "—"}</td>
                    <td className="nums px-3 py-1.5 font-semibold">{r.pick_count ?? "—"}</td>
                    <td className="nums px-3 py-1.5">{r.elapsed_ms ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="nums whitespace-nowrap px-3 py-1.5 text-[12px] text-slate-500">{clock(r.started_at)}</td>
                    <td className="px-3 py-1.5">
                      <Button size="sm" variant="ghost" onClick={() => void showRun(r.id)}>看结果</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </Panel>
    </div>
  );
}

function normalizeParts(parts: CompositePart[]): CompositePart[] {
  const total = parts.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  return parts.map((p) => ({ ...p, weight: Math.round(Math.max(1, p.weight) / total * 100) }));
}

function RunStatusChip({ run }: { run: StrategyRun }) {
  const tone = run.status === "ready" ? "emerald" : run.status === "failed" ? "rose"
    : run.status === "schedule-blocked" ? "amber" : "slate";
  const label = run.status === "ready" ? "完成" : run.status === "failed" ? "失败"
    : run.status === "schedule-blocked" ? "调度拦截" : run.status === "running" ? "执行中" : "排队中";
  return <Chip tone={tone}>{label}</Chip>;
}

/* --------------------------------------------------------- 历史胜率 */

function WinRatePanel({ row }: { row: StrategyRow }) {
  const [days, setDays] = useState(12);
  const [horizon, setHorizon] = useState(5);
  const [sample, setSample] = useState(600);
  const [data, setData] = useState<WinRate | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setData(await api.get<WinRate>(`/strategies/${row.id}/history-win-rate`, { days, horizon, sample }, 180_000));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const max = Math.max(1, ...(data?.per_day ?? []).map((d) => d.hits));
  return (
    <Panel title="历史胜率（本地日线抽样回测）"
      subtitle="命中后第 N 个交易日收盘价高于买入价记一次胜利，已按往返 0.1% 成本计"
      right={<Button size="sm" variant="outline" loading={busy} onClick={() => void run()}>跑回测</Button>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="回看天数">
          <input type="number" className={cn(inputClass, "nums py-1 text-[13px]")} value={days}
            onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
        <Field label="持有交易日">
          <input type="number" className={cn(inputClass, "nums py-1 text-[13px]")} value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))} />
        </Field>
        <Field label="抽样股票数">
          <input type="number" className={cn(inputClass, "nums py-1 text-[13px]")} value={sample}
            onChange={(e) => setSample(Number(e.target.value))} />
        </Field>
      </div>

      {!data && !busy && <p className="mt-2 text-[11.5px] text-slate-400">
        内置技术面策略支持抽样回测；资金面/事件面策略依赖外部数据，只能看文档参考值 {row.winRateDoc ?? "—"}%。
      </p>}
      {data && !data.ok && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{data.message}</p>}
      {data?.ok && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="nums text-2xl font-semibold">
              {data.win_rate?.toFixed(1)}<span className="ml-0.5 text-xs font-normal text-slate-400">%</span>
            </span>
            <UpDown value={data.doc_win_rate != null && data.win_rate != null
              ? data.win_rate - data.doc_win_rate : null} sign suffix="pp"
            />
            <span className="nums text-[11.5px] text-slate-500">样本 {data.samples} 次 · 文档值 {data.doc_win_rate ?? "—"}%</span>
            {data.cached && <Chip>缓存</Chip>}
          </div>
          {!!data.per_day?.length && (
            <div className="flex h-20 items-end gap-1.5">
              {data.per_day.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date} 命中 ${d.hits} 只`}>
                  <div className="w-full rounded-t bg-rose-500/70" style={{ height: `${(d.hits / max) * 100}%` }} />
                  <span className="nums text-[9px] text-slate-400">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">{data.cost_note} · {data.note}</p>
        </div>
      )}
    </Panel>
  );
}

/** meta 还没回来时先按文档 3.5.7 的默认值渲染，避免表单闪一下 */
const COMMON_FALLBACK: CommonFilter[] = [
  { key: "exclude_st", label: "排除 ST", type: "boolean", default: true },
  { key: "price_min", label: "价格下限", type: "number", default: 5, unit: "元" },
  { key: "price_max", label: "价格上限", type: "number", default: 200, unit: "元" },
  { key: "float_cap_min", label: "流通市值下限", type: "number", default: 30, unit: "亿" },
  { key: "float_cap_max", label: "流通市值上限", type: "number", default: 1500, unit: "亿" },
  { key: "amount_min", label: "最低成交额", type: "number", default: 50000000, unit: "元" },
  { key: "amount_max", label: "最高成交额", type: "number", default: 0, unit: "元", hint: "0 表示不限" },
  { key: "turnover_rate_min", label: "换手率下限", type: "number", default: 0.5, unit: "%" },
  { key: "turnover_rate_max", label: "换手率上限", type: "number", default: 18, unit: "%" },
  { key: "boards", label: "板块", type: "array", default: ["sh_main", "sz_main", "chinext", "star", "bse"] },
];
