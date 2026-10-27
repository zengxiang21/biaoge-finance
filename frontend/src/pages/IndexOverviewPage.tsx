import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, isDemo, messageOf } from "../lib/api";
import type { IndexOverviewResult, IndexQuote } from "../lib/types";
import { EMOTION_TONE } from "../lib/colors";
import { clock, money, num, price, tradeDate, yi } from "../lib/format";
import { BreadthBar, HeatBars, IntradayLine, SparkLine } from "../components/charts";
import { SourceErrors } from "../components/global-quote";
import { ValuationSection } from "../components/valuation";
import {
  Button, Chip, EmptyState, Panel, Skeleton, UpDown, cn, type Column, DataTable,
} from "../components/ui";
import type { BoardListItem } from "../lib/types";

export default function IndexOverviewPage() {
  const [data, setData] = useState<IndexOverviewResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("sh000001");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<IndexOverviewResult>("/index/overview", {}, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const quotes = data?.quotes ?? [];
  const active = quotes.find((q) => q.symbol === picked) ?? quotes[0];
  const minute = data?.minute?.[active?.symbol ?? ""] ?? [];
  const spark = data?.spark ?? {};
  const daily = data?.daily;

  // 腾讯分时的 volume/amount 是当日累计值，先差分回单分钟量，均价线才能用 Σ(价×单分钟量)÷Σ量
  const minutePts = useMemo(() => {
    let cost = 0;
    let vol = 0;
    let cum = 0;
    return minute.map((p) => {
      const per = Math.max(0, (p.volume ?? 0) - cum);
      cum = p.volume ?? 0;
      cost += p.price * per;
      vol += per;
      return { t: clock(p.time), price: p.price, avg: vol ? round(cost / vol, 3) : null, volume: per };
    });
  }, [minute]);

  return (
    <div className="space-y-4">
      <Panel
        title="指数概览 · 五大核心指数"
        subtitle={data
          ? `${quotes.length} 个指数实时报价 · 收盘统计 ${tradeDate(daily?.trade_date ?? null)}`
            + `（${daily?.score === null || daily?.score === undefined ? "未打分" : `情绪分 ${daily.score}`}）`
            + ` · 更新于 ${data.generatedAt}`
          : error ?? "正在读取指数报价、分时与日线序列…"}
        right={(
          <>
            <Link to="/index/components"
              className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              指数成分
            </Link>
            <Link to="/market-env"
              className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              市场环境
            </Link>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-28 w-full" /> : quotes.length === 0 ? (
          <EmptyState text="指数报价接口没返回"
            hint={data?.errors?.index ?? (isDemo ? "演示站没有后端，指数报价不在预生成范围内"
              : "新浪指数行情偶发限流，稍后刷新")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {quotes.map((q) => (
              <QuoteCard key={q.symbol} q={q} values={spark[q.symbol]?.values ?? []}
                on={() => setPicked(q.symbol)} active={active?.symbol === q.symbol} />
            ))}
          </div>
        )}
        <SourceErrors errors={data?.errors ?? {}} />
      </Panel>

      <ValuationSection />

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2"
          title={`${active?.label ?? "指数"} 分时`}
          subtitle={minute.length
            ? `${minute.length} 个分钟点，${clock(minute[0].time)} → ${clock(minute.at(-1)!.time)} · 基线为昨收 ${price(active?.prev_close ?? null)}`
            : "分时只有当日盘中到收盘的序列，且接口仅覆盖上证指数"}
          right={quotes.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {quotes.slice(0, 3).map((q) => (
                <button key={q.symbol} type="button" onClick={() => setPicked(q.symbol)}
                  className={cn("rounded-md px-2 py-1 text-[11px] transition",
                    active?.symbol === q.symbol
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}>
                  {q.label}
                </button>
              ))}
            </div>
          )}>
          {busy && !data ? <Skeleton className="h-52 w-full" />
            : minute.length < 2
              ? <EmptyState text="该指数没有分时序列"
                  hint="分时接口（腾讯）只覆盖上证指数；休市日也不会返回历史分时" />
              : (
                <IntradayLine height={300} prevClose={active?.prev_close ?? null} points={minutePts} />
              )}
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            分时源为腾讯，返回的成交量是当日累计值；这里先差分回单分钟量，均价线用
            Σ(点位×单分钟量)÷Σ量 现算，与行情软件黄线口径一致。创业板指、北证50 这类没有分时源的指数，
            看卡片里的 30 日日线走势。
          </p>
        </Panel>

        <Panel title="市场宽度" subtitle={daily
          ? `${tradeDate(daily.trade_date)} · 全市场 ${num(daily.total ?? null, 0)} 只` : "等收盘快照"}>
          {daily && daily.total ? (
            <>
              <BreadthBar up={daily.up ?? 0} flat={daily.flat ?? 0} down={daily.down ?? 0} />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Cell k="上涨" v={num(daily.up ?? null, 0)} tone="text-rose-500" />
                <Cell k="下跌" v={num(daily.down ?? null, 0)} tone="text-emerald-500" />
                <Cell k="平盘" v={num(daily.flat ?? null, 0)} />
                <Cell k="涨停" v={num(daily.limit_up ?? null, 0)} tone="text-rose-500" />
                <Cell k="跌停" v={num(daily.limit_down ?? null, 0)} tone="text-emerald-500" />
                <Cell k="炸板" v={num(daily.blown ?? null, 0)} tone="text-amber-500" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="sky">两市成交 {yi(daily.amount)}</Chip>
                {data?.emotion && (
                  <span className={cn("rounded px-2 py-0.5 text-xs font-medium text-white",
                    EMOTION_TONE[data.emotion.key] ?? "bg-slate-400")}>
                    {data.emotion.label}
                  </span>
                )}
                <span className="text-[11px] text-slate-400">{data?.emotion?.meaning}</span>
              </div>
              <Link to="/limit-ladder" className="mt-3 inline-block text-xs text-sky-600 hover:underline">
                看涨停梯队（连板结构 / 炸板明细）
              </Link>
            </>
          ) : <EmptyState text="还没有收盘宽度数据" hint="在仪表盘重建一次收盘快照" />}
        </Panel>
      </div>

      <Panel title="板块与指数入口"
        subtitle={data ? "板块榜为新浪收盘口径 Top 10；成分表点进去看具体名单与权重" : ""}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
              行业榜 Top 10
              <Link to="/industry-analysis" className="font-normal text-sky-600 hover:underline">全部行业</Link>
            </p>
            <HeatBars rows={(data?.boards?.industry ?? []).map(boardRow)} />
            {data?.boards?.industryError && (
              <p className="mt-1 text-[11px] text-amber-600">行业榜：{data.boards.industryError}</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
              概念榜 Top 10
              <Link to="/concept-analysis" className="font-normal text-sky-600 hover:underline">全部概念</Link>
            </p>
            <HeatBars rows={(data?.boards?.concept ?? []).map(boardRow)} />
            {data?.boards?.conceptError && (
              <p className="mt-1 text-[11px] text-amber-600">概念榜：{data.boards.conceptError}</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">指数成分表</p>
            <div className="grid grid-cols-2 gap-2">
              {(data?.indexes ?? []).map((i) => (
                <Link key={i.key} to={`/index/components?index=${i.key}`}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-800/60">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{i.label}</p>
                  <p className="nums mt-0.5 text-[11px] text-slate-500">
                    {i.code} · {i.count ?? i.expected} / {i.expected} 只
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="指数报价明细" subtitle="点开上面任意一张卡片可切换分时对象；下表为全量字段" bodyClass="p-0">
        <DataTable dense loading={busy && !data} rows={quotes} rowKey={(r) => r.symbol}
          columns={quoteCols} empty="没有指数行情" />
        <p className="px-4 py-2 text-[11px] leading-relaxed text-slate-400">
          成交量直接取源接口原值，指数与个股的计数单位不同，只用于同一指数自身横向比较；
          成交额、涨跌幅、点位与行情软件一致，收盘后不再变化。
        </p>
      </Panel>
    </div>
  );
}

function boardRow(b: BoardListItem) {
  return { code: b.code, name: b.name, changePercent: b.change_percent, stockCount: b.stock_count };
}

function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function QuoteCard({ q, values, on, active }: {
  q: IndexQuote; values: number[]; on: () => void; active: boolean;
}) {
  const up = q.change_percent >= 0;
  return (
    <button type="button" onClick={on}
      className={cn("rounded-xl border p-3 text-left transition",
        active ? "border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/60"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{q.label}</span>
        <span className="nums text-[10px] text-slate-400">{q.symbol}</span>
      </div>
      <p className={cn("nums mt-1 text-lg font-semibold leading-tight",
        up ? "text-rose-500" : "text-emerald-500")}>{price(q.price, 2)}</p>
      <p className="nums mt-0.5 flex items-center gap-2 text-xs">
        <UpDown value={q.change_percent} />
        <span className={up ? "text-rose-500" : "text-emerald-500"}>{price(q.change_price)}</span>
      </p>
      <div className="mt-1.5">
        <SparkLine values={values} up={up} width={150} height={30} />
      </div>
      <p className="nums mt-1 text-[10px] leading-relaxed text-slate-400">
        今开 {price(q.open)} · 最高 {price(q.high)} · 最低 {price(q.low)}
      </p>
      <p className="nums text-[10px] text-slate-400">
        昨收 {price(q.prev_close)} · 成交 {money(q.amount)} · {q.date ?? ""} {clock(q.time)}
      </p>
    </button>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60">
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{k}</p>
      <p className={cn("nums text-sm font-semibold text-slate-800 dark:text-slate-100", tone)}>{v}</p>
    </div>
  );
}

const quoteCols: Column<IndexQuote>[] = [
  { key: "label", label: "指数", value: (r) => r.label, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
      <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
    </div>) },
  { key: "p", label: "最新点位", align: "right", value: (r) => r.price,
    render: (r) => <span className="nums font-semibold">{price(r.price)}</span> },
  { key: "chg", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
    render: (r) => <UpDown value={r.change_percent} /> },
  { key: "cp", label: "涨跌点数", align: "right", value: (r) => r.change_price, render: (r) => (
    <span className={cn("nums", r.change_price >= 0 ? "text-rose-500" : "text-emerald-500")}>
      {r.change_price > 0 ? "+" : ""}{price(r.change_price)}
    </span>) },
  { key: "o", label: "今开", align: "right", value: (r) => r.open,
    render: (r) => <span className="nums text-slate-500">{price(r.open)}</span> },
  { key: "h", label: "最高", align: "right", value: (r) => r.high,
    render: (r) => <span className="nums text-slate-500">{price(r.high)}</span> },
  { key: "l", label: "最低", align: "right", value: (r) => r.low,
    render: (r) => <span className="nums text-slate-500">{price(r.low)}</span> },
  { key: "pc", label: "昨收", align: "right", value: (r) => r.prev_close,
    render: (r) => <span className="nums text-slate-500">{price(r.prev_close)}</span> },
  { key: "v", label: "成交量", align: "right", value: (r) => r.volume,
    render: (r) => <span className="nums text-slate-500">{money(r.volume)}</span> },
  { key: "a", label: "成交额", align: "right", value: (r) => r.amount,
    render: (r) => <span className="nums text-slate-500">{money(r.amount)}</span> },
  { key: "t", label: "报价时间", align: "right", render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-400">
      {r.date ?? "—"} {clock(r.time)}
    </span>) },
];
