import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { DailyBars, SearchHit } from "../lib/types";
import { clock, money, num, timeAgo, tradeDate } from "../lib/format";
import { IntradayLine, KlineChart } from "../components/charts";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass,
} from "../components/ui";
import { LiveTicker } from "../components/LiveTicker";
import { LIVE_INDEXES } from "../lib/live";
import { toast } from "../store/toast";

const RECENT_KEY = "tsp-saas.stock-analysis.recent";
const DAY_CHOICES = [60, 120, 250] as const;

type Quote = {
  symbol: string; name: string; price: number; change_price: number; change_percent: number;
  open: number; high: number; low: number; prev_close: number; volume: number; amount: number;
  date?: string; time?: string;
};
type MinutePoint = { time: string; price: number; avg_price?: number; volume?: number };
type BoardRow = { code: string; name: string; stock_count: number; avg_price: number; change_price: number; change_percent: number; volume: number; amount: number };
type SpotRow = Record<string, string | number>;

export default function QuotesPage() {
  const [params, setParams] = useSearchParams();
  const symbol = params.get("symbol") || "sh000001";
  const [quote, setQuote] = useState<Quote | null>(null);
  const [daily, setDaily] = useState<DailyBars | null>(null);
  const [minutes, setMinutes] = useState<MinutePoint[]>([]);
  const [days, setDays] = useState<number>(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>(() => readRecent());
  const timer = useRef<number | null>(null);

  const load = useCallback(async (sym: string, d: number) => {
    setBusy(true);
    setError(null);
    try {
      const [q, k, m] = await Promise.all([
        api.get<{ rows: Quote[]; error?: string }>("/market-data/quotes/realtime", { symbols: sym }),
        api.get<DailyBars>("/market-data/quotes/daily", { symbol: sym, days: d }),
        api.get<{ symbol: string; points: MinutePoint[]; error?: string }>("/market-data/minute", { symbol: sym }),
      ]);
      setQuote(q.rows[0] ?? null);
      if (q.error) setError(`实时行情：${q.error}`);
      setDaily(k);
      if (k.error) setError((prev) => `${prev ?? ""} K线：${k.error}`);
      setMinutes(m.points);
    } catch (e) {
      setError(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(symbol, days); }, [load, symbol, days]);

  useEffect(() => {
    const kw = keyword.trim();
    if (timer.current) window.clearTimeout(timer.current);
    if (!kw) { setHits([]); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ rows: SearchHit[] }>("/market-data/securities/search", { keyword: kw });
        setHits(r.rows);
      } catch (e) { toast(messageOf(e), "error"); }
    }, 320);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [keyword]);

  const pick = (sym: string, name?: string) => {
    setParams({ symbol: sym });
    setKeyword("");
    setHits([]);
    if (name) {
      const next = [{ symbol: sym, name, price: null, change_percent: null },
        ...readRecent().filter((r) => r.symbol !== sym)].slice(0, 10);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(readRecent());
    }
  };

  const intraday = useMemo(
    () => minutes.map((p) => ({ t: clock(p.time), price: p.price })),
    [minutes],
  );

  const ind = daily?.indicators;

  return (
    <div className="space-y-4">
      <LiveTicker symbols={[symbol, ...LIVE_INDEXES.filter((s) => s !== symbol)]} />
      <Panel
        title="行情数据"
        subtitle="实时报价 + 分时 + 日线与技术位，报价/日线主源新浪，分时的东财源本机不通、由腾讯兜底"
        right={<Button size="sm" variant="outline" loading={busy} onClick={() => void load(symbol, days)}>重新拉取</Button>}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">搜索标的</span>
            <input className={inputClass} value={keyword} placeholder="贵州茅台 / 600519 / sz399006"
              onChange={(e) => setKeyword(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {readQuickPick().map((q) => (
              <Button key={q.symbol} size="sm" variant="outline" onClick={() => pick(q.symbol)}
                className={cn(symbol === q.symbol && "!border-slate-900 font-medium dark:!border-white")}>
                {q.label}
              </Button>
            ))}
          </div>
        </div>

        {!!keyword.trim() && hits.length > 0 && (
          <DataTable
            dense
            maxHeight="max-h-52"
            rows={hits}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => pick(r.symbol, r.name)}
            columns={[
              { key: "name", label: "名称", render: (r) => (
                <span>{r.name}<span className="ml-1.5 nums text-[10px] text-slate-400">{r.symbol}</span></span>) },
              { key: "price", label: "现价", align: "right", render: (r) => <span className="nums">{r.price ?? "—"}</span> },
              { key: "change_percent", label: "涨跌幅", align: "right", render: (r) => <UpDown value={r.change_percent} /> },
              { key: "ops", label: "", align: "right", render: (r) => (
                <Button size="sm" onClick={() => pick(r.symbol, r.name)}>查看</Button>) },
            ]}
          />
        )}

        {!keyword.trim() && recent.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">最近看过</span>
            {recent.map((r) => (
              <button key={r.symbol} type="button" onClick={() => pick(r.symbol)}
                className="nums rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800">
                {r.name}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
      </Panel>

      {/* 报价 */}
      {quote ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PriceCard quote={quote} />
          <MiniCard label="今开 / 昨收" a={num(quote.open)} b={num(quote.prev_close)} />
          <MiniCard label="最高 / 最低" a={num(quote.high)} b={num(quote.low)}
            tone={quote.high >= quote.prev_close ? 1 : -1} />
          <MiniCard label="成交量 / 成交额" a={`${(quote.volume / 1e6).toFixed(0)}万手`} b={money(quote.amount)} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="日 K 线"
          subtitle={`${daily?.symbol ?? symbol} · 共 ${daily?.count ?? 0} 根（${tradeDate(daily?.bars[0]?.day ?? null)} ~ ${tradeDate(daily?.bars.at(-1)?.day ?? null)}）`}
          right={
            <div className="flex gap-1">
              {DAY_CHOICES.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={cn("rounded-md px-2 py-1 text-xs", d === days
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
                  {d} 天
                </button>
              ))}
            </div>
          }>
          {daily?.bars.length ? (
            <>
              <KlineChart bars={daily.bars} count={Math.min(days, 120)} height={230} />
              <p className="mt-1 text-[10px] text-slate-400">黄线 MA5、蓝线 MA20；虚线为最近收盘价</p>
            </>
          ) : <Skeleton className="h-56" />}
        </Panel>

        <Panel title="分时走势" subtitle={`${quote?.name ?? symbol} · ${tradeDate(quote?.date ?? null)} ${clock(quote?.time ?? null)}`}>
          {intraday.length > 1 ? (
            <IntradayLine points={intraday} prevClose={quote?.prev_close ?? null} height={230} />
          ) : (
            <EmptyState text="当日没有分时数据" hint="休市/非交易日或部分源不可用时会出现" />
          )}
        </Panel>
      </div>

      {/* 技术位 */}
      <Panel title="技术位" subtitle="均线 / 布林 / 枢轴点，按最近一根日线计算（文档 3.4 技术面字段）">
        {!ind ? <Skeleton className="h-20" /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1 text-[11px] text-slate-500">均线</p>
              {([["MA5", ind.ma5], ["MA10", ind.ma10], ["MA20", ind.ma20], ["MA60", ind.ma60]] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{k}</span>
                  <span className={cn("nums", quote && v !== null
                    ? (quote.price >= v ? "text-rose-500" : "text-emerald-500") : "text-slate-400")}>
                    {v === null ? "样本不足" : v.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1 text-[11px] text-slate-500">布林带（20 日）</p>
              {ind.boll ? (
                <>
                  <Line k="上轨" v={ind.boll.upper} />
                  <Line k="中轨" v={ind.boll.mid} />
                  <Line k="下轨" v={ind.boll.lower} />
                  <Line k="带宽" v={ind.boll.width} suffix="%" />
                </>
              ) : <p className="text-xs text-slate-400">样本不足 20 根</p>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1 text-[11px] text-slate-500">枢轴点（支撑/压力）</p>
              {ind.pivot ? (
                <>
                  <Line k="R2" v={ind.pivot.r2} />
                  <Line k="R1" v={ind.pivot.r1} />
                  <Line k="Pivot" v={ind.pivot.pivot} />
                  <Line k="S1" v={ind.pivot.s1} />
                  <Line k="S2" v={ind.pivot.s2} />
                </>
              ) : <p className="text-xs text-slate-400">缺当日高低价</p>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1 text-[11px] text-slate-500">区间</p>
              <Line k="60 日最高" v={ind.high_60} />
              <Line k="60 日最低" v={ind.low_60} />
              <p className="mt-2 text-[10px] leading-4 text-slate-400">
                现价站上 MA20 = 短线偏强；靠近 60 日高点说明在上行趋势里
              </p>
            </div>
          </div>
        )}
      </Panel>

      {/* 近期日线 */}
      <Panel title="近期日线" subtitle="最近 12 根，含成交量/成交额">
        {daily?.bars.length ? (
          <DataTable
            dense
            rows={[...daily.bars].slice(-12).reverse()}
            rowKey={(b) => b.day}
            columns={[
              { key: "day", label: "日期", render: (b) => <span className="nums">{b.day}</span> },
              { key: "open", label: "开盘", align: "right", render: (b) => <span className="nums">{b.open.toFixed(2)}</span> },
              { key: "close", label: "收盘", align: "right", render: (b) => <span className="nums font-medium">{b.close.toFixed(2)}</span> },
              { key: "high", label: "最高", align: "right", render: (b) => <span className="nums">{b.high.toFixed(2)}</span> },
              { key: "low", label: "最低", align: "right", render: (b) => <span className="nums">{b.low.toFixed(2)}</span> },
              { key: "chg", label: "涨跌", align: "right", render: (b) => (
                <UpDown value={(() => {
                  const i = daily.bars.findIndex((x) => x.day === b.day);
                  const prev = daily.bars[i - 1];
                  return prev ? (b.close - prev.close) / prev.close * 100 : null;
                })()} />) },
              { key: "volume", label: "成交量", align: "right", render: (b) => <span className="nums text-slate-500">{(b.volume / 1e4).toFixed(0)}万股</span> },
              { key: "amount", label: "成交额", align: "right", render: (b) => <span className="nums text-slate-500">{money(b.amount ?? null)}</span> },
            ]}
          />
        ) : <Skeleton className="h-40" />}
      </Panel>

      <BoardsPanel />
    </div>
  );
}

function readQuickPick() {
  return [
    { symbol: "sh000001", label: "上证指数" },
    { symbol: "sz399001", label: "深证成指" },
    { symbol: "sz399006", label: "创业板指" },
    { symbol: "sh000688", label: "科创50" },
    { symbol: "bj899050", label: "北证50" },
    { symbol: "sh600519", label: "贵州茅台" },
  ];
}

function PriceCard({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
      <div className="flex items-baseline justify-between">
        <span className="truncate text-sm font-semibold">{quote.name}</span>
        <span className="nums text-[11px] text-slate-400">{quote.symbol}</span>
      </div>
      <p className={cn("nums mt-1 text-2xl font-semibold",
        quote.change_percent > 0 ? "text-rose-500" : quote.change_percent < 0 ? "text-emerald-500" : "text-slate-500")}>
        {quote.price.toFixed(2)}
      </p>
      <div className="mt-0.5 flex items-center gap-2 text-xs">
        <UpDown value={quote.change_percent} />
        <span className={cn("nums", quote.change_price > 0 ? "text-rose-500"
          : quote.change_price < 0 ? "text-emerald-500" : "text-slate-400")}>
          {quote.change_price > 0 ? "+" : ""}{quote.change_price.toFixed(2)}
        </span>
        <Chip tone="slate" className="ml-auto">{clock(quote.time ?? null)}</Chip>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">行情时间 {timeAgo(`${quote.date ?? ""} ${quote.time ?? ""}`.trim() || null)}</p>
    </div>
  );
}

function MiniCard({ label, a, b, tone }: { label: string; a: string; b: string; tone?: number }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums mt-1 text-sm font-semibold",
        tone === undefined ? "text-slate-700 dark:text-slate-200"
          : tone > 0 ? "text-rose-500" : tone < 0 ? "text-emerald-500" : "text-slate-500")}>{a}</p>
      <p className="nums text-xs text-slate-500 dark:text-slate-400">{b}</p>
    </div>
  );
}

function Line({ k, v, suffix = "" }: { k: string; v: number | null; suffix?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{k}</span>
      <span className="nums">{v === null ? "—" : `${v.toFixed(2)}${suffix}`}</span>
    </div>
  );
}

function BoardsPanel() {
  const [kind, setKind] = useState<"industry" | "concept">("industry");
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [openBoard, setOpenBoard] = useState<BoardRow | null>(null);
  const [stocks, setStocks] = useState<SpotRow[]>([]);
  const [stockBusy, setStockBusy] = useState(false);

  const load = useCallback(async (k: string) => {
    setBusy(true);
    try {
      const r = await api.get<{ rows: BoardRow[]; total: number; error?: string }>("/market-data/boards",
        { kind: k, limit: 60 });
      setRows(r.rows);
      setTotal(r.total);
      if (r.error) toast(`板块数据：${r.error}`, "warn");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(kind); setOpenBoard(null); }, [kind, load]);

  const open = async (b: BoardRow) => {
    setOpenBoard(b);
    setStockBusy(true);
    try {
      const r = await api.get<{ rows: SpotRow[]; error?: string }>("/market-data/boards/stocks",
        { code: b.code, num: 30 });
      setStocks(r.rows);
      if (!r.rows.length) toast("这个板块没返回成分股", "warn");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setStockBusy(false);
    }
  };

  return (
    <Panel
      title="板块行情"
      subtitle={`${kind === "industry" ? "行业" : "概念"}板块 ${total} 个 · 点一行看板块成分股`}
      loading={busy}
      right={
        <div className="flex gap-1">
          {(["industry", "concept"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={cn("rounded-md px-2 py-1 text-xs", k === kind
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
              {k === "industry" ? "行业" : "概念"}
            </button>
          ))}
        </div>
      }
    >
      <DataTable
        dense
        maxHeight="max-h-72"
        rows={rows}
        rowKey={(r) => r.code}
        sortInitial={{ key: "change_percent", desc: true }}
        onRowClick={(r) => void open(r)}
        empty="板块拉取失败，去数据源矩阵页探测一下"
        columns={[
          { key: "name", label: "板块", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "change_percent", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
            render: (r) => <UpDown value={r.change_percent} /> },
          { key: "avg_price", label: "均价", align: "right", value: (r) => r.avg_price,
            render: (r) => <span className="nums text-slate-500">{r.avg_price.toFixed(2)}</span> },
          { key: "stock_count", label: "家数", align: "right", value: (r) => r.stock_count,
            render: (r) => <span className="nums text-slate-500">{r.stock_count}</span> },
          { key: "amount", label: "成交额", align: "right", value: (r) => r.amount,
            render: (r) => <span className="nums text-slate-500">{money(r.amount)}</span> },
        ]}
      />

      {openBoard && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium">
              成分股 · {openBoard.name}
              <span className={cn("nums ml-2", openBoard.change_percent > 0 ? "text-rose-500" : "text-emerald-500")}>
                {openBoard.change_percent.toFixed(2)}%
              </span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => setOpenBoard(null)}>收起</Button>
          </div>
          <DataTable
            dense
            maxHeight="max-h-72"
            loading={stockBusy}
            rows={stocks}
            rowKey={(r) => String(r.symbol)}
            columns={[
              { key: "name", label: "名称", render: (r) => (
                <span>{String(r.name)}<span className="ml-1.5 nums text-[10px] text-slate-400">{String(r.symbol)}</span></span>) },
              { key: "trade", label: "现价", align: "right",
                render: (r) => <span className="nums">{Number(r.trade).toFixed(2)}</span> },
              { key: "changepercent", label: "涨跌幅", align: "right",
                value: (r) => Number(r.changepercent),
                render: (r) => <UpDown value={Number(r.changepercent)} /> },
              { key: "turnoverratio", label: "换手", align: "right",
                render: (r) => <span className="nums text-slate-500">{Number(r.turnoverratio).toFixed(2)}%</span> },
              { key: "nmc", label: "流通市值", align: "right",
                render: (r) => <span className="nums text-slate-500">{money(Number(r.nmc) * 1e4)}</span> },
            ]}
          />
        </div>
      )}
    </Panel>
  );
}

function readRecent(): SearchHit[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as SearchHit[]).slice(0, 10) : [];
  } catch {
    return [];
  }
}
