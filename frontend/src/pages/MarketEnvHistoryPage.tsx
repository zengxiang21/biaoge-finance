import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { EnvHistoryResult, EnvHistoryRow } from "../lib/types";
import { EMOTION_TONE } from "../lib/colors";
import { num, price, tradeDate, yi } from "../lib/format";
import { SparkLine } from "../components/charts";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";
import { toast } from "../store/toast";

const DAY_CHOICES = [30, 60, 120, 240, 500] as const;
const BAND_ORDER = ["亢奋", "活跃", "温和", "低迷", "冰点", "待更新"];

export default function MarketEnvHistoryPage() {
  const [days, setDays] = useState<number>(60);
  const [data, setData] = useState<EnvHistoryResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (): Promise<EnvHistoryResult | null> => {
    setBusy(true);
    try {
      const res = await api.get<EnvHistoryResult>("/market-env/history", { days }, 60_000);
      setData(res);
      setError(null);
      return res;
    } catch (e) { setError(messageOf(e)); return null; }
    finally { setBusy(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  // 回填跑在后台线程、没有进度接口，只能靠历史行数变多（或超时）来收尾
  const startBackfill = async (force: boolean) => {
    setFilling(true);
    const before = data?.total ?? 0;
    try {
      const r = await api.post<{ ok: boolean; message: string }>(
        `/market-env/backfill?days=${days}&force=${force}`, undefined, 30_000);
      toast(r.message ?? "回填已启动", r.ok ? "ok" : "error");
    } catch (e) {
      toast(messageOf(e), "error");
      setFilling(false);
      return;
    }
    let tries = 0;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      tries += 1;
      const res = await load();
      if ((res && res.total > before) || tries >= 20) {
        setFilling(false);
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  };

  const rows = data?.rows ?? [];
  const dist = data?.labelDist ?? {};
  const scored = rows.filter((r) => r.score !== null);

  return (
    <div className="space-y-4">
      <Panel
        title="市场环境 · 情绪分历史"
        subtitle={data
          ? `窗口 近 ${days} 个交易日 · 共 ${data.total} 条记录（${scored.length} 条有分数）`
            + ` · 均分 ${data.avgScore === null ? "—" : data.avgScore.toFixed(1)}`
          : error ?? "正在读取历史六维得分…"}
        right={(
          <>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className={cn(inputClass, "h-8 w-24! shrink-0 !py-1 text-xs")}>
              {DAY_CHOICES.map((d) => <option key={d} value={d}>近 {d} 日</option>)}
            </select>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
            <Button size="sm" variant="outline" loading={filling} title="只用本地日线缓存回算，不打外部接口"
              onClick={() => void startBackfill(false)}>回算历史缺口</Button>
            <Button size="sm" variant="danger" loading={filling} title="覆盖已有历史行，重算整段"
              onClick={() => void startBackfill(true)}>强制重算</Button>
            <Link to="/market-env"
              className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              当日环境
            </Link>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? (
          <EmptyState text="历史表是空的"
            hint="点右上「回算历史缺口」，用本地日线缓存把过去几十天的六维分数补出来" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {BAND_ORDER.filter((k) => dist[k]).map((k) => (
                <span key={k}
                  className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white",
                    EMOTION_TONE[k] ?? "bg-slate-400")}>
                  {k}<span className="nums">{dist[k]}</span>
                </span>
              ))}
              {data?.max && (
                <Chip tone="rose">最高 {price(data.max.score)} · {tradeDate(data.max.trade_date)}</Chip>
              )}
              {data?.min && (
                <Chip tone="emerald">最低 {price(data.min.score)} · {tradeDate(data.min.trade_date)}</Chip>
              )}
              <Chip tone="sky">情绪分中枢 {data?.avgScore === null ? "—" : data?.avgScore.toFixed(1)}</Chip>
            </div>
            {scored.length >= 2 && (
              <div>
                <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                  情绪分序列（{tradeDate(scored[0].trade_date)} → {tradeDate(scored[scored.length - 1].trade_date)}）
                </p>
                <SparkLine values={scored.map((r) => r.score ?? 0)} fluid
                  up={(scored.at(-1)?.score ?? 0) >= (scored[0]?.score ?? 0)} width={600} height={72} />
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-slate-400">
              历史六维由本地日线缓存与收盘快照回算：趋势=三大指数加权涨跌幅，广度=上涨家数占比，
              活跃=成交额环比，封板=涨停/(涨停+炸板)，均线=站上 MA20 比例，新高低=60 日新高占比。
              缺口日的涨停池数据无法追溯，该列留空属正常。
            </p>
          </div>
        )}
      </Panel>

      <Panel title="逐日得分" subtitle="倒序展示 · 点表头按列排序，可用来找情绪拐点" bodyClass="p-0">
        <DataTable dense maxHeight="520px" loading={busy && !data}
          rows={[...rows].reverse()} rowKey={(r) => r.trade_date} columns={cols}
          empty="没有历史记录" sortInitial={{ key: "d", desc: true }} />
        {data && data.total > 0 && (
          <p className="px-4 py-2 text-[11px] text-slate-400">
            合计 {data.total} 天 · 有分 {scored.length} 天 · 均分 {data.avgScore?.toFixed(1) ?? "—"}
            {" · "}缺口主要落在没有涨停池快照的历史日
          </p>
        )}
      </Panel>
    </div>
  );
}

const cols: Column<EnvHistoryRow>[] = [
  { key: "d", label: "交易日", value: (r) => r.trade_date, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
      {tradeDate(r.trade_date)}
    </span>) },
  { key: "s", label: "情绪分", align: "right", value: (r) => r.score, render: (r) => (
    <span className="nums font-semibold text-slate-800 dark:text-slate-100">
      {r.score === null ? "—" : r.score.toFixed(1)}
    </span>) },
  { key: "chg", label: "环比", align: "right", value: (r) => r.scoreChange, render: (r) => (
    <UpDown value={r.scoreChange} suffix=" 分" strong={false} />) },
  { key: "label", label: "结论", align: "center", value: (r) => r.label, render: (r) => (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium text-white",
      EMOTION_TONE[r.label ?? "待更新"] ?? "bg-slate-400")}>{r.label ?? "待更新"}</span>) },
  { key: "trend", label: "趋势", align: "right", value: (r) => r.trend, render: (r) => <Dim v={r.trend} /> },
  { key: "breadth", label: "广度", align: "right", value: (r) => r.breadth, render: (r) => <Dim v={r.breadth} /> },
  { key: "activity", label: "活跃", align: "right", value: (r) => r.activity, render: (r) => <Dim v={r.activity} /> },
  { key: "seal", label: "封板", align: "right", value: (r) => r.seal, render: (r) => <Dim v={r.seal} /> },
  { key: "ma", label: "均线", align: "right", value: (r) => r.moving_avg, render: (r) => <Dim v={r.moving_avg} /> },
  { key: "hl", label: "新高低", align: "right", value: (r) => r.high_low, render: (r) => <Dim v={r.high_low} /> },
  { key: "lu", label: "涨停家数", align: "right", value: (r) => r.limit_up, render: (r) => (
    <span className="nums text-slate-500">{r.limit_up === null ? "—" : num(r.limit_up, 0)}</span>) },
  { key: "amt", label: "两市成交", align: "right", value: (r) => r.amount, render: (r) => (
    <span className="nums text-slate-500">{yi(r.amount)}</span>) },
  { key: "note", label: "备注", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-400">{r.note ?? "—"}</span>) },
];

function Dim({ v }: { v: number | null }) {
  return (
    <span className={cn("nums", v === null ? "text-slate-300 dark:text-slate-600"
      : v >= 60 ? "text-rose-500" : v < 40 ? "text-emerald-500" : "text-slate-500")}>
      {v === null ? "—" : v.toFixed(0)}
    </span>
  );
}
