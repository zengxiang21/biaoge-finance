import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, messageOf } from "../lib/api";
import type {
  BoardGroup, BoardMover, BoardRow, GlobalQuote, Overview, RankedStock,
} from "../lib/types";
import { money, num, pct, timeAgo, tradeDate, yi } from "../lib/format";
import { EMOTION_TONE, dirOf, TONE } from "../lib/colors";
import {
  BreadthBar, BucketHistogram, EmotionRadar, IntradayLine, SparkLine,
} from "../components/charts";
import {
  Button, Chip, DataTable, EmptyState, Panel, PermissionGate, Skeleton, UpDown, cn, inputClass,
} from "../components/ui";
import { LiveTicker } from "../components/LiveTicker";
import { toast } from "../store/toast";
import { useSession } from "../store/session";

const CACHE_KEY = "tsp-saas.dashboard.overview";

/** 板块成分股（新浪 Market_Center 原始字段，和 BoardRow 不是一回事） */
type ConstituentRow = {
  symbol: string; name: string; trade: string; changepercent: number; turnoverratio: number;
};

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Overview["snapshotProgress"] | null>(null);
  const pollRef = useRef<number | null>(null);
  // 自己走的时钟：不重新拉数据也要让「X 分钟前 / 下次刷新 N 秒后」这类读数保持鲜活
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadedAtRef = useRef(Date.now());
  const hasPerm = useSession((s) => s.hasPerm);

  const load = useCallback(async (refresh = false, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const d = await api.get<Overview>(`/dashboard/overview${refresh ? "?refresh=true" : ""}`);
      setData(d);
      setOffline(false);
      setError(null);
      loadedAtRef.current = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify(d));
      if (d.snapshotProgress?.state === "running") startProgressPolling();
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached && !refresh) {
        setData(JSON.parse(cached) as Overview);
        setOffline(true);
      }
      setError(messageOf(e));
    } finally {
      if (!silent) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startProgressPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const p = await api.get<Overview["snapshotProgress"]>("/dashboard/snapshot/progress");
        setProgress(p);
        if (p.state !== "running") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (p.state === "done") {
            toast("全市场快照已重建", "ok");
            void load(true);
          } else if (p.error) toast(`快照失败：${p.error}`, "error");
        }
      } catch {
        /* 轮询失败忽略，下一轮再试 */
      }
    }, 3000);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true, true); }, 60_000);
    const clock = window.setInterval(() => setNowMs(Date.now()), 5_000);
    const onVisible = () => { if (!document.hidden) void load(true, true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const rebuild = async () => {
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/dashboard/snapshot/build");
      toast(r.message, "info");
      startProgressPolling();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  if (!data) {
    return (
      <div className="space-y-4">
        {error && <Banner tone="rose">{error}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-12">
          <Skeleton className="h-80 xl:col-span-3" />
          <Skeleton className="h-80 xl:col-span-5" />
          <Skeleton className="h-80 xl:col-span-4" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const b = data.breadth;
  const e = data.emotion;
  const t = data.trend;

  const clock = new Date(nowMs).toLocaleTimeString("zh-CN", { hour12: false });
  const nextIn = Math.max(0, 60 - Math.round((nowMs - loadedAtRef.current) / 1000));
  // 盘中要看到「几分钟前」，收盘后数据已定型，报具体落库时刻比「57 分钟前」更诚实
  const snapText = !b.builtAt ? "快照 待建"
    : data.phase.trading ? `盘中快照 ${timeAgo(b.builtAt)}` : `收盘快照 ${b.builtAt.slice(11, 16)}`;

  return (
    <div className="space-y-4">
      {(error || offline) && (
        <Banner tone={offline ? "amber" : "rose"}>
          {offline ? `实时拉取失败（${error}），下面是上次成功时的缓存快照` : error}
        </Banner>
      )}
      {data.degraded && !offline && <Banner tone="sky">{data.degradedReason}</Banner>}

      <LiveTicker />

      {/* 顶部：交易日 + 时段 + 操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">大盘全景</h1>
        <Chip tone="slate">交易日 {tradeDate(data.tradeDate)}</Chip>
        <Chip tone={data.phase.trading ? "emerald" : "slate"}>{data.phase.label}</Chip>
        <Chip tone={e.band === "pending" ? "slate" : "rose"}>
          情绪 {e.score === null ? "待更新" : `${e.score.toFixed(1)} · ${e.label}`}
        </Chip>
        <Chip tone="violet">{snapText}</Chip>
        <span className="nums text-[11px] text-slate-400">
          现在 {clock} · 数据 {timeAgo(data.generatedAt)}（{data.generatedAt.slice(11, 19)}）· 约 {nextIn} 秒后再拉
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load(true)} loading={busy}>刷新</Button>
          <PermissionGate code="menu:market-data:quotes">
            <Button size="sm" variant="outline" onClick={rebuild}>重建全市场快照</Button>
          </PermissionGate>
        </div>
      </div>

      {progress?.state === "running" && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          快照构建中：{progress.step}（{progress.done}
          {progress.total ? ` / ${progress.total}` : ""} 只）—— 全市场 5500+ 只要翻 56 页，约 1 分钟
        </div>
      )}

      {/* 核心指数 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {data.indexes.map((ix) => (
          <div key={ix.symbol}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-xs text-slate-500 dark:text-slate-400">{ix.label}</span>
              <span className="nums shrink-0 text-[10px] text-slate-400">{ix.time || ix.date}</span>
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("nums text-xl font-semibold leading-tight",
                  TONE[dirOf(ix.change_percent)].text)}>{num(ix.price, 2)}</p>
                <p className="nums mt-0.5 text-xs">
                  <UpDown value={ix.change_percent} />
                  <span className={cn("ml-1", TONE[dirOf(ix.change_price)].text)}>
                    {ix.change_price > 0 ? "+" : ""}{num(ix.change_price, 2)}
                  </span>
                </p>
              </div>
              <SparkLine values={ix.spark ?? []} up={ix.change_percent >= 0} width={104} height={34} />
            </div>
            <dl className="nums mt-2 grid grid-cols-4 gap-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div><span className="opacity-70">开</span> {ix.open.toFixed(2)}</div>
              <div><span className="opacity-70">高</span> {ix.high.toFixed(2)}</div>
              <div><span className="opacity-70">低</span> {ix.low.toFixed(2)}</div>
              <div className="whitespace-nowrap" title={`${ix.label}成交额 ${money(ix.amount)}`}>
                <span className="opacity-70">额</span> {ix.amount ? `${(ix.amount / 1e8).toFixed(0)}亿` : "—"}
              </div>
            </dl>
          </div>
        ))}
      </div>

      {/* 情绪 / 涨跌分布 / 涨停梯队 */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel title="市场情绪六维" subtitle={e.meaning} className="xl:col-span-3">
          <div className="flex flex-col items-center gap-3">
            <div className="flex w-full items-center gap-3">
              <span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-xl text-white",
                EMOTION_TONE[e.band] ?? "bg-slate-300")}>
                <span className="text-[15px] font-bold">{e.score === null ? "—" : e.score.toFixed(1)}</span>
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold">{e.label}</p>
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{e.meaning}</p>
              </div>
            </div>
            <EmotionRadar dims={e.dimList} score={e.score} size={170} />
            <ul className="w-full space-y-1 text-[11px]">
              {e.dimList.map((d) => (
                <li key={d.key} className="flex items-center gap-2" title={d.how}>
                  <span className="w-14 shrink-0 truncate text-slate-500 dark:text-slate-400">{d.label}</span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <span className={cn("absolute inset-y-0 left-0 rounded-full",
                      d.score === null ? "bg-slate-300 dark:bg-slate-700" : "bg-rose-500")}
                      style={{ width: `${d.score ?? 0}%` }} />
                  </span>
                  <span className="nums w-10 shrink-0 text-right text-slate-600 dark:text-slate-300">
                    {d.score === null ? "待补" : d.score.toFixed(1)}
                  </span>
                  <span className="nums w-7 shrink-0 text-right text-slate-400">{Math.round(d.weight * 100)}%</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-slate-400">
              口径：{e.source === "market_daily" ? "收盘全市场快照" : "实时可得部分"}；右侧为维度权重
            </p>
          </div>
        </Panel>

        <Panel title="涨跌分布" subtitle={`全市场 ${b.total ?? "—"} 只（含北交所）· ${tradeDate(b.tradeDate ?? data.tradeDate)}`}
          className="xl:col-span-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="上涨" value={b.up} tone="up" suffix="只" />
            <Stat label="平盘" value={b.flat} tone="flat" suffix="只" />
            <Stat label="下跌" value={b.down} tone="down" suffix="只" />
          </div>
          <div className="mt-3">
            {b.up !== null && b.down !== null && b.flat !== null ? (
              <BreadthBar up={b.up} flat={b.flat} down={b.down} />
            ) : <Skeleton className="h-2.5" />}
            <p className="mt-1 text-center text-[11px] text-slate-500 dark:text-slate-400">
              上涨占比 {b.upRatio === null ? "—" : `${b.upRatio.toFixed(1)}%`} ·
              涨跌比 {b.advanceDeclineRatio ?? "—"} ·
              赚钱效应 {(b.upRatio ?? 0) >= 60 ? "强" : (b.upRatio ?? 0) >= 45 ? "中性" : "弱"}
            </p>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
            <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
              13 档分布（{b.bucketTotal ?? 0} 只参与统计，涨幅 ≥9.7% 计涨停）
            </p>
            {b.buckets && b.buckets.length
              ? <BucketHistogram buckets={b.buckets} height={92} />
              : <EmptyState text="快照里没有个股涨跌幅，无法分档" hint="点右上角「重建全市场快照」" />}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="涨停" value={b.limitUp ?? b.limitUpFromBuckets ?? null} tone="up" suffix="只" />
            <Stat label="炸板" value={b.blown} tone="flat" suffix="只" />
            <Stat label="跌停" value={b.limitDown ?? b.limitDownFromBuckets ?? null} tone="down" suffix="只" />
            <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">封板率</p>
              <p className={cn("nums text-lg font-semibold",
                (b.sealRate ?? 0) >= 70 ? "text-rose-500" : (b.sealRate ?? 0) >= 50 ? "text-amber-500" : "text-emerald-500")}>
                {b.sealRate === null ? "—" : `${b.sealRate.toFixed(0)}%`}
              </p>
            </div>
          </div>
          <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <Row k="两市成交额" v={b.amount === null ? "—" : yi(b.amount)} />
            <Row k="成交额环比上一日" v={b.amountVsPrev === null ? "待更新" : pct(b.amountVsPrev)} tone={b.amountVsPrev} />
            <Row k="站上 MA20" v={ratioText(t.ma20AboveRatio)} />
            <Row k="60 日新高 / 新低" v={`${t.newHigh ?? "—"} / ${t.newLow ?? "—"}（全量 ${t.sampleTotal ?? "—"} 只）`} />
          </dl>
        </Panel>

        <Panel title="涨停梯队"
          subtitle={`最高 ${data.ladder.maxLbc} 板 · 共 ${data.ladder.total} 只 · 首板 ${data.ladder.firstBoardCount} 只`}
          className="xl:col-span-4">
          {data.ladder.tiers.length === 0 ? (
            <EmptyState text="当天没有涨停池数据" hint="休市日或数据源未返回，重建快照后再看" />
          ) : (
            <ul className="space-y-2">
              {data.ladder.tiers.map((tier) => {
                const seal = tier.stocks.reduce((s, x) => s + (x.sealFund ?? 0), 0);
                return (
                  <li key={tier.level} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={cn("nums rounded px-1.5 py-0.5 text-[11px] font-semibold text-white",
                        tier.level >= 3 ? "bg-rose-600" : tier.level === 2 ? "bg-orange-500" : "bg-slate-500")}>
                        {tier.level} 板
                      </span>
                      <span className="text-[11px] text-slate-500">{tier.count} 只</span>
                      {seal > 0 && (
                        <span className="nums ml-auto text-[11px] text-slate-400">封单 {money(seal)}</span>
                      )}
                      {tier.level === data.ladder.maxLbc && tier.level >= 2 && (
                        <Chip tone="rose" className="ml-auto">最高板</Chip>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tier.stocks.map((s) => (
                        <span key={s.symbol}
                          title={`${s.name} 现价 ${s.price} 封单 ${money(s.sealFund ?? null)} 首封 ${s.firstSeal ?? "—"} ${s.sector ?? ""}`}
                          className="nums rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                          {s.name} <span className="opacity-70">{s.changePercent.toFixed(1)}%</span>
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* 趋势强度 / 日内走势 */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel title="趋势强度" subtitle={t.available ? `站上均线比例 · ${tradeDate(t.trade_date ?? data.tradeDate)}` : "待收盘快照"}
          className="xl:col-span-4">
          {!t.available ? (
            <EmptyState text={t.note ?? "还没有收盘快照"} hint="重建快照后这里会给出全市场站上 5/20/60 日线比例" />
          ) : (
            <div className="space-y-3">
              <RatioRow label="站上 5 日线" value={t.ma5AboveRatio} hint="短线情绪：一半以上票在 5 日线上代表普涨可追" />
              <RatioRow label="站上 20 日线" value={t.ma20AboveRatio} hint="中期趋势：情绪六维里的「均线分布」用的就是这一档" />
              <RatioRow label="站上 60 日线" value={t.ma60AboveRatio} hint="长期趋势：跌破说明中线资金撤退" />
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="60 日新高" value={t.newHigh} tone="up" suffix="只" />
                <Stat label="60 日新低" value={t.newLow} tone="down" suffix="只" />
                <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60"
                  title="情绪六维中的「趋势强度」维度分：三大指数加权涨跌幅线性映射，占综合情绪 20% 权重">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">趋势维度</p>
                  <p className={cn("nums text-lg font-semibold",
                    (e.dims.trend ?? 0) >= 60 ? "text-rose-500" : (e.dims.trend ?? 0) >= 45 ? "text-amber-500" : "text-emerald-500")}>
                    {e.dims.trend ?? "—"}
                  </p>
                </div>
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {t.note}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="日内走势"
          subtitle={`${data.intraday.name ?? "上证指数"} · ${tradeDate(data.tradeDate)} 分时（价格线 + 均价线 + 单分钟量）`}
          className="xl:col-span-8">
          {data.intraday.points.length > 1 ? (
            <>
              <IntradayLine points={data.intraday.points} prevClose={data.intraday.prevClose} height={208} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                <LegendDot className="bg-rose-500" text="价格线（红涨绿跌，虚线=昨收）" />
                <LegendDot className="bg-sky-400" text="均价线（Σ价×单分钟量 ÷ Σ量）" />
                <LegendDot className="bg-rose-400/70" text="下方柱=单分钟成交量" />
                <span className="nums ml-auto">
                  昨收 {data.intraday.prevClose === null ? "—" : data.intraday.prevClose.toFixed(2)} ·
                  最新 {data.intraday.points[data.intraday.points.length - 1].price.toFixed(2)} ·
                  {data.intraday.points.length} 点（已聚合抽样）
                </span>
              </div>
            </>
          ) : (
            <EmptyState text={data.intraday.error ? `分时拉取失败：${data.intraday.error}` : "当日无分时数据"}
              hint="休市时段腾讯分时接口只给最近交易日，拿不到就重建快照" />
          )}
        </Panel>
      </div>

      {/* 板块热度：行业 / 概念 */}
      <div className="grid gap-4 xl:grid-cols-2">
        <BoardPanel group={data.boards.industry} />
        <BoardPanel group={data.boards.concept} />
      </div>

      {/* 个股榜单 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RankList title="涨幅榜 TOP 8" rows={data.rankings.gainers} metric="change_percent"
          error={data.rankings.errors?.gainers} />
        <RankList title="跌幅榜 TOP 8" rows={data.rankings.losers} metric="change_percent"
          error={data.rankings.errors?.losers} />
        <RankList title="成交额榜 TOP 8" rows={data.rankings.amount} metric="amount"
          error={data.rankings.errors?.amount} />
        <RankList title="换手率榜 TOP 8" rows={data.rankings.turnover} metric="turnover_ratio"
          error={data.rankings.errors?.turnover} />
      </div>

      {/* 海外 / 商品 */}
      <div className="grid gap-4 xl:grid-cols-12">
        <GlobalPanel title="海外指数" rows={data.global.indexes}
          error={data.global.errors?.global_index} className="xl:col-span-7" cols={2} />
        <GlobalPanel title="商品与美元" rows={data.global.commodities}
          error={data.global.errors?.commodity} className="xl:col-span-5" cols={1} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <ScheduleAndSources data={data} onChange={() => void load(true)} hasPerm={hasPerm} className="xl:col-span-6" />
        <MethodNotes data={data} className="xl:col-span-6" />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- 子组件 */

function ratioText(v: number | null | undefined): string {
  if (typeof v !== "number") return "待更新";
  return `${(v * 100).toFixed(1)}%`;
}

function Stat({ label, value, tone, suffix }: {
  label: string; value: number | null | undefined; tone: "up" | "down" | "flat"; suffix: string;
}) {
  const text = tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-500" : "text-slate-500";
  return (
    <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums text-lg font-semibold", text)}>{value === null || value === undefined ? "—" : `${value}${suffix}`}</p>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: number | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className={cn("nums truncate font-medium", tone === undefined ? "" : tone === null ? "text-slate-400"
        : tone > 0 ? "text-rose-500" : tone < 0 ? "text-emerald-500" : "text-slate-500")}>{v}</dd>
    </div>
  );
}

function RatioRow({ label, value, hint }: { label: string; value: number | null | undefined; hint: string }) {
  const r = typeof value === "number" ? value : null;
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className={cn("nums font-semibold",
          r === null ? "text-slate-400" : r >= 0.5 ? "text-rose-500" : "text-emerald-500")}>
          {ratioText(r)}
        </span>
      </div>
      <span className="relative mt-1 block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", r === null ? "bg-slate-300 dark:bg-slate-700"
          : r >= 0.5 ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.max(1, (r ?? 0) * 100)}%` }} />
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
      </span>
    </div>
  );
}

function LegendDot({ className, text }: { className: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block h-1.5 w-3 rounded", className)} />
      {text}
    </span>
  );
}

function BoardPanel({ group, className }: { group: BoardGroup; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cons, setCons] = useState<ConstituentRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const opened = [...group.top, ...group.bottom].find((r) => r.code === open) ?? null;

  const toggle = (code: string) => {
    if (open === code) {
      setOpen(null);
      setCons(null);
      return;
    }
    setOpen(code);
    setCons(null);
  };

  const loadCons = async (code: string, name: string) => {
    setLoading(true);
    try {
      const r = await api.get<{ rows: ConstituentRow[] }>(
        `/market-data/boards/stocks?code=${encodeURIComponent(code)}&num=20`);
      setCons(r.rows);
      if (!r.rows.length) toast(`${name} 没有返回成分股`, "warn");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title={`${group.kindLabel}（${group.kind === "concept" ? "特色/概念" : "证监会行业"}）`}
      subtitle={`${tradeDate(group.tradeDate)} · ${group.count} 个板块，涨 ${group.upCount} / 跌 ${group.downCount} · 点板块看板块内领涨领跌`}
      className={className}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium text-rose-500">领涨板块</p>
          <ul className="space-y-1">
            {group.top.map((r) => (
              <BoardRowView key={r.code} r={r} active={open === r.code} onToggle={() => toggle(r.code)} />
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-emerald-500">领跌板块</p>
          <ul className="space-y-1">
            {group.bottom.map((r) => (
              <BoardRowView key={r.code} r={r} active={open === r.code} onToggle={() => toggle(r.code)} />
            ))}
          </ul>
        </div>
      </div>

      {opened && (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">{opened.name}</span>
            <span className={cn("nums text-[11px] font-medium",
              (opened.changePercent ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
              {(opened.changePercent ?? 0).toFixed(2)}%
            </span>
            <Chip tone="slate">{opened.stockCount ?? "—"} 只成分</Chip>
            {opened.amount !== null && <Chip tone="sky">成交 {money(opened.amount)}</Chip>}
            {opened.leaderName && (
              <Chip tone="rose">
                龙头 {opened.leaderName} {opened.leaderChange === null ? "—" : `${opened.leaderChange.toFixed(2)}%`}
                {opened.leaderLocal ? "（本地快照）" : ""}
              </Chip>
            )}
            <Button size="sm" variant="outline" className="ml-auto" loading={loading}
              onClick={() => void loadCons(opened.code, opened.name)}>拉成分股</Button>
            <Button size="sm" variant="ghost" onClick={() => toggle(opened.code)}>收起</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {opened.moversNote && (
              <p className="sm:col-span-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                {opened.moversNote}——想核对原始名单可以点上面「拉成分股」，龙头沿用热度接口给的值
              </p>
            )}
            <MoverList label="板块内领涨" rows={opened.movers.up} note={opened.moversNote} />
            <MoverList label="板块内领跌" rows={opened.movers.down} note={opened.moversNote} />
          </div>
          {cons && (
            <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
              <p className="mb-1 text-[11px] text-slate-500">
                新浪成分股（{opened.name}，按涨幅取前 {cons.length} 只）
              </p>
              <DataTable
                dense
                maxHeight="max-h-48"
                columns={[
                  { key: "name", label: "名称", render: (r: ConstituentRow) => (
                    <span>{r.name}<span className="ml-1 text-[10px] text-slate-400">{r.symbol}</span></span>) },
                  { key: "trade", label: "现价", align: "right", render: (r: ConstituentRow) => r.trade },
                  { key: "changepercent", label: "涨幅", align: "right",
                    value: (r: ConstituentRow) => r.changepercent,
                    render: (r: ConstituentRow) => <UpDown value={r.changepercent} /> },
                  { key: "turnoverratio", label: "换手", align: "right",
                    render: (r: ConstituentRow) => `${r.turnoverratio.toFixed(2)}%` },
                ]}
                rows={cons}
                rowKey={(r: ConstituentRow) => r.symbol}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function BoardRowView({ r, active, onToggle }: {
  r: BoardRow; active: boolean; onToggle: () => void;
}) {
  const up = (r.changePercent ?? 0) >= 0;
  const leader = r.leaderName
    ? `${r.leaderName}${r.leaderChange === null ? "" : ` 涨 ${r.leaderChange.toFixed(1)}%`}`
    : "";
  return (
    <li>
      <button type="button" onClick={onToggle}
        className={cn("group flex w-full items-center gap-x-1.5 rounded-md px-1.5 py-1 text-left transition",
          active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60")}>
        <span title={r.name}
          className="w-[112px] shrink-0 break-words whitespace-normal text-xs leading-tight text-slate-600 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
          {r.name}
        </span>
        <span className={cn("nums w-11 shrink-0 text-right text-xs font-semibold",
          r.changePercent === null ? "text-slate-400" : up ? "text-rose-500" : "text-emerald-500")}>
          {r.changePercent === null ? "—" : `${r.changePercent.toFixed(2)}%`}
        </span>
        <span className="nums w-8 shrink-0 text-right text-[11px] text-slate-400">{r.stockCount ?? "—"}只</span>
        {/* 龙头只写名字，涨幅放进 title 和展开后的领跌榜，窄栏里不挤掉字 */}
        <span title={leader}
          className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-500 dark:text-slate-400">
          {leader}
        </span>
        <span className="shrink-0 text-[10px] text-slate-400">{active ? "▲" : "▼"}</span>
      </button>
    </li>
  );
}

function MoverList({ label, rows, note }: { label: string; rows: BoardMover[]; note?: string | null }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-slate-500">{label}</p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          {note ?? "本地快照里没有这个板块的成分，先重建快照"}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((m) => (
            <li key={m.name} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-600 dark:text-slate-300">{m.name}</span>
              <span className="nums shrink-0 text-slate-400">{m.amount === null ? "" : money(m.amount)}</span>
              <UpDown value={m.changePercent} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RankList({ title, rows, metric, error }: {
  title: string; rows: RankedStock[]; metric: "change_percent" | "amount" | "turnover_ratio";
  error?: string;
}) {
  return (
    <Panel title={title} subtitle={error ?? `共 ${rows.length} 只`}>
      {rows.length === 0 ? (
        <EmptyState text={error ?? "该榜单暂无数据"} hint="休市时段源可能不返回实时排行，可用重建快照兜底" />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.slice(0, 8).map((r, i) => (
            <li key={r.symbol} className="flex items-center gap-2 py-1.5 text-xs">
              <span className={cn("nums w-4 shrink-0 text-center text-[11px] font-semibold",
                i < 3 ? "text-rose-500" : "text-slate-400")}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                <span className="ml-1 text-[10px] text-slate-400">{r.code || r.symbol}</span>
              </span>
              <span className="nums w-12 shrink-0 text-right text-slate-500">{r.price.toFixed(2)}</span>
              <span className="nums w-14 shrink-0 text-right">
                {metric === "change_percent"
                  ? <UpDown value={r.change_percent} strong={false} />
                  : metric === "amount"
                    ? <span className="text-[11px] text-slate-500">{money(r.amount)}</span>
                    : <span className="text-[11px] text-slate-500">{r.turnover_ratio.toFixed(2)}%</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function GlobalPanel({ title, rows, error, className, cols }: {
  title: string; rows: GlobalQuote[]; error?: string; className?: string; cols: 1 | 2;
}) {
  return (
    <Panel title={title} subtitle={error ? `拉取失败：${error}` : `${rows.length} 个标的 · 新浪行情，非交易时段为上一收盘价`}
      className={className}>
      {rows.length === 0 ? (
        <EmptyState text={error ?? "没有取到海外行情"} hint="本机网络到新浪 hq 接口不通时这里会空" />
      ) : (
        <ul className={cn("grid gap-x-4 gap-y-0.5", cols === 2 ? "sm:grid-cols-2" : "")}>
          {rows.map((g) => (
            <li key={g.code} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 text-xs last:border-0 dark:border-slate-800">
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{g.name || g.code}</span>
              <span className="nums w-20 shrink-0 text-right text-slate-700 dark:text-slate-200">
                {g.price === null ? "—" : g.price.toFixed(2)}
              </span>
              <span className="w-16 shrink-0 text-right"><UpDown value={g.change_percent} strong={false} /></span>
              <span className="nums w-14 shrink-0 text-right text-[10px] text-slate-400">{g.time ?? g.date ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MethodNotes({ data, className }: { data: Overview; className?: string }) {
  const t = data.trend;
  return (
    <Panel title="口径与方法说明" subtitle="数字怎么来的，避免看图说话时对不上" className={className}>
      <div className="space-y-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <div>
          <p className="font-medium text-slate-600 dark:text-slate-300">六维情绪分（0–100）</p>
          <ul className="mt-1 space-y-1">
            {data.emotion.dimList.map((d) => (
              <li key={d.key} className="flex gap-2">
                <span className="w-16 shrink-0 text-slate-600 dark:text-slate-300">{d.label}</span>
                <span className="nums w-8 shrink-0 text-right">{Math.round(d.weight * 100)}%</span>
                <span className="min-w-0 flex-1">{d.how}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1">分档：≥75 亢奋 / 60–75 活跃 / 45–60 温和 / 30–45 低迷 / &lt;30 冰点。</p>
        </div>
        <div>
          <p className="font-medium text-slate-600 dark:text-slate-300">涨跌分布</p>
          <p>13 档按个股涨跌幅区间统计（平盘单列，|涨跌|&lt;0.005% 归平盘）。
            「涨停附近」= 涨幅 ≥10% 的所有个股，而上方法卡里的涨停数按各板真实涨停价判定
            （主板 10%、创业板/科创板 20%、北交所 30%、ST 5%）：创业/科创涨 10%~19.9% 的票进得了这一档却远没涨停，
            主板封在涨停价、涨幅四舍五入只有 9.9x% 的又落在 ≥9.7% 口径里。
            实测 2026-10-23：≥10% 共 122 只（其中创业板 42、北交所 7），涨停池 82 只。</p>
        </div>
        <div>
          <p className="font-medium text-slate-600 dark:text-slate-300">趋势强度</p>
          <p>{t.note ?? "站上均线比例来自本地日线缓存全量个股（5500+ 只），不是抽样。"}
            {' '}60 日新高/新低与均线同口径、同一份日线序列算出。</p>
        </div>
        <div>
          <p className="font-medium text-slate-600 dark:text-slate-300">板块龙头</p>
          <p>板块涨幅与热度取新浪行业/概念列表；龙头优先用本地全市场快照现算的板块内涨幅第一名，
            标注「本地快照」时说明它与资金流接口给的名字不一致（资金流接口休市日会滞后一个交易日）。
            证监会行业里有些 node 的成分名单和别的行业大面积重合（实测「黑色金属冶炼」node 返回的是造纸股名单），
            这类板块会自动隐藏本地领涨领跌、退回热度接口的龙头，避免把乳制品股说成钢铁股。</p>
        </div>
        <div>
          <p className="font-medium text-slate-600 dark:text-slate-300">分时图</p>
          <p>腾讯分时返回的成交量是累计值，这里先差分回单分钟量，均价线用 Σ(价×单分钟量)÷Σ量 计算；
            超过 90 个点时按区间聚合，保留区间内最后一分钟价格。</p>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          所有数据仅供复盘研究，不构成投资建议；指数与个股行情均有延迟，实盘请以券商行情为准。
        </p>
      </div>
    </Panel>
  );
}

function ScheduleAndSources({
  data, onChange, hasPerm, className,
}: {
  data: Overview; onChange: () => void; hasPerm: (c: string) => boolean; className?: string;
}) {
  const [cfg, setCfg] = useState(data.schedule);
  const [saving, setSaving] = useState(false);
  useEffect(() => setCfg(data.schedule), [data.schedule]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ config: typeof cfg; scheduler: { jobs?: { name: string; nextRun: string | null }[] } }>(
        "/dashboard/global-schedule", cfg);
      toast(`已保存，下次自动刷新 ${r.scheduler?.jobs?.[0]?.nextRun ?? "见任务列表"}`, "ok");
      onChange();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const editable = hasPerm("menu:dashboard") && hasPerm("settings:general:update");
  const ds = data.dataSources;

  return (
    <Panel title="数据调度 / 数据源" subtitle="每日收盘后自动刷新，可改时间与频率" className={className}>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <span className="text-xs">
            <span className="font-medium">全局调度开关</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">{cfg.note ?? "交易日定时刷新行情/板块/指数/涨停池"}</span>
          </span>
          <input type="checkbox" checked={!!cfg.enabled} disabled={!editable}
            onChange={(ev) => setCfg({ ...cfg, enabled: ev.target.checked })}
            className="h-4 w-4 accent-rose-600" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-500">
            每日刷新时间
            <input className={cn(inputClass, "mt-1 py-1 text-xs")} type="time" value={cfg.daily_time}
              disabled={!editable} onChange={(ev) => setCfg({ ...cfg, daily_time: ev.target.value })} />
          </label>
          <label className="text-[11px] text-slate-500">
            盘中刷新（分钟，0=关）
            <input className={cn(inputClass, "mt-1 py-1 text-xs")} type="number" min={0} max={60} value={cfg.intraday_interval_min}
              disabled={!editable} onChange={(ev) => setCfg({ ...cfg, intraday_interval_min: Number(ev.target.value) })} />
          </label>
        </div>
        {editable && <Button size="sm" onClick={save} loading={saving}>保存调度设置</Button>}

        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">数据源健康</span>
            <Chip tone={ds.error ? "rose" : ds.healthy === 100 ? "emerald" : "amber"}>
              {ds.ok} 正常 / {ds.error} 异常 / {ds.unknown} 未探测
            </Chip>
          </div>
          <ul className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
            {ds.providers.map((p) => (
              <li key={p.provider} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-500 dark:text-slate-400">{p.label}</span>
                <span className={cn(p.enabled === false ? "text-slate-400 line-through" : "text-emerald-600",
                  "nums shrink-0")}>
                  {p.enabled === false ? "停用" : `优先级 ${p.priority ?? "—"}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-slate-400">
            本机实测：东财 push2 实时列表与 push2his 的 K线/分时都是 HTTP 502，快照与日线主源已改新浪、
            分时用腾讯兜底，东财只留涨跌停池
          </p>
        </div>
      </div>
    </Panel>
  );
}

function Banner({ tone, children }: { tone: "rose" | "amber" | "sky"; children: ReactNode }) {
  const map = {
    rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  };
  return <div className={cn("rounded-xl border px-4 py-2 text-xs", map[tone])}>{children}</div>;
}
