import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type {
  AnomalyEvent, AnomalyEventsResult, AnomalySummary, ScanResult,
} from "../lib/types";
import { clock, money, price, timeAgo, tradeDate } from "../lib/format";
import {
  Button, Chip, DataTable, Panel, Skeleton, UpDown, cn, type Column,
} from "../components/ui";
import { toast } from "../store/toast";

const TONE: Record<string, "slate" | "rose" | "emerald" | "amber" | "sky" | "violet"> = {
  surge: "rose", plunge: "emerald", volume_burst: "amber", limit_up_seal: "rose",
  limit_up_break: "violet", large_order_inflow: "sky", large_order_outflow: "slate",
};

export default function AnomalyEventsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AnomalyEventsResult | null>(null);
  const [sum, setSum] = useState<AnomalySummary | null>(null);
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ev, sm] = await Promise.all([
        api.get<AnomalyEventsResult>("/anomaly/events", {
          limit: 300, ...(type ? { event_type: type } : {}), ...(keyword.trim() ? { symbol: keyword.trim() } : {}),
        }, 30_000),
        api.get<AnomalySummary>("/anomaly/summary", {}, 30_000),
      ]);
      setData(ev);
      setSum(sm);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [type, keyword]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), keyword ? 320 : 30);
    return () => window.clearTimeout(id);
  }, [load, keyword]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [auto, load]);

  const runScan = async (mode: "live" | "close") => {
    setScanning(true);
    try {
      const r = await api.post<ScanResult>(`/anomaly/scan?mode=${mode}`, {}, 120_000);
      toast(mode === "close"
        ? `收盘口径生成 ${r.new_events ?? r.events?.length ?? 0} 条异动`
        : `本轮扫描 ${r.scanned ?? 0} 只，新增 ${r.new_events ?? 0} 条异动`, "ok");
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setScanning(false);
    }
  };

  const types = data?.meta?.types ?? [];
  const rows = data?.rows ?? [];
  const byKey = useMemo(() => Object.fromEntries((sum?.byType ?? []).map((b) => [b.key, b.count])), [sum]);

  const cols: Column<AnomalyEvent>[] = [
    { key: "time", label: "时间", width: "w-16", value: (r) => r.triggered_at, render: (r) => (
      <span className="nums whitespace-nowrap text-[11px] text-slate-400" title={r.triggered_at}>
        {clock(r.triggered_at)}
      </span>) },
    { key: "type", label: "类型", width: "w-24", value: (r) => r.eventTypeLabel, render: (r) => (
      <Chip tone={TONE[r.event_type] ?? "slate"}>{r.eventTypeLabel}</Chip>) },
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-nowrap text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
      </div>) },
    { key: "price", label: "现价", align: "right", value: (r) => r.price,
      render: (r) => <span className="nums">{price(r.price)}</span> },
    { key: "chg", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
      render: (r) => <UpDown value={r.change_percent} /> },
    { key: "vr", label: "量能倍数", align: "right", value: (r) => r.volume_ratio, render: (r) => (
      <span className="nums text-slate-600 dark:text-slate-300">
        {r.volume_ratio ? `${r.volume_ratio.toFixed(2)}×` : "—"}
      </span>) },
    { key: "net", label: "主力净额", align: "right", value: (r) => r.net_amount, render: (r) => (
      <span className={cn("nums", (r.net_amount ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
        {r.net_amount === null ? "—" : money(r.net_amount * 1e4)}
      </span>) },
    { key: "basis", label: "触发依据", value: (r) => String(r.params?.basis ?? ""), render: (r) => (
      <span className="whitespace-nowrap text-[11px] text-slate-500" title={basisText(r)}>
        {basisText(r)}
      </span>) },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="实时异常监控"
        subtitle={sum
          ? `近 24 小时 ${sum.total} 条异动 · 涉及 ${sum.symbols} 只 · 最近事件 ${sum.lastEvent ? timeAgo(sum.lastEvent) : "无"} · 上次扫描 ${sum.scan.at ? `${timeAgo(sum.scan.at)}（${sum.scan.basis === "live" ? "盘中" : sum.scan.basis === "closed" ? "休市" : "未跑"}，扫 ${sum.scan.scanned} 只）` : "尚未运行"}`
          : error ?? "正在读取异动事件…"}
        right={(
          <>
            <Link to="/anomaly/rules"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              异动规则
            </Link>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              30 秒轮询
            </label>
            <Button size="sm" variant="outline" loading={scanning} onClick={() => void runScan("live")}>立即扫描</Button>
            <Button size="sm" variant="ghost" loading={scanning} onClick={() => void runScan("close")}
              title="用最近一个交易日的收盘快照与涨跌停池生成事件，休市时看效果用">收盘口径生成</Button>
          </>
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="全部" count={sum?.total ?? 0} active={type === ""} onClick={() => setType("")} />
          {types.map((t) => (
            <FilterChip key={t.key} label={t.label} count={byKey[t.key] ?? 0}
              active={type === t.key} onClick={() => setType(type === t.key ? "" : t.key)} />
          ))}
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="按名称或代码过滤"
            className="ml-auto w-44 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        </div>

        {sum?.scan.note && (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
            {sum.scan.note}
          </p>
        )}
        {!!sum?.scan.errors && Object.keys(sum.scan.errors).length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {Object.entries(sum.scan.errors).map(([k, v]) => `${k}：${v}`).join("；")}
          </p>
        )}

        <div className="mt-3">
          {busy && !data ? <Skeleton className="h-64 w-full" /> : (
            <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} dense maxHeight="560px"
              empty={type ? "该类型近期没有异动" : "还没有异动事件，点右上「收盘口径生成」先看当日结果"}
              onRowClick={(r) => navigate(`/stock-analysis/${r.symbol}`)} />
          )}
        </div>
        {!!data && data.total > 0 && (
          <p className="mt-2 text-[11px] text-slate-400">
            当前展示 {data.total} 条，交易日 {tradeDate(rows[0]?.trade_date ?? null)}；冷却期内同一只票同类异动只记一次
          </p>
        )}
      </Panel>
    </div>
  );
}

function basisText(r: AnomalyEvent): string {
  const p = r.params ?? {};
  const basis = String(p.basis ?? "");
  const extra = r.event_type === "limit_up_seal" && p.lbc ? ` ${p.lbc} 连板 · 首封 ${p.fbt}`
    : r.event_type === "limit_up_break" && p.zb_count ? ` 炸板 ${p.zb_count} 次`
      : p.pct_5min !== undefined ? ` 区间 ${p.pct_5min}%` : "";
  return `${basis}${extra}` || "—";
}

function FilterChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("nums rounded-md border px-2 py-1 text-[11px] transition",
        active ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
          : "border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300")}>
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}
