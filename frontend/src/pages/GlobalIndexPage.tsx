import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, isDemo, messageOf } from "../lib/api";
import type { EmotionPanel, FearPanel, GlobalIndexResult, GlobalQuote } from "../lib/types";
import { num, price, timeAgo } from "../lib/format";
import { applyLive, fetchGlobalLive, type GlobalLive } from "../lib/liveGlobal";
import { AshareStrip, QuoteGroupCard, SourceErrors } from "../components/global-quote";
import { TrendLine, type TrendPoint } from "../components/charts";
import {
  Button, Chip, DataTable, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";

const GROUP_NOTE: Record<string, string> = {
  美股: "美东 16:00 收盘，北京时间次日凌晨 4-5 点",
  港股: "港股 16:00 收市",
  亚太: "日经 15:45 收市",
  欧洲: "欧洲 17:30-18:30 收市",
  汇率: "美元指数 / 离岸人民币为 24 小时连续报价",
  中国: "富时 A50 期货近月，夜盘对 A 股开盘影响最大",
};

const FEAR_TONE: Record<string, "emerald" | "amber" | "rose"> = {
  极度平静: "emerald", 平静: "emerald", 略有戒心: "amber",
  紧张: "amber", 恐慌: "rose", 极端恐慌: "rose",
};

/** 演示模式的实时一跳周期，与顶上报价带一致 */
const LIVE_EVERY_MS = 5_000;
/** 跳价闪烁时长，与顶上报价带同一套反馈 */
const FLASH_MS = 900;

export default function GlobalIndexPage() {
  const [data, setData] = useState<GlobalIndexResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // 演示模式的实时覆盖：价/涨跌来自浏览器直连腾讯+东财，其余仍是预抓快照
  const [live, setLive] = useState<GlobalLive | null>(null);
  // 跳价闪烁：key 是外围行 code 或 A 股 symbol，值是这一跳的方向
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const lastPriceRef = useRef<Record<string, number>>({});
  // 自己走的时钟：不重新拉数据也要让「X 分钟前 / 下次刷新 N 秒后」保持鲜活
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadedAtRef = useRef(Date.now());

  const load = useCallback(async (refresh = false, silent = false) => {
    if (!silent) setBusy(true);
    try {
      setData(await api.get<GlobalIndexResult>(
        `/global-market/index${refresh ? "?refresh=true" : ""}`, undefined, 60_000));
      setError(null);
      loadedAtRef.current = Date.now();
    } catch (e) {
      if (!silent) setError(messageOf(e));
    }
    if (!silent) setBusy(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(false, true); }, 60_000);
    const clock = window.setInterval(() => setNowMs(Date.now()), 5_000);
    const onVisible = () => { if (!document.hidden) void load(false, true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!isDemo) return;
    let alive = true;
    // fetchGlobalLive 内部按源兜底、失败保留上一跳，本身不会 reject
    const run = async () => {
      const got = await fetchGlobalLive();
      if (!alive) return;
      // 和顶上报价带一样：价比上一跳变了就闪一拍，让「在刷新」看得见
      const changed: Record<string, "up" | "down"> = {};
      for (const [key, p] of [...Object.entries(got.quotes), ...Object.entries(got.aShare)]) {
        const prev = lastPriceRef.current[key];
        if (prev !== undefined && p.price !== prev) changed[key] = p.price > prev ? "up" : "down";
        lastPriceRef.current[key] = p.price;
      }
      setLive(got);
      if (Object.keys(changed).length) {
        setFlash(changed);
        window.setTimeout(() => { if (alive) setFlash({}); }, FLASH_MS);
      }
    };
    void run();
    const timer = window.setInterval(run, LIVE_EVERY_MS);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 展示视图：快照之上盖实时报价；连本机后端时 live 恒为 null，走原始数据
  const view = useMemo(() => (data ? applyLive(data, isDemo ? live : null) : data), [data, live]);

  const cols: Column<GlobalQuote>[] = useMemo(() => [
    { key: "name", label: "名称", value: (r) => r.name, render: (r) => (
      <span className="whitespace-normal text-[13px] text-slate-800 dark:text-slate-100">{r.name}</span>) },
    { key: "group", label: "分组", value: (r) => groupOf(view, r.code), render: (r) => (
      <span className="text-xs text-slate-500 dark:text-slate-400">{groupOf(view, r.code)}</span>) },
    { key: "price", label: "最新价", align: "right", value: (r) => r.price, render: (r) => (
      <span className={cn("nums rounded px-0.5 transition-colors duration-300",
        flash[r.code] === "up" && "bg-rose-100 dark:bg-rose-500/20",
        flash[r.code] === "down" && "bg-emerald-100 dark:bg-emerald-500/20")}>
        {price(r.price, r.price !== null && r.price < 10 ? 4 : 2)}</span>) },
    { key: "chg", label: "涨跌额", align: "right", value: (r) => r.change_price, render: (r) => (
      <span className="nums text-slate-500 dark:text-slate-400">{num(r.change_price, 2)}</span>) },
    { key: "pct", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
      render: (r) => <UpDown value={r.change_percent} /> },
    { key: "open", label: "今开", align: "right", value: (r) => r.open,
      render: (r) => <span className="nums text-slate-500">{price(r.open)}</span> },
    { key: "high", label: "最高", align: "right", value: (r) => r.high,
      render: (r) => <span className="nums text-slate-500">{price(r.high)}</span> },
    { key: "low", label: "最低", align: "right", value: (r) => r.low,
      render: (r) => <span className="nums text-slate-500">{price(r.low)}</span> },
    { key: "prev", label: "昨收", align: "right", value: (r) => r.prev_close,
      render: (r) => <span className="nums text-slate-500">{price(r.prev_close)}</span> },
    { key: "date", label: "报价时间", value: (r) => r.date, render: (r) => (
      <span className="nums text-[11px] text-slate-400">{r.date ?? "—"} {r.time?.slice(0, 5) ?? ""}</span>) },
  ], [view, flash]);

  const kw = filter.trim();
  const rows = kw ? (view?.rows ?? []).filter((r) => r.name.includes(kw) || r.code.includes(kw))
    : (view?.rows ?? []);
  const clock = new Date(nowMs).toLocaleTimeString("zh-CN", { hour12: false });
  const nextIn = Math.max(0, 60 - Math.round((nowMs - loadedAtRef.current) / 1000));
  const liveOn = isDemo && !!live;

  return (
    <div className="space-y-4">
      <Panel
        title="全球风险温度"
        subtitle={view
          ? `${liveOn ? `实时报价 ${live!.at}（浏览器直连，5 秒一跳）· 快照抓取于 ${view.generatedAt}`
            : `更新于 ${view.generatedAt}`} · ${view.rows.length} 个外围标的 · ${view.groups.length} 组`
          : error ?? "正在读取外围行情与 CBOE 恐慌指数…"}
        right={(
          <>
            <Metric label="全球均值" value={view?.riskOn === null || view?.riskOn === undefined
              ? "—" : `${view.riskOn >= 0 ? "+" : ""}${view.riskOn.toFixed(2)}%`}
              tone={view?.riskOn === null || view?.riskOn === undefined ? undefined
                : view.riskOn >= 0 ? "up" : "down"} />
            <Button size="sm" variant="outline" loading={busy && !!view} onClick={() => void load(true)}>刷新</Button>
          </>
        )}
      >
        {busy && !view ? <Skeleton className="h-20 w-full" /> : (
          <>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {view?.note}
              {liveOn ? "；演示站在这份快照之上，用浏览器直连腾讯/东财行情把价格与涨跌刷新到实时，"
                + "VIX、富时A50期货与情绪分仍取自快照" : ""}
            </p>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">A 股对照</p>
              <AshareStrip rows={view?.aShare ?? []} flash={liveOn ? flash : undefined} />
            </div>
          </>
        )}
        <SourceErrors errors={view?.errors ?? {}} />
        <p className="nums mt-3 text-[11px] text-slate-400">
          现在 {clock} · {liveOn
            ? `价格实时直连，最近一跳 ${live!.at} · 预抓快照 ${timeAgo(view?.generatedAt)}`
            : `数据 ${timeAgo(view?.generatedAt)} · 约 ${nextIn} 秒后再拉（页面自己刷新，不用手点）`}
        </p>
      </Panel>

      <FearCard fear={view?.fear ?? null} busy={busy && !view} />
      <EmotionCard emotion={view?.emotion ?? null} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {busy && !view && [0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
        {(view?.groups ?? []).map((g) => (
          <QuoteGroupCard key={g.key} group={g} flash={liveOn ? flash : undefined} />
        ))}
      </div>

      <Panel
        title="外围行情明细"
        subtitle={view ? `按涨跌幅排序 · 共 ${rows.length} 行${kw ? `（筛选「${kw}」）` : ""}` : ""}
        right={(
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="筛名称/代码" className={cn(inputClass, "h-8 w-28! shrink-0 !py-1 text-xs")} />
        )}
        bodyClass="p-0"
      >
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.code} loading={busy && !view}
          dense maxHeight="520px" sortInitial={{ key: "pct", desc: true }}
          empty={`没有匹配「${kw}」的外围标的`} />
      </Panel>

      <Panel title="看盘提示" subtitle="外围什么时候动、动多少才会影响 A 股">
        <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <li className="flex gap-2">
            <span className="w-20 shrink-0 font-medium text-slate-700 dark:text-slate-200">恐慌指数</span>
            <span className="min-w-0 flex-1">
              VIX 衡量标普500 未来 30 天的预期波动，越高说明海外越怕跌。它跌是好事、涨是坏事，
              和 A 股「红涨绿跌」的读法相反，所以明细表里 VIX 那一行飘绿往往代表外围在松一口气。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="w-20 shrink-0 font-medium text-slate-700 dark:text-slate-200">两条线一起看</span>
            <span className="min-w-0 flex-1">
              VIX 往下 + 大盘情绪分往上＝内外共振偏暖；VIX 往上 + 情绪分往下＝两头都在收流动性，
              这时候抄底反弹的胜率最低。单边动只是背景噪音，不必紧张。
            </span>
          </li>
          {Object.entries(GROUP_NOTE).map(([k, v]) => (
            <li key={k} className="flex gap-2">
              <span className="w-20 shrink-0 font-medium text-slate-700 dark:text-slate-200">{k}</span>
              <span className="min-w-0 flex-1">{v}</span>
            </li>
          ))}
          <li className="mt-2 rounded-lg bg-slate-50 px-3 py-2 leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            A 股真正会被外围带动的只有两条：一是夜盘富时 A50 与离岸人民币（次日开盘价），
            二是美股纳指/费半对科技板块情绪。其余海外市场更多是背景信息，不必据此做交易决定。
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function FearCard({ fear, busy }: { fear: FearPanel | null; busy: boolean }) {
  const points: TrendPoint[] = useMemo(
    () => (fear?.series ?? []).map((s) => ({
      x: s.date.slice(5), y: s.close, label: `${s.date} VIX ${s.close.toFixed(2)}`,
    })), [fear]);
  const q = fear?.quote ?? null;
  const band = fear?.band ?? null;
  const win = fear?.window;

  return (
    <Panel
      title="恐慌指数 VIX"
      subtitle="海外恐慌温度计：CBOE 官方延时行情 + 最近交易日收盘序列"
      right={band && <Chip tone={FEAR_TONE[band.label] ?? "slate"}>{band.label}</Chip>}
    >
      {busy || !fear ? <Skeleton className="h-40 w-full" /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0">
            <div className="flex items-end gap-2">
              <span className="nums text-3xl leading-none font-semibold text-slate-800 dark:text-slate-100">
                {q?.price === null || q?.price === undefined ? "—" : q.price.toFixed(2)}
              </span>
              <UpDown value={q?.change_percent} className="text-sm" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {band ? band.meaning : (fear.error ?? "等待 CBOE 返回现价")}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <Cell k="今开" v={price(q?.open, 2)} />
              <Cell k="昨收" v={price(q?.prev_close, 2)} />
              <Cell k="最高" v={price(q?.high, 2)} />
              <Cell k="最低" v={price(q?.low, 2)} />
              <Cell k="5 日变动" v={signed(fear.change5, 2)} tone={dirOfNum(fear.change5)} />
              <Cell k={`${fear.days} 日分位`} v={fear.percentile === null ? "—" : `${fear.percentile.toFixed(0)}%`} />
              <Cell k="区间均值" v={win?.avg === null || win?.avg === undefined ? "—" : win.avg.toFixed(2)} />
            </dl>
            <p className="nums mt-3 text-[11px] leading-relaxed text-slate-400">
              {q ? `${q.source} · 报价 ${q.date ?? "—"} ${q.time ?? ""}（${q.quoteZone ?? "美东时间"}）` : "取不到现价"}
            </p>
          </div>
          <div className="min-w-0 lg:col-span-2">
            {fear.error && !points.length && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {fear.error}
              </p>
            )}
            <TrendLine points={points} tone="violet" height={210} digits={1}
              refLines={fear.refLines} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{fear.note}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function EmotionCard({ emotion }: { emotion: EmotionPanel | null }) {
  const points: TrendPoint[] = useMemo(
    () => (emotion?.rows ?? []).map((r) => ({
      x: r.date.slice(5), y: r.score, label: `${r.date} 情绪 ${r.score ?? "—"} · ${r.label ?? "待更新"}`,
    })), [emotion]);
  const latest = emotion?.latest ?? null;

  return (
    <Panel
      title="大盘情绪折线"
      subtitle="六维加权情绪分（0-100），每个交易日收盘快照后加一个点"
      right={(
        <>
          {latest && (
            <Chip tone={latest.score !== null && latest.score >= 60 ? "rose"
              : latest.score !== null && latest.score < 45 ? "sky" : "amber"}>
              {latest.date} · {latest.score === null ? "待更新" : latest.score.toFixed(1)} {latest.label ?? ""}
            </Chip>
          )}
          <Link to="/market-env"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            六维明细
          </Link>
          <Link to="/market-env/history"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            全部历史
          </Link>
        </>
      )}
    >
      {!emotion ? <Skeleton className="h-40 w-full" /> : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>区间均值 <b className="nums text-slate-700 dark:text-slate-200">{fmtOrNull(emotion.avg)}</b></span>
            <span>最高 <b className="nums text-rose-500">{fmtOrNull(emotion.high)}</b></span>
            <span>最低 <b className="nums text-emerald-500">{fmtOrNull(emotion.low)}</b></span>
            <span>5 日变化 <b className={cn("nums", (emotion.change5 ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
              {signed(emotion.change5, 1)}</b></span>
            <span>共 <b className="nums text-slate-700 dark:text-slate-200">{emotion.rows.length}</b> 个交易日</span>
          </div>
          {emotion.error && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {emotion.error}
            </p>
          )}
          <TrendLine points={points} tone="sky" height={200} digits={1} domain={[0, 100]}
            refLines={emotion.refLines} />
        </>
      )}
    </Panel>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-slate-400">{k}</dt>
      <dd className={cn("nums min-w-0 truncate text-right",
        tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-500"
          : "text-slate-700 dark:text-slate-200")}>{v}</dd>
    </div>
  );
}

function fmtOrNull(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toFixed(2);
}

function signed(v: number | null | undefined, digits: number): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function dirOfNum(v: number | null | undefined): "up" | "down" | undefined {
  if (v === null || v === undefined || v === 0) return undefined;
  return v > 0 ? "up" : "down";
}

function groupOf(data: GlobalIndexResult | null, code: string): string {
  for (const g of data?.groups ?? []) {
    if (g.rows.some((r) => r.code === code)) return g.label;
  }
  return code === "VIX" ? "恐慌" : "其他";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1 text-right dark:border-slate-700/60 dark:bg-slate-900/40">
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums text-sm font-semibold",
        tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-500"
          : "text-slate-700 dark:text-slate-200")}>{value}</p>
    </div>
  );
}
