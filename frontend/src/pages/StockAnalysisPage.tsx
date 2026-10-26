import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { AnalysisLevel, PricePrediction, SearchHit, StockDetail, StockNews } from "../lib/types";
import { clock, money, num, price, tradeDate } from "../lib/format";
import { FundFlowChart, IntradayLine, KlineChart } from "../components/charts";
import {
  Button, Chip, DataTable, EmptyState, Field, Markdown, Panel, Skeleton, Spinner,
  UpDown, cn, inputClass,
} from "../components/ui";
import { toast } from "../store/toast";

const RECENT_KEY = "tsp-saas.stock-analysis.recent";
const DAY_CHOICES = [60, 120, 250] as const;

type F = Record<string, number | string | boolean | null>;

/* ============================================================ 入口页 */

export function StockAnalysisEntry() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent] = useState<SearchHit[]>(() => readRecent());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const kw = keyword.trim();
    if (timer.current) window.clearTimeout(timer.current);
    if (!kw) { setHits([]); setSearching(false); return; }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ rows: SearchHit[]; snapshotReady?: boolean }>(
          "/stock-analysis/search", { keyword: kw, limit: 20 });
        setHits(r.rows);
        setError(null);
      } catch (e) {
        setError(messageOf(e));
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [keyword]);

  const open = (sym: string, name?: string) => {
    if (name) pushRecent({ symbol: sym, name, price: null, change_percent: null });
    navigate(`/stock-analysis/${sym}`);
  };

  return (
    <div className="space-y-4">
      <Panel title="股票分析" subtitle="输入代码或名称，进来就是 K 线 + 技术面 + 支撑压力 + 消息面 + AI 诊断">
        <Field label="搜索股票" hint="支持 600519 / sh600519 / 贵州茅台；先查本地全市场快照，再回落新浪联想">
          <input autoFocus className={inputClass} value={keyword}
            placeholder="比如 贵州茅台 / 600519 / 300750"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) void open(hits[0].symbol, hits[0].name); }} />
        </Field>

        {searching && <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Spinner />搜索中…</p>}
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}

        {!keyword.trim() && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-slate-500 dark:text-slate-400">最近搜索（本地存 10 条，清缓存在个人资料页）</p>
            {recent.length === 0 ? (
              <p className="text-xs text-slate-400">还没有搜索记录，先搜一只试试</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {recent.map((r) => (
                  <button key={r.symbol} type="button" onClick={() => void open(r.symbol)}
                    className="nums rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500">
                    {r.name} <span className="text-slate-400">{r.symbol}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!!keyword.trim() && hits.length > 0 && (
          <div className="mt-3">
            <DataTable dense maxHeight="max-h-72" rows={hits} rowKey={(r) => r.symbol}
              sortInitial={{ key: "change_percent", desc: true }}
              onRowClick={(r) => void open(r.symbol, r.name)}
              columns={[
                { key: "name", label: "名称", render: (r) => (
                  <span>{r.name}<span className="nums ml-1.5 text-[10px] text-slate-400">{r.symbol}</span>
                    {r.matched === "code-guess" && <Chip className="ml-1.5" tone="sky">按代码推断</Chip>}</span>) },
                { key: "price", label: "现价", align: "right", value: (r) => r.price,
                  render: (r) => <span className="nums">{r.price === null ? "—" : r.price.toFixed(2)}</span> },
                { key: "change_percent", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
                  render: (r) => <UpDown value={r.change_percent} /> },
                { key: "ops", label: "", align: "right", render: (r) => (
                  <Button size="sm" onClick={() => void open(r.symbol, r.name)}>深度分析</Button>) },
              ]} />
          </div>
        )}
        {!!keyword.trim() && hits.length === 0 && !searching && (
          <EmptyState text="没匹配到股票" hint="快照没建好时只能按 6 位代码识别" />
        )}
      </Panel>
    </div>
  );
}

/* ============================================================ 详情页 */

export default function StockAnalysisPage() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [news, setNews] = useState<StockNews | null>(null);
  const [days, setDays] = useState<number>(120);
  const [chartTab, setChartTab] = useState<"kline" | "minute">("kline");
  const [showBoll, setShowBoll] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sym: string, d: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<StockDetail>("/stock-analysis/detail", { symbol: sym, days: d }, 40_000);
      setDetail(r);
      if (!r.ok) setError(r.message ?? "行情与 K 线都没取到");
      const knownErrors = Object.entries(r.errors ?? {});
      if (knownErrors.length) setError(knownErrors.map(([k, v]) => `${k}：${v}`).join("；"));
    } catch (e) {
      setError(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!symbol) return;
    void load(symbol, days);
    pushRecentSeen(symbol);
  }, [symbol, days, load]);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setNews(null);
    void api.get<StockNews>("/stock-analysis/news", { symbol }, 40_000)
      .then((r) => { if (alive) setNews(r); })
      .catch(() => { /* 消息面失败不挡主内容，错误条已提示 */ });
    return () => { alive = false; };
  }, [symbol]);

  if (!symbol) return <StockAnalysisEntry />;

  const feat = (detail?.features ?? {}) as F;
  const quote = detail?.quote ?? null;

  return (
    <div className="space-y-4">
      <Panel
        title={detail ? `${detail.name} ${detail.code}` : "加载中"}
        subtitle={detail
          ? `${detail.symbol} · 快照 ${tradeDate(detail.tradeDate)} · 涨跌停幅度 ${(detail.limitRate * 100).toFixed(0)}%` +
            `${detail.boards.length ? ` · ${detail.boards.map((b) => b.board_name).slice(0, 4).join(" / ")}` : ""}`
          : "正在拉行情、K 线与技术指标…"}
        right={(
          <>
            <input className={cn(inputClass, "h-8 w-40 py-1 text-xs")}
              placeholder="换一只：600519 / 名称"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) { (e.target as HTMLInputElement).value = ""; void resolveAndGo(v, navigate); }
              }} />
            <Button size="sm" variant="outline" loading={busy} onClick={() => void load(symbol, days)}>重新拉取</Button>
          </>
        )}
      >
        {detail ? <QuoteHead detail={detail} /> : busy ? <Skeleton className="h-20" /> : null}
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* K 线 / 分时 */}
        <div className="xl:col-span-8">
          <Panel
            title={chartTab === "kline" ? "专业 K 线量价" : "分时走势"}
            subtitle={chartTab === "kline"
              ? `近 ${days} 个交易日 · MA5/10/20/60 + 布林带 + 成交量，鼠标悬停看逐日 OHLC`
              : "当日分钟级走势（收盘日为最后一根）"}
            right={(
              <>
                <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
                  {(["kline", "minute"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setChartTab(k)}
                      className={cn("px-2 py-1 text-xs", chartTab === k
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                      {k === "kline" ? "日K" : "分时"}
                    </button>
                  ))}
                </div>
                {chartTab === "kline" && DAY_CHOICES.map((d) => (
                  <Button key={d} size="sm" variant={days === d ? "primary" : "outline"} onClick={() => setDays(d)}>{d}日</Button>
                ))}
                {chartTab === "kline" && (
                  <Button size="sm" variant={showBoll ? "primary" : "outline"} onClick={() => setShowBoll((v) => !v)}>BOLL</Button>
                )}
              </>
            )}>
            {busy && !detail && <div className="space-y-2"><Skeleton className="h-56" /><Skeleton className="h-8" /></div>}
            {detail && chartTab === "kline" && (
              detail.bars.length < 2 ? (
                <EmptyState text="没有日线数据" hint="新股/停牌或上游 K 线接口失败，看上面的错误提示" />
              ) : (
                <KlineChart bars={detail.bars} height={330} count={Math.min(days, 160)}
                  ma={[5, 10, 20, 60]} boll={showBoll} withVolume
                  levels={(detail.levels ?? []).filter((l) => l.kind === "轴").slice(0, 1)} />
              )
            )}
            {detail && chartTab === "minute" && (
              (detail.minute ?? []).length < 2 ? (
                <EmptyState text="没有分时数据" hint="休市日或分时源（腾讯）未返回" />
              ) : (
                <IntradayLine
                  points={(detail.minute ?? []).map((p) => ({
                    t: clock(p.time), price: p.price, avg: p.avg_price, volume: p.volume,
                  }))}
                  prevClose={toNum(quote?.prev_close ?? detail.snapshot?.prev_close)}
                  height={300} />
              )
            )}
          </Panel>
        </div>

        {/* 技术面量价 */}
        <div className="space-y-4 xl:col-span-4">
          <Panel title="技术面与量价" subtitle="全部由本地日线计算，指标缺历史时显示待更新">
            {busy && !detail ? <Skeleton className="h-52" /> : detail ? <TechGrid feat={feat} detail={detail} /> : null}
          </Panel>
          <Panel title="点位提醒" subtitle="只报离现价 6% 以内的关键位，远处的支撑够不着">
            {!detail ? <Skeleton className="h-32" /> : (
              <ul className="space-y-1.5">
                {(detail.alerts ?? []).map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]">
                    <Chip tone={a.kind === "压力" ? "rose" : a.kind === "支撑" ? "emerald" : "sky"} className="mt-0.5 shrink-0">
                      {a.kind === "limit" ? "次日" : a.kind === "压力" ? "压力" : a.kind === "支撑" ? "支撑" : a.kind}
                    </Chip>
                    <span className="min-w-0 text-slate-700 dark:text-slate-300">{a.text}</span>
                  </li>
                ))}
                {(detail.alerts ?? []).length === 0 && <EmptyState text="没有临近点位" />}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <LevelsPanel levels={detail?.levels ?? []} priceNow={detail?.price ?? null} pivot={detail?.pivot ?? null} />
        </div>
        <div className="space-y-4 xl:col-span-7">
          <GuidePanel detail={detail} feat={feat} />
          <FundFlowPanel detail={detail} />
        </div>
      </div>

      <NewsPanel news={news} busy={busy} symbol={symbol} />

      {detail && (
        <div className="grid gap-4 xl:grid-cols-2">
          <AiDiagnosePanel symbol={detail.symbol} name={detail.name} />
          <AiPredictPanel symbol={detail.symbol} name={detail.name} priceNow={detail.price} />
        </div>
      )}

      {detail && !!detail.limitHistory.length && (
        <Panel title="近期涨停记录" subtitle="来自本地涨停/炸板/跌停三池（当前覆盖近 6 个交易日）">
          <DataTable dense maxHeight="max-h-64" rows={detail.limitHistory} rowKey={(r) => `${r.trade_date}-${r.kind}`}
            columns={[
              { key: "trade_date", label: "日期", render: (r) => <span className="nums">{tradeDate(r.trade_date)}</span> },
              { key: "kind", label: "池", render: (r) => (
                <Chip tone={r.kind === "up" ? "rose" : r.kind === "down" ? "emerald" : "amber"}>
                  {r.kind === "up" ? "涨停" : r.kind === "down" ? "跌停" : "炸板"}
                </Chip>) },
              { key: "lbc", label: "板数", align: "right", render: (r) => (
                <span className="nums">{r.lbc === null ? "—" : r.kind === "down" ? `${r.lbc} 天跌停` : `${r.lbc} 板`}</span>) },
              { key: "stat", label: "涨停统计", render: (r) => <span className="nums text-[11px] text-slate-500">{r.stat || "—"}</span> },
              { key: "fbt", label: "首封", align: "right", render: (r) => <span className="nums">{r.fbt ?? "—"}</span> },
              { key: "zb_count", label: "开板次数", align: "right", render: (r) => (
                <span className="nums">{r.zb_count ?? 0} 次</span>) },
              { key: "fund", label: "封单", align: "right", render: (r) => <span className="nums text-slate-500">{money(r.fund ?? null)}</span> },
              { key: "sector", label: "行业", render: (r) => <span className="text-[11px] text-slate-500">{r.sector ?? "—"}</span> },
            ]} />
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ 子模块 */

function QuoteHead({ detail }: { detail: StockDetail }) {
  const q = detail.quote;
  const snap = detail.snapshot ?? {};
  const p = (k: string) => (snap[k] as number | undefined) ?? null;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div>
        <p className={cn("nums text-3xl font-semibold",
          (q?.change_percent ?? 0) > 0 ? "text-rose-500" : (q?.change_percent ?? 0) < 0 ? "text-emerald-500" : "text-slate-700 dark:text-slate-200")}>
          {price(detail.price)}
        </p>
        <p className="nums mt-0.5 text-xs">
          <UpDown value={q?.change_percent ?? p("change_percent") ?? null} />
          <span className="ml-1.5 text-slate-500 dark:text-slate-400">
            {num(q?.change_price ?? p("change_price") ?? null, 2, " 元")} · {q?.time ?? "—"}
          </span>
        </p>
      </div>
      <dl className="nums grid flex-1 grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-4 lg:grid-cols-6 dark:text-slate-400">
        {[
          ["今开", price(q?.open ?? p("open"))],
          ["最高", price(q?.high ?? p("high"))],
          ["最低", price(q?.low ?? p("low"))],
          ["昨收", price(q?.prev_close ?? p("prev_close"))],
          ["成交额", money(q?.amount ?? p("amount"))],
          ["成交量", q?.volume ? `${(q.volume / 1e6).toFixed(1)}万手` : "—"],
          ["换手", num(p("turnover_ratio"), 2, "%")],
          ["量比", num(detail.features.vol_ratio as number | null, 2)],
          ["PE", num(p("pe"), 2)],
          ["PB", num(p("pb"), 2)],
          ["流通市值", p("nmc_cap") ? `${(p("nmc_cap")! / 1e8).toFixed(1)}亿` : "—"],
          ["总市值", p("mkt_cap") ? `${(p("mkt_cap")! / 1e8).toFixed(1)}亿` : "—"],
        ].map(([k, v]) => (
          <div key={k as string}><dt className="opacity-70">{k as string}</dt><dd className="text-slate-700 dark:text-slate-200">{v as string}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function boolText(v: unknown, yes: string, no: string) {
  return v === true ? yes : v === false ? no : "待更新";
}

/** 0~1 的小数比例转百分，缺数据不显示 0% */
function pct01(v: unknown) {
  const n = toNum(v);
  return n === undefined ? "—" : `${(n * 100).toFixed(1)}%`;
}

function TechGrid({ feat, detail }: { feat: F; detail: StockDetail }) {
  const rows: { k: string; v: string; tone?: "up" | "down" | undefined }[] = [
    { k: "均线排列", v: boolText(feat.ma_bullish, "多头排列（MA5>MA10>MA20>MA60）", "非多头"), tone: feat.ma_bullish ? "up" : undefined },
    { k: "均线方向", v: boolText(feat.ma_all_up, "四条均线全向上", "有均线走平或向下"), tone: feat.ma_all_up ? "up" : undefined },
    { k: "站上 MA20", v: boolText(feat.above_ma20, "是", "否"), tone: feat.above_ma20 ? "up" : undefined },
    { k: "均线金叉", v: feat.ma_cross ? `近 ${feat.ma_cross_days ?? 0} 天前金叉` : "无近期金叉" },
    { k: "MACD", v: `${num(feat.macd_dif as number | null, 3)} / ${num(feat.macd_dea as number | null, 3)}，柱 ${num(feat.macd_hist as number | null, 3)}${feat.macd_cross ? " · 刚金叉" : ""}${feat.macd_above_zero ? " · 零轴上方" : ""}` },
    { k: "RSI14", v: num(feat.rsi14 as number | null, 1), tone: (feat.rsi14 as number) > 70 ? "up" : (feat.rsi14 as number) < 30 ? "down" : undefined },
    { k: "KDJ", v: `K ${num(feat.kdj_k as number | null, 1)} D ${num(feat.kdj_d as number | null, 1)} J ${num(feat.kdj_j as number | null, 1)}${feat.kdj_cross ? " · 金叉" : ""}` },
    { k: "布林位置", v: `${pct01(feat.boll_pos)} 下轨至 ${num(feat.boll_low as number | null)} / 上轨 ${num(feat.boll_up as number | null)}，带宽 ${num(feat.boll_width as number | null, 2)}%${feat.boll_break ? " · 突破上轨" : ""}` },
    { k: "量比", v: `${num(feat.vol_ratio as number | null, 2)}（5 日均量比 ${num(feat.vol_ratio_20 as number | null, 2)}）` },
    { k: "今日量能", v: feat.vol_vs_prev ? `是昨日的 ${num(feat.vol_vs_prev as number | null, 2)} 倍` : "待更新" },
    { k: "动量", v: `5日 ${num(feat.mom5 as number | null, 1, "%")} · 20日 ${num(feat.mom20 as number | null, 1, "%")}` },
    { k: "箱体", v: `20日 ${num(detail.features.l20 as number | null)}–${num(feat.h20 as number | null)}，宽度 ${num(feat.box_width as number | null, 1, "%")}` },
    { k: "距 60 日高", v: num(feat.drawdown_from_high60 as number | null, 2, "%"), tone: (feat.drawdown_from_high60 as number) > -3 ? "up" : undefined },
    { k: "波动率", v: `ATR ${num(feat.atr_pct as number | null, 2, "%")} · 20日波动 ${num(feat.vol20_pct as number | null, 2, "%")}` },
    { k: "涨停统计", v: `近 20 日 ${num(feat.limit_up_20 as number | null, 0)} 次${feat.days_since_limit !== null && feat.days_since_limit !== undefined ? `，距上次 ${feat.days_since_limit} 天` : ""}` },
    { k: "缺口", v: feat.gap_up ? `跳空高开 ${num(feat.gap_up as number | null, 2)}%${feat.gap_unfilled ? " · 未回补" : " · 已回补"}` : "无跳空" },
    { k: "量价背离", v: boolText(feat.divergence, "底背离（价新低量不新低）", "无"), tone: feat.divergence ? "up" : undefined },
    { k: "形态", v: feat.one_yang_three_yin ? "一阳三阴" : feat.shrink_after_limit ? "涨停后缩量" : "无明显形态" },
  ];
  return (
    <dl className="divide-y divide-slate-100 text-[12px] dark:divide-slate-800">
      {rows.map((r) => (
        <div key={r.k} className="flex items-start justify-between gap-3 py-1.5">
          <dt className="shrink-0 text-slate-500 dark:text-slate-400">{r.k}</dt>
          <dd className={cn("nums min-w-0 text-right", r.tone === "up" ? "text-rose-500"
            : r.tone === "down" ? "text-emerald-500" : "text-slate-700 dark:text-slate-200")}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LevelsPanel({ levels, priceNow, pivot }: {
  levels: AnalysisLevel[];
  priceNow: number | null;
  pivot: StockDetail["pivot"];
}) {
  const { up, down } = useMemo(() => ({
    up: levels.filter((l) => l.distance > 0).sort((a, b) => a.distance - b.distance),
    down: levels.filter((l) => l.distance <= 0).sort((a, b) => b.distance - a.distance),
  }), [levels]);
  const maxAbs = Math.max(1, ...levels.map((l) => Math.abs(l.distance)));
  const bar = (l: AnalysisLevel) => (
    <div key={`${l.kind}-${l.label}`} className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 truncate text-[11px] text-slate-500 dark:text-slate-400">{l.label}</span>
      <span className="nums w-16 shrink-0 text-right text-[12px]">{l.price.toFixed(2)}</span>
      <span className="relative h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
        <span className={cn("absolute top-0 h-full rounded", l.kind === "压力" ? "bg-rose-500/70"
          : l.kind === "支撑" ? "bg-emerald-500/70" : "bg-sky-500/70")}
          style={{ width: `${Math.min(100, (Math.abs(l.distance) / maxAbs) * 100)}%`,
            left: l.kind === "支撑" ? "auto" : 0, right: l.kind === "支撑" ? 0 : "auto" }} />
      </span>
      <span className="nums w-14 shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">{num(l.distance, 2, "%")}</span>
    </div>
  );
  return (
    <Panel title="压力与支撑" subtitle="枢轴点 + 均线 + 布林轨 + 区间高低合并排序，distance 为离现价的百分比">
      {levels.length === 0 ? (
        <EmptyState text="点位待更新" hint="需要至少 20 根日线才能算均线和布林" />
      ) : (
        <>
          <p className="mb-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">上方压力</p>
          {up.length ? up.map(bar) : <p className="mb-2 text-[11px] text-slate-400">现价已在所有压力位之上</p>}
          <div className="my-2 flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
            <span className="text-[11px] text-slate-500">现价</span>
            <span className="nums text-sm font-semibold">{price(priceNow)}</span>
            {pivot && <span className="nums ml-auto text-[11px] text-slate-400">枢轴 P {pivot.pivot.toFixed(2)} · R1 {pivot.r1.toFixed(2)} · S1 {pivot.s1.toFixed(2)}</span>}
          </div>
          <p className="mb-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">下方支撑</p>
          {down.length ? down.map(bar) : <p className="text-[11px] text-slate-400">现价已在所有支撑位之下</p>}
        </>
      )}
    </Panel>
  );
}

/** 明日操作指南：只用已算出来的点位与指标，不编条件 */
function GuidePanel({ detail, feat }: { detail: StockDetail | null; feat: F }) {
  if (!detail) return <Panel title="明日操作指南"><Skeleton className="h-32" /></Panel>;
  const lv = detail.levels;
  const firstRes = lv.find((l) => l.kind === "压力" && l.distance > 0);
  const sup = lv.filter((l) => l.kind === "支撑").sort((a, b) => b.distance - a.distance)[0];
  const stop = sup ? round2(sup.price * 0.98) : null;
  const pos = (feat.boll_pos as number | null) ?? null;
  const positives = [
    feat.ma_bullish ? "均线多头排列，MA5>MA10>MA20>MA60" : null,
    feat.ma_all_up ? "四条均线全部向上" : null,
    ((feat.macd_hist as number | null) ?? 0) > 0 ? "MACD 柱在零轴上方" : null,
    ((feat.vol_ratio as number | null) ?? 0) > 1.2 ? `量比 ${num(feat.vol_ratio as number | null, 2)}，放量` : null,
    feat.above_ma20 ? "股价站上 MA20" : null,
    ((feat.drawdown_from_high60 as number | null) ?? -99) > -3 ? "贴着 60 日高点，属强势整理" : null,
  ].filter(Boolean) as string[];
  const risks = [
    !feat.ma_bullish ? "均线尚未多头排列，趋势未确认" : null,
    ((feat.rsi14 as number | null) ?? 0) > 70 ? `RSI14 ${num(feat.rsi14 as number | null, 1)}，短线偏热` : null,
    ((feat.vol_ratio as number | null) ?? 1) < 0.8 ? "缩量，接力资金不足" : null,
    !feat.above_ma20 ? "股价在 MA20 下方" : null,
    (feat.divergence === false && (feat.price_new_low as boolean)) ? "创 60 日新低且未出现底背离" : null,
    ((pos ?? 0) > 0.95) ? "已顶到布林上轨，追高空间小" : null,
  ].filter(Boolean) as string[];
  return (
    <Panel title="明日操作指南" subtitle="由当日指标与点位直接推得，不含预测；失效条件即判断的前提">
      <div className="grid gap-3 sm:grid-cols-2">
        <Block title="正向因素" tone="rose" items={positives.length ? positives : ["暂无确认信号"]} />
        <Block title="失效风险" tone="emerald" items={risks.length ? risks : ["暂无明显风险信号"]} />
      </div>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">追击条件</dt>
          <dd className="nums mt-0.5">
            {firstRes
              ? <>放量站上 {firstRes.price.toFixed(2)}（{firstRes.label}）且量比 &gt; 1</>
              : <>涨超 {(detail.limitRate * 100).toFixed(0)}% 触板，无上方点位</>}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">止损位</dt>
          <dd className="nums mt-0.5">
            {sup ? <>跌破 {sup.price.toFixed(2)}（{sup.label}）；缓冲位 {stop?.toFixed(2)}（-2%）</> : "—"}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">次日涨跌停参考</dt>
          <dd className="nums mt-0.5">
            {round2(detail.price * (1 + detail.limitRate)).toFixed(2)} / {round2(detail.price * (1 - detail.limitRate)).toFixed(2)}
            <span className="ml-1 text-[11px] text-slate-400">（{(detail.limitRate * 100).toFixed(0)}% 制度价，四舍五入到分）</span>
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-400">
        仅为盘面数据整理，不构成投资建议；出现「失效风险」列出的条件时，上面的多头判断就作废。
      </p>
    </Panel>
  );
}

function round2(v: number) {
  return Math.round((v + 1e-9) * 100) / 100;
}

function Block({ title, tone, items }: { title: string; tone: "rose" | "emerald"; items: string[] }) {
  return (
    <div>
      <p className={cn("mb-1 text-[11px] font-semibold", tone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((t) => (
          <li key={t} className="flex gap-1.5 text-[12px] text-slate-700 dark:text-slate-300">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FundFlowPanel({ detail }: { detail: StockDetail | null }) {
  if (!detail) return <Panel title="主力资金"><Skeleton className="h-40" /></Panel>;
  const rows = detail.fundFlow;
  const sum = (k: "mainNet" | "netAmount", n: number) =>
    rows.slice(0, n).reduce((a, b) => a + (b[k] ?? 0), 0) / 1e8;
  return (
    <Panel title="资金流向" subtitle="新浪个股资金流：主力净流入 = 特大单 + 大单净额（按日），下表金额单位亿元">
      {rows.length === 0 ? (
        <EmptyState text="没有拿到个股资金流历史" hint="源偶尔会返回空，稍后重新拉取；不是本股特有现象" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>5 日主力净流入 <b className={cn("nums", sum("mainNet", 5) >= 0 ? "text-rose-500" : "text-emerald-500")}>{sum("mainNet", 5).toFixed(2)} 亿</b></span>
            <span>10 日 <b className={cn("nums", sum("mainNet", 10) >= 0 ? "text-rose-500" : "text-emerald-500")}>{sum("mainNet", 10).toFixed(2)} 亿</b></span>
            <span>最新日 <b className={cn("nums", rows[0].mainNet >= 0 ? "text-rose-500" : "text-emerald-500")}>{(rows[0].mainNet / 1e8).toFixed(2)} 亿</b>
              （全日 {(rows[0].netAmount / 1e8).toFixed(2)} 亿，占比 {rows[0].netRatio.toFixed(1)}%）</span>
          </div>
          <FundFlowChart rows={rows.map((r) => ({ date: r.date.slice(5), mainNet: r.mainNet, netAmount: r.netAmount }))} />
          <div className="mt-2 max-h-40 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>{["日期", "涨幅", "特大单", "大单", "中单", "小单", "主力合计"].map((h) => (
                  <th key={h} className={cn("px-2 py-1 font-medium", h === "日期" ? "text-left" : "text-right")}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="nums px-2 py-1">{r.date}</td>
                    <td className="nums px-2 py-1 text-right"><UpDown value={r.changePercent} /></td>
                    {[r.superNet, r.bigNet, r.midNet, r.smallNet].map((v, i) => (
                      <td key={i} className={cn("nums px-2 py-1 text-right", v >= 0 ? "text-rose-500" : "text-emerald-500")}>
                        {(v / 1e8).toFixed(2)}
                      </td>))}
                    <td className={cn("nums px-2 py-1 text-right font-semibold", r.mainNet >= 0 ? "text-rose-500" : "text-emerald-500")}>
                      {(r.mainNet / 1e8).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function NewsPanel({ news, busy, symbol }: { news: StockNews | null; busy: boolean; symbol: string }) {
  return (
    <Panel title="消息面与题材" subtitle="公告（东财披露）+ 快讯点名 + 龙虎榜 + 人气榜；题材标签看页首"
      right={<Button size="sm" variant="outline" onClick={() => {
        if (!news) return;
        void navigator.clipboard?.writeText(JSON.stringify(news, null, 1));
        toast("消息面 JSON 已复制", "info");
      }} disabled={!news}>复制</Button>}>
      {(!news || busy) && !news ? (
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : news ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              公司公告 · {news.announcements.length} 条
              {news.hotRank !== null && <Chip tone="violet" className="ml-auto">人气榜第 {news.hotRank} / {news.hotTotal}</Chip>}
            </p>
            {news.announcements.length === 0 ? <Empty text="近期没有抓到公告" /> : (
              <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                {news.announcements.map((a) => (
                  <li key={a.id} className="text-[12px] leading-snug">
                    <a href={a.url} target="_blank" rel="noreferrer"
                      className="block truncate text-slate-700 hover:underline dark:text-slate-200" title={a.title}>
                      {a.title}
                    </a>
                    <span className="nums text-[10px] text-slate-400">{(a.time || "").slice(0, 16)} · {(a.columns ?? []).join("/")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              快讯点名 · {news.news.length} 条{news.newsCount ? "" : "（近 120 条快讯里没有提到它，正常）"}
            </p>
            {news.news.length === 0 ? <Empty text="最新 120 条快讯未点名该股" /> : (
              <ul className="max-h-56 space-y-2 overflow-auto pr-1">
                {news.news.map((x) => (
                  <li key={x.id}>
                    <a href={x.url} target="_blank" rel="noreferrer" className="text-[12px] font-medium hover:underline">{x.title}</a>
                    <p className="line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{x.summary}</p>
                    <p className="nums text-[10px] text-slate-400">{x.time} · {x.source}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-1.5 mt-3 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              龙虎榜（近 5 日） · {news.billboard.length} 条
            </p>
            {news.billboard.length === 0 ? <Empty text="该股近 5 日未上榜" /> : (
              <ul className="space-y-1 text-[11px]">
                {news.billboard.slice(0, 6).map((b, i) => (
                  <li key={i} className="nums flex flex-wrap items-center gap-x-2 rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/60">
                    <span>{String(b.date)}</span>
                    <span className="opacity-70">{String(b.reason)}</span>
                    <span>净买 {(Number(b.netAmount) / 1e8).toFixed(2)}亿</span>
                    <UpDown value={Number(b.changePercent)} />
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(news.errors ?? {}).length > 0 && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                部分消息源失败：{Object.entries(news.errors).map(([k, v]) => `${k}(${v})`).join("；")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <Empty text={`还没有 ${symbol} 的消息面数据`} hint="公告接口或本地快照异常，可点右上角重新拉取" />
      )}
    </Panel>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-[11px] text-slate-400 dark:bg-slate-800/50">
      {text}
      {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400/80">{hint}</span>}
    </p>
  );
}

/* ---------------------------------------------------------------- AI */

/** 后端 _guess_direction 给的是英文码值，界面统一翻成中文 */
function dirOf(v: string): { label: string; tone: "rose" | "emerald" | "slate" } {
  if (v === "bullish" || v === "看多") return { label: "看多", tone: "rose" };
  if (v === "bearish" || v === "看空") return { label: "看空", tone: "emerald" };
  return { label: "中性", tone: "slate" };
}

function AiDiagnosePanel({ symbol, name }: { symbol: string; name: string }) {
  const [res, setRes] = useState<{ content: string; model: string; latencyMs: number; direction: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ content: string; model: string; latencyMs: number; direction: string }>(
        "/ai/analyze", { symbol }, 180_000);
      setRes(r);
    } catch (e) {
      setErr(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="个股 AI 深度诊断" subtitle={`本地 Ollama 依据上面的行情/日线/板块数据出研报，一次约 20-90 秒`}
      right={(
        <>
          {res && <Chip tone={dirOf(res.direction).tone}>{dirOf(res.direction).label}</Chip>}
          <Button size="sm" loading={busy} onClick={() => void run()}>{res ? "重新诊断" : "开始诊断"}</Button>
        </>
      )}>
      {busy && !res && (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner />{name} 正在推理，别刷页面…</p>
      )}
      {err && <p className="text-xs text-amber-600 dark:text-amber-400">{err}</p>}
      {res ? (
        <>
          <Markdown text={res.content} />
          <p className="mt-2 text-[11px] text-slate-400">模型 {res.model} · 用时 {(res.latencyMs / 1000).toFixed(1)} 秒</p>
        </>
      ) : !busy && !err ? (
        <EmptyState text="还没跑 AI 诊断" hint="诊断会带上行情、60 日日线、市场情绪与热点板块，只按给定数据推理" />
      ) : null}
    </Panel>
  );
}

function AiPredictPanel({ symbol, name, priceNow }: { symbol: string; name: string; priceNow: number }) {
  const [res, setRes] = useState<PricePrediction | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<PricePrediction>("/ai/predict-price-target", { symbol }, 180_000);
      setRes(r);
      if (!r.parse_ok) setErr("模型返回的 JSON 没解析成功，下面是原文");
    } catch (e) {
      setErr(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const sc = res?.prediction?.scenarios ?? [];
  return (
    <Panel title="情景推演 · 目标价路径" subtitle="引擎按均线/量价/资金流推 5-20 个交易日的乐观、中性、悲观三档"
      right={<Button size="sm" loading={busy} onClick={() => void run()}>{res ? "重新推演" : "开始推演"}</Button>}>
      {busy && !res && <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner />{name} 正在推演…</p>}
      {err && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{err}</p>}
      {sc.length > 0 ? (
        <div className="space-y-2">
          {sc.map((s) => {
            const target = Number(s.target_price);
            const gap = target ? ((target / priceNow - 1) * 100) : 0;
            return (
              <div key={s.name} className="rounded-lg border border-slate-200/80 px-3 py-2 dark:border-slate-700/60">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Chip tone={s.name.includes("乐观") ? "rose" : s.name.includes("悲观") ? "emerald" : "slate"}>{s.name}</Chip>
                  <span className="nums text-sm font-semibold">{target.toFixed(2)}</span>
                  <span className={cn("nums text-[11px]", gap >= 0 ? "text-rose-500" : "text-emerald-500")}>{gap >= 0 ? "+" : ""}{gap.toFixed(2)}%</span>
                  <span className="nums ml-auto text-[11px] text-slate-500">{Math.round(s.probability)}% · 约 {s.days} 个交易日</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <div className="h-full bg-slate-500/70" style={{ width: `${Math.max(2, Math.min(100, s.probability))}%` }} />
                </div>
                <p className="mt-1.5 text-[11.5px] text-slate-600 dark:text-slate-300">达成条件：{s.conditions}</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">失效条件：{s.invalidation}</p>
              </div>
            );
          })}
          {res?.prediction?.summary && <p className="text-[12px] text-slate-600 dark:text-slate-300">{res.prediction.summary}</p>}
        </div>
      ) : res ? (
        <Markdown text={res.raw ?? ""} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50" />
      ) : !busy ? (
        <EmptyState text="还没跑情景推演" hint="三档概率合计 100%，点位只会在数据给出的高低区间内取" />
      ) : null}
      {res?.disclaimer && <p className="mt-2 text-[11px] text-slate-400">{res.disclaimer}</p>}
    </Panel>
  );
}

/* ------------------------------------------------------------ 工具 */

/** 快照里的数值列可能是字符串，图表只认 number */
function toNum(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

function readRecent(): SearchHit[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as SearchHit[]).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function pushRecent(hit: SearchHit) {
  const next = [hit, ...readRecent().filter((r) => r.symbol !== hit.symbol)].slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/** 详情页进来时，把已在最近列表里的票提到最前 */
function pushRecentSeen(symbol: string) {
  const found = readRecent().find((r) => r.symbol === symbol);
  if (found) pushRecent(found);
}

async function resolveAndGo(input: string, navigate: (to: string) => void) {
  try {
    const r = await api.get<{ rows: SearchHit[] }>("/stock-analysis/search", { keyword: input, limit: 1 });
    const hit = r.rows[0];
    if (!hit) { toast(`没找到 ${input}`, "warn"); return; }
    pushRecent(hit);
    navigate(`/stock-analysis/${hit.symbol}`);
  } catch (e) {
    toast(messageOf(e), "error");
  }
}
