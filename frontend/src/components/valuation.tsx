import { useCallback, useEffect, useRef, useState } from "react";
import { api, messageOf } from "../lib/api";
import type {
  ValuationMetric, ValuationOverview, ValuationPanel, ValuationRelative, ValuationRow,
} from "../lib/types";
import { price, tradeDate } from "../lib/format";
import { TrendLine, type TrendPoint } from "./charts";
import { Button, Chip, DataTable, EmptyState, Panel, Skeleton, cn, type Column } from "./ui";

/** 判定档位 → 色块（后端 verdict.tone 给的是 Tailwind 色名） */
const VERDICT_SOLID: Record<string, string> = {
  emerald: "bg-emerald-500", teal: "bg-teal-500", amber: "bg-amber-500",
  orange: "bg-orange-500", rose: "bg-rose-500",
};

const WINDOWS = [
  { value: 0, label: "全部历史" },
  { value: 10, label: "近10年" },
  { value: 5, label: "近5年" },
  { value: 3, label: "近3年" },
];

type Metric = "pe" | "pb";
type Range = { years: number; start: string | null; end: string | null };
const METRICS: { key: Metric; label: string }[] = [
  { key: "pe", label: "市盈率 PE" },
  { key: "pb", label: "市净率 PB" },
];

function pctText(v: number | null | undefined, digits = 1) {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function peTone(v: number | null | undefined): "emerald" | "amber" | "rose" {
  if (v === null || v === undefined) return "amber";
  return v < 0.35 ? "emerald" : v > 0.7 ? "rose" : "amber";
}

function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function hhmmss(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 拉单个指数的估值面板；区间优先级：手动 start/end > years > 全部历史 */
function useValuationPanel(code: string | null, range: Range) {
  const [panel, setPanel] = useState<ValuationPanel | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!code) return;
    setBusy(true);
    try {
      setPanel(await api.get<ValuationPanel>("/index/valuation",
        { code, years: range.years, start: range.start ?? "", end: range.end ?? "",
          refresh: refresh ? "true" : "false" }, 30_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [code, range.years, range.start, range.end]);
  useEffect(() => { void load(); }, [load]);
  return { panel, busy, error, reload: load };
}

/** 估值结论 + 分位条 + 区间统计 */
function MetricReadout({ m, name, curLabel = "当前" }:
  { m?: ValuationMetric; name: string; curLabel?: string }) {
  if (!m || m.value === null || m.value === undefined) {
    return <EmptyState text={`${name}没有可算的历史序列`} hint="该口径上游未覆盖，换另一个指标或等归档补上" />;
  }
  const p = m.percentile;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{curLabel}{name}</p>
          <p className="nums text-2xl leading-tight font-semibold text-slate-900 dark:text-slate-50">
            {m.value.toFixed(2)}
          </p>
        </div>
        {m.verdict && (
          <span className={cn("rounded-md px-2 py-1 text-xs font-medium text-white",
            VERDICT_SOLID[m.verdict.tone] ?? "bg-slate-400")}>
            {m.verdict.label}
          </span>
        )}
        <div className="text-right">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">历史分位</p>
          <p className="nums text-lg leading-tight font-semibold text-slate-800 dark:text-slate-100">
            {pctText(p)}
          </p>
        </div>
      </div>
      {m.verdict && (
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{m.verdict.meaning}</p>
      )}
      {p !== null && p !== undefined && (
        <div>
          <div className="relative h-2.5 rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400">
            <div className="absolute -top-1 h-4.5 w-1.5 rounded-full bg-slate-900 shadow dark:bg-white"
              style={{ left: `calc(${(p * 100).toFixed(1)}% - 3px)` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>0% 最便宜</span>
            <span>50% 中位</span>
            <span>100% 最贵</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat k="历史最低" v={m.low === null ? "—" : m.low.toFixed(2)} />
        <Stat k="历史中位" v={m.median === null ? "—" : m.median.toFixed(2)} />
        <Stat k="历史最高" v={m.high === null ? "—" : m.high.toFixed(2)} />
        <Stat k="25%分位" v={m.p25 === null ? "—" : m.p25.toFixed(2)} />
        <Stat k="均值" v={m.avg === null ? "—" : m.avg.toFixed(2)} />
        <Stat k="75%分位" v={m.p75 === null ? "—" : m.p75.toFixed(2)} />
      </div>
      <p className="nums text-[11px] leading-relaxed text-slate-400">
        窗口 {m.window.begin ?? "—"} → {m.window.end ?? "—"}（{m.window.years ?? "—"} 年 ·
        {m.points} 个样本点）· 数据日 {m.date ?? "—"}
      </p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60">
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{k}</p>
      <p className="nums text-sm font-semibold text-slate-800 dark:text-slate-100">{v}</p>
    </div>
  );
}

/** 估值区间带 + 历史折线 */
function ValuationChart({ m, tone }: { m?: ValuationMetric; tone: "sky" | "violet" }) {
  if (!m || m.series.length < 2) {
    return <Skeleton className="h-44 w-full" />;
  }
  const points: TrendPoint[] = m.series.map((s) => ({ x: s.x, y: s.y, label: s.y.toFixed(2) }));
  const bands = m.points >= 8 && m.low !== null && m.high !== null && m.p25 !== null && m.p75 !== null
    ? [
      { from: m.low, to: m.p25, tone: "low" as const, label: "便宜区" },
      { from: m.p25, to: m.p75, tone: "mid" as const, label: "合理区" },
      { from: m.p75, to: m.high, tone: "high" as const, label: "偏贵区" },
    ]
    : [];
  const refLines = m.median !== null ? [{ value: m.median, label: "中位" }] : [];
  return (
    <div>
      <TrendLine points={points} height={230} tone={tone} digits={2} bands={bands} refLines={refLines} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-emerald-500/20" />便宜区（过去 25% 分位以下）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-amber-400/20" />合理区
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-rose-500/20" />偏贵区（75% 分位以上）
        </span>
      </div>
    </div>
  );
}

/** 窗口选择：四个快捷档 + 手动起止日期（手填区间优先） */
function RangePicker({ range, onRange }: { range: Range; onRange: (r: Range) => void }) {
  const [start, setStart] = useState(range.start ?? "");
  const [end, setEnd] = useState(range.end ?? "");
  useEffect(() => { setStart(range.start ?? ""); setEnd(range.end ?? ""); }, [range.start, range.end]);
  const dirty = start !== (range.start ?? "") || end !== (range.end ?? "");
  const manual = !!(range.start || range.end);
  const box = "nums rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] "
    + "text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
        {WINDOWS.map((w) => (
          <button key={w.value} type="button"
            onClick={() => onRange({ years: w.value, start: null, end: null })}
            className={cn("px-2 py-1 text-[11px] transition",
              !manual && range.years === w.value
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            {w.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        从
        <input type="date" value={start} max={end || undefined}
          onChange={(e) => setStart(e.target.value)} className={box} aria-label="开始日期" />
        到
        <input type="date" value={end} min={start || undefined}
          onChange={(e) => setEnd(e.target.value)} className={box} aria-label="结束日期" />
      </label>
      <Button size="sm" variant={dirty ? "primary" : "outline"} disabled={!dirty}
        onClick={() => onRange({ years: 0, start: start || null, end: end || null })}>应用区间</Button>
      {manual && (
        <Button size="sm" variant="ghost"
          onClick={() => onRange({ years: 0, start: null, end: null })}>清除</Button>
      )}
    </div>
  );
}

/** 横向对比：和自己历史便宜是一回事，比沪深300 贵不贵是另一回事 */
function RelativeReadout({ rel, selfName }: { rel?: ValuationRelative | null; selfName: string }) {
  if (!rel) return null;
  const points: TrendPoint[] = rel.series.map((s) => ({ x: s.x, y: s.y, label: `${s.y.toFixed(2)} 倍` }));
  return (
    <div className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50/80 p-3
      dark:border-slate-700/60 dark:bg-slate-800/40">
      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
        横向对比 · {selfName} 的 PE ÷ {rel.benchmark} 的 PE
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="nums text-xl leading-tight font-semibold text-slate-900 dark:text-slate-50">
          {rel.ratio.toFixed(2)} 倍
        </p>
        {rel.verdict && (
          <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium text-white",
            VERDICT_SOLID[rel.verdict.tone] ?? "bg-slate-400")}>
            相对{rel.verdict.label}
          </span>
        )}
        <p className="nums text-[11px] text-slate-500 dark:text-slate-400">
          比价分位 {pctText(rel.percentile, 0)} · 历史 {rel.low?.toFixed(2)} ~ 中位
          {rel.median?.toFixed(2)} ~ {rel.high?.toFixed(2)} 倍 · {rel.points} 个样本
        </p>
      </div>
      <div className="mt-2"><TrendLine points={points} height={86} tone="amber" digits={2} /></div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        左边那档说的是「比它自己历史上便宜还是贵」，这一栏说的是「比沪深300 贵多少」。
        两个都低才是真便宜；只有自己分位低、比价仍高，说明是它自己从泡沫跌下来，绝对估值依然不便宜。
      </p>
    </div>
  );
}

const overviewCols: Column<ValuationRow>[] = [
  { key: "n", label: "指数", render: (r) => (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
      {r.kind === "market" && <Chip tone="slate">全市场口径</Chip>}
      <span className="nums whitespace-nowrap text-[10px] text-slate-400">{r.code}</span>
    </div>) },
  { key: "pe", label: "PE", align: "right", value: (r) => r.pe ?? 9e9, render: (r) => (
    <span className="nums">{r.ready ? r.pe?.toFixed(2) ?? "—" : "—"}</span>) },
  { key: "pep", label: "PE 分位", align: "right", value: (r) => r.pePercentile ?? 9e9, render: (r) => (
    <span className={cn("nums", (r.pePercentile ?? 0) > 0.7 ? "text-rose-500"
      : (r.pePercentile ?? 1) < 0.3 ? "text-emerald-500" : "text-slate-500")}>
      {r.ready ? pctText(r.pePercentile, 0) : "未归档"}
    </span>) },
  { key: "ratio", label: "PE/沪深300", align: "right", value: (r) => r.peRatio ?? 0, render: (r) => (
    <span className={cn("nums whitespace-nowrap", (r.peRatioPercentile ?? 0) > 0.7 ? "text-rose-500"
      : (r.peRatioPercentile ?? 1) < 0.3 ? "text-emerald-500" : "text-slate-500")}>
      {r.peRatio ? `${r.peRatio.toFixed(2)}×` : "—"}
    </span>) },
  { key: "pb", label: "PB", align: "right", value: (r) => r.pb ?? 9e9, render: (r) => (
    <span className="nums text-slate-500">{r.ready ? r.pb?.toFixed(2) ?? "—" : "—"}</span>) },
  { key: "pbp", label: "PB 分位", align: "right", value: (r) => r.pbPercentile ?? 9e9, render: (r) => (
    <span className="nums text-slate-500">{r.ready ? pctText(r.pbPercentile, 0) : "—"}</span>) },
  { key: "range", label: "PE 历史区间", align: "right", value: (r) => r.peMedian ?? 0, render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-500">
      {r.ready ? `${r.peLow ?? "—"} ~ ${r.peHigh ?? "—"}` : "—"}
    </span>) },
  { key: "span", label: "覆盖", align: "right", value: (r) => -(r.years ?? 0), render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-400">
      {r.ready ? `${r.years ?? "—"} 年 / ${r.points ?? 0} 点` : "—"}
    </span>) },
  { key: "v", label: "判定", render: (r) => (r.verdict ? (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium text-white",
      VERDICT_SOLID[r.verdict.tone] ?? "bg-slate-400")}>{r.verdict.label}</span>
  ) : <span className="text-[11px] text-slate-400">—</span>) },
];

/** 指数概览页用：区间面板 + 宽基估值一览 */
export function ValuationSection({ initialCode = "000300.SH" }: { initialCode?: string }) {
  const [overview, setOverview] = useState<ValuationOverview | null>(null);
  const [code, setCode] = useState(initialCode);
  const [range, setRange] = useState<Range>({ years: 0, start: null, end: null });
  const [metric, setMetric] = useState<Metric>("pe");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const codeRef = useRef(initialCode);
  const now = useNow();
  const { panel, busy: panelBusy, error: panelError, reload } = useValuationPanel(code, range);

  const loadOverview = useCallback(async () => {
    setBusy(true);
    try {
      const d = await api.get<ValuationOverview>("/index/valuation/overview", {}, 30_000);
      setOverview(d);
      setError(null);
      if (d.status.running) setRebuilding(true);
      else setRebuilding(false);
      if (d.universe?.length && !d.universe.some((u) => u.code === codeRef.current)) {
        setCode(d.universe[0].code);
      }
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);
  useEffect(() => { codeRef.current = code; }, [code]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  // 估值是日线级归档，5 分钟静默重取一次就够；重建进行中改成 15 秒跟进度
  useEffect(() => {
    const ms = rebuilding ? 15_000 : 300_000;
    const t = window.setInterval(() => {
      void loadOverview();
      void reload();
    }, ms);
    return () => window.clearInterval(t);
  }, [loadOverview, reload, rebuilding]);

  const ready = (overview?.rows ?? []).filter((r) => r.ready);
  const rows = overview?.rows ?? [];
  const active = ready.find((r) => r.code === code);
  const m = metric === "pe" ? panel?.pe : panel?.pb;
  const st = panel?.status ?? overview?.status;

  return (
    <>
      <Panel
        title="宽基指数估值区间 · 现在贵不贵"
        subtitle={panel?.ok
          ? `${panel.name} · 当前${metric === "pe" ? "PE" : "PB"} ${m?.value?.toFixed(2) ?? "—"}`
            + ` · ${panel.windowLabel}分位 ${pctText(m?.percentile, 0)}`
            + ` · 数据日 ${tradeDate(m?.date ?? null)}（本地归档 ${panel.rows ?? 0} 点）`
            + ` · 查看于 ${hhmmss(now)}`
          : error ?? panelError ?? panel?.error ?? "正在读取估值历史…"}
        right={(
          <>
            <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {METRICS.map((it) => (
                <button key={it.key} type="button" onClick={() => setMetric(it.key)}
                  className={cn("px-2 py-1 text-[11px] transition",
                    metric === it.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {it.label}
                </button>
              ))}
            </div>
            <RangePicker range={range} onRange={setRange} />
            <Button size="sm" variant="outline" loading={panelBusy && !!panel}
              onClick={() => void reload(true)}>刷新</Button>
          </>
        )}
      >
        {busy && !overview ? <Skeleton className="h-28 w-full" /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {ready.map((r) => (
                <button key={r.code} type="button" onClick={() => setCode(r.code)}
                  className={cn("rounded-lg border px-2.5 py-1 text-xs transition",
                    code === r.code
                      ? "border-slate-800 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {r.name}
                  {r.verdict && (
                    <span className={cn("ml-1.5 inline-block h-2 w-2 rounded-full align-middle",
                      VERDICT_SOLID[r.verdict.tone] ?? "bg-slate-400")} />
                  )}
                </button>
              ))}
              {!ready.length && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  估值历史库还是空的{st?.running ? "，正在首次建立…" : "，点下面的「重建估值历史」拉一次"}
                </p>
              )}
            </div>

            {(panelError || (panel && !panel.ok && panel.error)) && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {panelError ?? panel?.error}
              </p>
            )}

            {panel?.ok && (
              <div className="grid gap-4 xl:grid-cols-5">
                <div className="xl:col-span-2">
                  {panel.kind === "market" && (
                    <p className="mb-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      这是{panel.name}的整体估值口径（该市场全部股票加总），不等于对应指数本身。
                    </p>
                  )}
                  <MetricReadout m={m} name={metric === "pe" ? "市盈率" : "市净率"}
                    curLabel={panel.window?.end && panel.window.end !== panel.window.last
                      ? "区间末" : "当前"} />
                  {metric === "pe" && (
                    panel.relative
                      ? <RelativeReadout rel={panel.relative} selfName={panel.name ?? "该指数"} />
                      : <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                        沪深300 是横向对比的基准，不和自己比。
                      </p>
                  )}
                </div>
                <div className="xl:col-span-3">
                  <ValuationChart m={m} tone={metric === "pe" ? "sky" : "violet"} />
                </div>
              </div>
            )}

            {active && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="sky">点位 {price(active.close ?? null)}</Chip>
                <Chip tone={peTone(active.pePercentile)}>
                  PE 分位 {pctText(active.pePercentile, 0)}
                </Chip>
                <span className="text-[11px] text-slate-400">
                  {active.begin ?? "—"} 起算，共 {active.points ?? 0} 个月度点
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" loading={rebuilding}
                onClick={async () => {
                  setRebuilding(true);
                  try {
                    const r = await api.post<{ message?: string }>("/index/valuation/rebuild", {}, 20_000);
                    if (r?.message) setError(r.message);
                  } catch (e) { setError(messageOf(e)); }
                  window.setTimeout(() => void loadOverview(), 1500);
                }}>重建估值历史</Button>
              <Button size="sm" variant="outline" loading={syncing}
                onClick={async () => {
                  setSyncing(true); setSyncMsg(null);
                  try {
                    const r = await api.post<{ message?: string }>("/index/valuation/sync", {}, 30_000);
                    setSyncMsg(r?.message ?? "云端快照已读取");
                    void loadOverview(); void reload();
                  } catch (e) { setSyncMsg(messageOf(e)); }
                  setSyncing(false);
                }}>从云端补数</Button>
              {syncMsg && (
                <span className="nums text-[11px] text-slate-500 dark:text-slate-400">{syncMsg}</span>
              )}
              {st?.running && (
                <span className="nums text-xs text-slate-500 dark:text-slate-400">
                  正在抓取 {st.done}/{st.total} 个指数{st.errors?.length ? `（${st.errors.length} 个失败）` : ""}
                </span>
              )}
              {!st?.running && st?.lastAt && (
                <span className="nums text-[11px] text-slate-400">上次归档 {st.lastAt}</span>
              )}
              <span className="text-[11px] text-slate-400">
                {overview?.note ?? "估值序列取自乐咕乐股"}
              </span>
            </div>
            {st?.errors?.length ? (
              <ul className="mt-2 space-y-0.5">
                {st.errors.map((e) => (
                  <li key={e} className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">{e}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title="宽基估值一览" bodyClass="p-0"
        subtitle={overview ? `${ready.length}/${rows.length} 个指数已归档 · 默认按 PE 分位从低到高排 · 生成于 ${overview.generatedAt}` : ""}>
        <DataTable dense loading={busy && !overview} rows={rows} rowKey={(r) => r.code}
          columns={overviewCols} empty="估值历史库还没有数据"
          sortInitial={{ key: "pep", desc: false }} />
        <p className="px-4 py-2 text-[11px] leading-relaxed text-slate-400">
          分位是把当前值放进该指数自己的历史序列里排出来的百分位：0% 表示历史上没这么便宜过，
          100% 表示史上最贵；判定档位说的都是「相对它自己历史」。
          「PE/沪深300」是同一期两个 PE 的比值，管的是横向贵不贵——自己分位低但比价仍然高，
          说明只是从泡沫里跌下来，绝对估值依然不便宜。
          PE 用整体法滚动口径（TTM），样本为月度收盘点；
          全市场口径那四条统计的是沪市/深市/创业板/科创板全部股票，和「上证指数」「深证成指」这两个指数本身不完全等价。
        </p>
      </Panel>
    </>
  );
}

/** 指数成分页用：只给当前指数的估值结论一行 + 迷你区间折线 */
const ALL_HISTORY: Range = { years: 0, start: null, end: null };

export function ValuationSummary({ code, label, note }:
  { code?: string | null; label: string; note?: string | null }) {
  const { panel, busy, error, reload } = useValuationPanel(code ?? null, ALL_HISTORY);
  const now = useNow(!!code);
  if (!code) {
    return (
      <Panel title={`${label} 估值区间`}
        subtitle="这个指数没有可比的长历史估值源">
        <EmptyState text={`${label}没有估值长序列`}
          hint="乐咕乐股只覆盖部分宽基，北证50 上线太晚没有长历史；这个页面看成分股自己的 PE/PB 更靠谱" />
      </Panel>
    );
  }
  const pe = panel?.pe;
  return (
    <Panel title={`${label} 估值区间`}
      subtitle={panel?.ok && pe
        ? `当前 PE ${pe.value?.toFixed(2) ?? "—"} · 全部历史分位 ${pctText(pe.percentile, 0)}`
          + ` · 中位 ${pe.median?.toFixed(2) ?? "—"} · 区间 ${pe.low?.toFixed(2) ?? "—"} ~ ${pe.high?.toFixed(2) ?? "—"}`
          + ` · 数据日 ${pe.date ?? "—"} · 查看于 ${hhmmss(now)}`
        : error ?? panel?.error ?? "正在读取估值历史…"}
      right={<Button size="sm" variant="outline" loading={busy && !!panel}
        onClick={() => void reload(true)}>刷新</Button>}
    >
      {note && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-700
          dark:bg-sky-500/10 dark:text-sky-300">{note}</p>
      )}
      {busy && !panel ? <Skeleton className="h-24 w-full" /> : panel?.ok && pe ? (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <MetricReadout m={pe} name="市盈率" />
            {panel.pb && panel.pb.value !== null && (
              <p className="nums mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                同期 PB {panel.pb.value.toFixed(2)} · 分位 {pctText(panel.pb.percentile, 0)}
              </p>
            )}
            <RelativeReadout rel={panel.relative} selfName={panel.name ?? label} />
          </div>
          <div className="xl:col-span-3"><ValuationChart m={pe} tone="sky" /></div>
        </div>
      ) : (
        <EmptyState text="没有这个指数的估值历史" hint={panel?.error ?? error ?? "等归档任务跑完再看"} />
      )}
    </Panel>
  );
}
