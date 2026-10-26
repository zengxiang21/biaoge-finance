import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { DataSourceSummary, MatrixRow } from "../lib/types";
import { timeAgo } from "../lib/format";
import {
  Button, Chip, EmptyState, Panel, Skeleton, cn,
} from "../components/ui";
import { toast } from "../store/toast";
import { useSession } from "../store/session";

type Resp = { matrix: MatrixRow[]; summary: DataSourceSummary; note: string };

const STATUS_TONE = { ok: "emerald", error: "rose", unknown: "slate" } as const;

export default function DataSourceMatrixPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [cfg, setCfg] = useState<Record<string, { enabled: boolean; priority: number }>>({});
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<{ capability: string; ok: boolean; count?: number; error?: string }[]>([]);
  const hasPerm = useSession((s) => s.hasPerm);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get<Resp>("/system/data-sources");
      setData(r);
      // summary.providers 只带用户显式配过的字段，没配过的从矩阵行兜底
      const next: Record<string, { enabled: boolean; priority: number }> = {};
      for (const m of r.matrix) {
        const cur = next[m.provider];
        if (!cur) next[m.provider] = { enabled: m.enabled, priority: m.priority };
        else cur.priority = Math.min(cur.priority, m.priority);
      }
      for (const p of r.summary.providers) {
        next[p.provider] = {
          enabled: p.enabled ?? next[p.provider]?.enabled ?? true,
          priority: p.priority ?? next[p.provider]?.priority ?? 100,
        };
      }
      setCfg(next);
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const probe = async (capability?: string) => {
    setProbing(capability ?? "__all__");
    try {
      const r = await api.post<{ results: typeof probeResults; matrix: MatrixRow[]; summary: DataSourceSummary }>(
        `/system/data-sources/probe${capability ? `?capability=${capability}` : ""}`);
      setProbeResults(r.results);
      setData({ ...(data as Resp), matrix: r.matrix, summary: r.summary });
      const failed = r.results.filter((x) => !x.ok).length;
      toast(failed ? `探测完成，${failed} 项失败` : `探测完成，${r.results.length} 项全通`, failed ? "warn" : "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setProbing(null);
    }
  };

  const save = async () => {
    setProbing("save");
    try {
      const r = await api.put<{ config: Record<string, unknown>; matrix: MatrixRow[] }>(
        "/system/data-sources", cfg);
      setData((old) => (old ? { ...old, matrix: r.matrix } : old));
      toast("数据源开关已保存", "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setProbing(null);
    }
  };

  if (!data) {
    return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  }

  const capabilities = [...new Set(data.matrix.map((m) => m.capability))];
  const editable = hasPerm("system:data-source:update");

  return (
    <div className="space-y-4">
      <Panel title="数据源概览" subtitle={data.note}
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" loading={busy} onClick={() => void load()}>重载</Button>
            <Button size="sm" loading={probing === "__all__"} onClick={() => void probe()}>全部探测</Button>
            {editable && <Button size="sm" onClick={save} loading={probing === "save"}>保存开关</Button>}
          </div>
        }>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="能力×源" value={`${data.summary.total} 项`} />
          <Tile label="正常" value={`${data.summary.ok}`} tone="ok" />
          <Tile label="异常" value={`${data.summary.error}`} tone={data.summary.error ? "error" : "ok"} />
          <Tile label="未探测" value={`${data.summary.unknown}`} />
          <Tile label="健康度" value={data.summary.healthy === null ? "—" : `${data.summary.healthy}%`}
            tone={data.summary.healthy === null ? undefined : data.summary.healthy >= 90 ? "ok" : "error"}
            hint={`最近探测 ${timeAgo(data.summary.lastCheck)}`} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          健康度只算已探测过的项（正常 / (正常+异常)），刚启动时未探测的项目不会把分数拉低
        </p>
      </Panel>

      {probeResults.length > 0 && (
        <Panel title="本次探测结果" subtitle="每项能力的入口函数被真实调用了一次，失败会写进健康表">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {probeResults.map((r) => (
              <li key={r.capability}
                className={cn("rounded-lg border px-3 py-2 text-xs",
                  r.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200")}>
                <span className="font-medium">{labelOf(r.capability)}</span>
                <span className="ml-2 nums">{r.ok ? `${r.count} 条` : "失败"}</span>
                {r.error && <span className="mt-1 block break-all text-[11px] opacity-80">{r.error}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="能力 × 数据源矩阵" subtitle="同一能力按优先级主备切换，主源失败自动落到备源">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50/95 dark:bg-slate-800/95">
              <tr>
                {["能力", "源", "优先级", "状态", "延迟", "HTTP", "命中/失败", "最近探测"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.flatMap((cap) => {
                const rows = data.matrix.filter((m) => m.capability === cap);
                return rows.map((m, idx) => (
                  <tr key={`${m.provider}-${m.capability}`}
                    className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1.5 text-xs">
                      {idx === 0 ? <span className="font-medium">{m.capabilityLabel}</span> : <span className="opacity-0">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                      {m.providerLabel}
                      {!m.enabled && <Chip tone="slate" className="ml-1.5">已停用</Chip>}
                    </td>
                    <td className="nums px-3 py-1.5 text-xs text-slate-500">{m.priority}</td>
                    <td className="px-3 py-1.5">
                      <Chip tone={STATUS_TONE[m.status]}>
                        {m.status === "ok" ? "正常" : m.status === "error" ? "异常" : "未探测"}
                      </Chip>
                      {m.error && (
                        <span className="mt-0.5 block max-w-[22rem] truncate text-[10px] text-rose-500" title={m.error}>
                          {m.error}
                        </span>
                      )}
                    </td>
                    <td className="nums px-3 py-1.5 text-xs">{m.latencyMs === null ? "—" : `${m.latencyMs}ms`}</td>
                    <td className="nums px-3 py-1.5 text-xs text-slate-500">{m.httpStatus ?? "—"}</td>
                    <td className="nums px-3 py-1.5 text-xs text-slate-500">{m.hits} / {m.fails}</td>
                    <td className="nums px-3 py-1.5 text-[11px] text-slate-400">{timeAgo(m.checkedAt)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="ghost" loading={probing === m.capability}
                        onClick={() => void probe(m.capability)}>测这项</Button>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        {!data.matrix.length && <EmptyState text="没有注册任何能力路由" />}
      </Panel>

      <Panel title="源开关" subtitle={editable ? "关掉某个源后，它的能力会落到备源" : "当前账号没有改数据源配置的权限"}>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["sina", "eastmoney", "tencent"] as const).map((p) => {
            const item = cfg[p] ?? { enabled: true, priority: 0 };
            const meta = data.summary.providers.find((x) => x.provider === p);
            const capCount = data.matrix.filter((m) => m.provider === p).length;
            const okCount = data.matrix.filter((m) => m.provider === p && m.status === "ok").length;
            return (
              <div key={p} className="rounded-xl border border-slate-200/80 p-3 dark:border-slate-700/60">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{meta?.label ?? p}</span>
                  <input type="checkbox" checked={item.enabled} disabled={!editable}
                    onChange={(e) => setCfg({ ...cfg, [p]: { ...item, enabled: e.target.checked } })}
                    className="h-4 w-4 accent-rose-600" />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  承担 {capCount} 项能力，其中 {okCount} 项探测正常
                </p>
                <label className="mt-2 block text-[11px] text-slate-500">
                  全局优先级
                  <input type="number" min={1} max={9} value={item.priority} disabled={!editable}
                    onChange={(e) => setCfg({ ...cfg, [p]: { ...item, priority: Number(e.target.value) } })}
                    className="nums mt-1 w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
                </label>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          矩阵里的「优先级」是每项能力内部的调用顺序（主源=1，备源=2…），和这里的整体优先级数字不是一回事
        </p>
      </Panel>
    </div>
  );
}

function labelOf(cap: string): string {
  const map: Record<string, string> = {
    index: "指数实时行情", spot: "全市场快照/排行", kline_daily: "日线K线",
    minute_trend: "分时走势", board_industry: "行业板块", limit_up_pool: "涨停池",
  };
  return map[cap] ?? cap;
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: "ok" | "error"; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums text-lg font-semibold",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
          : tone === "error" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-200")}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}
