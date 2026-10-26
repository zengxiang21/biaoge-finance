import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { MarketEnvResult } from "../lib/types";
import { num, tradeDate, yi } from "../lib/format";
import { EMOTION_TONE } from "../lib/colors";
import { BucketHistogram, BreadthBar, EmotionRadar, HeatBars, SparkLine } from "../components/charts";
import { SourceErrors } from "../components/global-quote";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, cn, type Column,
} from "../components/ui";

export default function MarketEnvPage() {
  const [data, setData] = useState<MarketEnvResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<MarketEnvResult>("/market-env", {}, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const score = data?.score ?? null;
  const band = data?.bands.find((b) => score !== null && score >= b.lo && score < b.hi);
  const hist = data?.histogram;
  const trend = data?.trend ?? {};

  return (
    <div className="space-y-4">
      <Panel
        title="市场环境 · 六维情绪温度计"
        subtitle={data
          ? `结论对应交易日 ${tradeDate(data.tradeDate)} · 快照生成于 ${data.builtAt ?? "—"} · 当前 ${data.phase.label}`
          : error ?? "正在按趋势/广度/活跃/封板/均线/新高六个维度打分…"}
        right={(
          <>
            <Link to="/market-env/history"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              历史情绪
            </Link>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-48 w-full" />
          : !data || !data.available ? (
            <EmptyState text="还没有收盘快照"
              hint={data?.message ?? "六维分数依赖 market_daily，先在仪表盘点一次「重建收盘快照」"} />
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="flex shrink-0 flex-col items-center">
                <EmotionRadar score={score} dims={data.dims.map((d) => ({
                  key: d.key, label: d.label, score: d.value, weight: d.weight,
                }))} size={210} />
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-lg px-3 py-1.5 text-base font-semibold text-white",
                    EMOTION_TONE[data.emotion?.key ?? "待更新"] ?? "bg-slate-400")}>
                    {data.emotion?.label ?? "待更新"} · {score === null ? "—" : score.toFixed(1)} 分
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{data.emotion?.meaning}</span>
                  <Chip tone="sky">涨跌家数 {data.breadth.up ?? "—"} / {data.breadth.down ?? "—"}</Chip>
                  <Chip tone="rose">涨停 {data.livePools.limit_up ?? data.breadth.limit_up ?? "—"}</Chip>
                  <Chip tone="emerald">跌停 {data.breadth.limit_down ?? "—"}</Chip>
                  <Chip>炸板 {data.livePools.blown ?? data.breadth.blown ?? "—"}</Chip>
                  <Chip>两市成交 {yi(data.breadth.amount)}</Chip>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-5">
                  {data.bands.map((b) => {
                    const on = band?.label === b.label;
                    return (
                      <div key={b.label}
                        className={cn("rounded-lg border px-2 py-1.5 text-left transition",
                          on ? "border-transparent text-white"
                            : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400",
                          on && EMOTION_TONE[b.label])}
                        title={b.meaning}>
                        <p className="text-xs font-semibold">{b.label}</p>
                        <p className="nums text-[10px] opacity-80">{b.lo} ~ {b.hi > 100 ? 100 : b.hi}</p>
                      </div>
                    );
                  })}
                </div>
                {band && <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  当前落在 <strong className="text-slate-700 dark:text-slate-200">{band.label}</strong>
                  （{band.lo}~{band.hi} 分）：{band.meaning}
                </p>}
                <p className="text-[11px] leading-relaxed text-slate-400">{data.note}</p>
              </div>
            </div>
          )}
        <SourceErrors errors={data?.errors ?? {}} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="六维得分与口径"
          subtitle="权重合计 1，分数为 0~100；每项都标注了它到底在量什么" bodyClass="p-0">
          <DataTable dense rows={data?.dims ?? []} rowKey={(r) => r.key} columns={dimCols}
            loading={busy && !data} empty="没有维度得分，说明收盘快照未生成" />
        </Panel>

        <div className="space-y-4">
          <Panel title="涨跌广度" subtitle={data
            ? `${tradeDate(data.tradeDate)} 全市场 ${num(data.breadth.total ?? null, 0)} 只，上涨占比 ${pctOf(data.breadth.up, data.breadth.total)}`
            : ""}>
            {data ? (
              <>
                <BreadthBar up={data.breadth.up ?? 0} flat={data.breadth.flat ?? 0} down={data.breadth.down ?? 0} />
                <div className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                  <Cell k="上涨" v={num(data.breadth.up ?? null, 0)} tone="text-rose-500" />
                  <Cell k="平盘" v={num(data.breadth.flat ?? null, 0)} />
                  <Cell k="下跌" v={num(data.breadth.down ?? null, 0)} tone="text-emerald-500" />
                  <Cell k="涨停" v={num(data.breadth.limit_up ?? null, 0)} tone="text-rose-500" />
                  <Cell k="炸板" v={num(data.breadth.blown ?? null, 0)} tone="text-amber-500" />
                  <Cell k="跌停" v={num(data.breadth.limit_down ?? null, 0)} tone="text-emerald-500" />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  实时涨停池另有 {data.livePools.limit_up ?? "—"} 家（炸板 {data.livePools.blown ?? "—"}、
                  跌停 {data.livePools.limit_down ?? "—"}），来源是当日涨停池接口，与收盘快照口径可能差一次刷新。
                </p>
              </>
            ) : <Skeleton className="h-16 w-full" />}
          </Panel>

          <Panel title="涨跌幅分布"
            subtitle={hist
              ? `${tradeDate(hist.trade_date)} · ${num(hist.total, 0)} 只参与统计 · 涨停 ${hist.limitUp} / 跌停 ${hist.limitDown} · 柱高为该档家数`
              : ""}>
            {hist ? <BucketHistogram buckets={hist.buckets} height={110} /> : <Skeleton className="h-24 w-full" />}
            <p className="mt-2 text-[11px] text-slate-400">
              分布右移且中间档变矮 = 赚钱效应扩散；中间档鼓起、两端拉长 = 指数不动但个股分化。
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="趋势结构" subtitle={trend.available
          ? `基于本地日线全量 ${num(trend.sampleTotal ?? null, 0)} 只抽样` : "趋势维度未计算"}>
          {trend.available ? (
            <div className="space-y-2.5">
              <Ratio label="站上 MA5" value={trend.ma5AboveRatio} />
              <Ratio label="站上 MA20" value={trend.ma20AboveRatio} />
              <Ratio label="站上 MA60" value={trend.ma60AboveRatio} />
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <Chip tone="rose">60 日新高 {num(trend.newHigh ?? null, 0)}</Chip>
                <Chip tone="emerald">60 日新低 {num(trend.newLow ?? null, 0)}</Chip>
                <Chip tone={((trend.amountVsPrev ?? 0) >= 0) ? "rose" : "emerald"}>
                  成交额环比 {trend.amountVsPrev === null || trend.amountVsPrev === undefined
                    ? "—" : `${trend.amountVsPrev > 0 ? "+" : ""}${trend.amountVsPrev.toFixed(1)}%`}
                </Chip>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">{trend.note}</p>
            </div>
          ) : <EmptyState text="趋势结构为空" hint="需要本地日线缓存（kline_cache）有数据" />}
        </Panel>

        <Panel title="强势板块 Top 8" subtitle={data
          ? `收盘快照当日，按涨跌幅排序 · 点板块名看成分` : ""}>
          {data?.topBoards.length ? (
            <HeatBars rows={data.topBoards.map((b) => ({
              code: b.code, name: b.name, changePercent: b.change_percent, stockCount: b.stock_count,
            }))} />
          ) : <Skeleton className="h-32 w-full" />}
          <p className="mt-2 text-[11px] text-slate-400">
            完整排行与成分股在
            <Link to="/industry-analysis" className="mx-1 text-sky-600 hover:underline">行业分析</Link>
            /
            <Link to="/concept-analysis" className="mx-1 text-sky-600 hover:underline">概念分析</Link>
            。
          </p>
        </Panel>

        <Panel title="情绪分近 30 日" subtitle={data
          ? `最高 ${maxScore(data)} · 最低 ${minScore(data)} · 最新 ${score === null ? "—" : score.toFixed(1)}`
          : ""}>
          {data && data.scoreHistory.length >= 2 ? (
            <>
              <SparkLine values={data.scoreHistory.map((h) => h.score ?? 0)}
                up={(data.scoreHistory.at(-1)?.score ?? 0) >= (data.scoreHistory[0]?.score ?? 0)}
                width={320} height={56} />
              <ul className="mt-2 space-y-1">
                {[...data.scoreHistory].reverse().slice(0, 6).map((h) => (
                  <li key={h.trade_date} className="flex items-center gap-2 text-xs">
                    <span className="nums w-20 shrink-0 text-slate-500">{tradeDate(h.trade_date)}</span>
                    <span className="nums w-12 shrink-0 font-semibold text-slate-800 dark:text-slate-100">
                      {h.score === null ? "—" : h.score.toFixed(1)}
                    </span>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white",
                      EMOTION_TONE[h.label ?? "待更新"] ?? "bg-slate-400")}>{h.label ?? "待更新"}</span>
                    <span className="nums min-w-0 flex-1 truncate text-right text-[10px] text-slate-400">
                      趋势 {short(h.trend)} · 广度 {short(h.breadth)} · 封板 {short(h.seal)} · 均线 {short(h.moving_avg)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : <Skeleton className="h-28 w-full" />}
        </Panel>
      </div>
    </div>
  );
}

function short(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toFixed(0);
}

function maxScore(d: MarketEnvResult): string {
  const vals = d.scoreHistory.map((h) => h.score).filter((v): v is number => v !== null);
  return vals.length ? Math.max(...vals).toFixed(1) : "—";
}

function minScore(d: MarketEnvResult): string {
  const vals = d.scoreHistory.map((h) => h.score).filter((v): v is number => v !== null);
  return vals.length ? Math.min(...vals).toFixed(1) : "—";
}

function pctOf(part: number | null | undefined, total: number | null | undefined): string {
  if (!part || !total) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60">
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{k}</p>
      <p className={cn("nums text-sm font-semibold text-slate-800 dark:text-slate-100", tone)}>{v}</p>
    </div>
  );
}

function Ratio({ label, value }: { label: string; value: number | null | undefined }) {
  const pct = value === null || value === undefined ? null : value * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="nums font-semibold text-slate-800 dark:text-slate-100">
          {pct === null ? "—" : `${pct.toFixed(1)}%`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={cn("h-full rounded-full", (pct ?? 0) >= 50 ? "bg-rose-500" : "bg-emerald-500")}
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </div>
    </div>
  );
}

const dimCols: Column<MarketEnvResult["dims"][number]>[] = [
  { key: "label", label: "维度", value: (r) => r.label, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
      <span className="nums ml-1.5 text-[11px] text-slate-400">权重 {(r.weight * 100).toFixed(0)}%</span>
    </div>) },
  { key: "value", label: "得分", align: "right", value: (r) => r.value, render: (r) => (
    <div className="flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className={cn("block h-full rounded-full",
          (r.value ?? 0) >= 60 ? "bg-rose-500" : (r.value ?? 0) >= 40 ? "bg-amber-400" : "bg-emerald-500")}
          style={{ width: `${Math.max(2, Math.min(100, r.value ?? 0))}%` }} />
      </span>
      <span className="nums w-10 text-right text-xs font-semibold text-slate-800 dark:text-slate-100">
        {r.value === null ? "—" : r.value.toFixed(1)}
      </span>
    </div>) },
  { key: "band", label: "档位", align: "center", value: (r) => r.band, render: (r) => (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium text-white",
      EMOTION_TONE[r.band ?? "待更新"] ?? "bg-slate-400")}>{r.band ?? "—"}</span>) },
  { key: "how", label: "计算口径", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{r.how}</span>) },
];
