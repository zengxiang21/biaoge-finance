import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { LadderFull, LadderStock } from "../lib/types";
import { money, num, price, tradeDate, yi } from "../lib/format";
import { dirOf } from "../lib/colors";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass,
} from "../components/ui";
import { toast } from "../store/toast";

type PoolKey = "up" | "blown" | "down";

const POOLS: { key: PoolKey; label: string; hint: string }[] = [
  { key: "up", label: "涨停池", hint: "封住涨停的票，按连板分层" },
  { key: "blown", label: "炸板池", hint: "摸过涨停但没封住" },
  { key: "down", label: "跌停池", hint: "封死跌停的票" },
];

const TIER_TONE = (level: number) =>
  level >= 5 ? "bg-rose-700" : level >= 3 ? "bg-rose-600" : level === 2 ? "bg-orange-500" : "bg-slate-500";

export default function LimitLadderPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LadderFull | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolKey>("up");
  const [board, setBoard] = useState("");
  const [keyword, setKeyword] = useState("");
  const [openTier, setOpenTier] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (b: string, kw: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<LadderFull>("/dashboard/ladder",
        { full: true, ...(b ? { board: b } : {}), ...(kw ? { keyword: kw } : {}) }, 30_000);
      setData(r);
    } catch (e) {
      setError(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const kw = keyword.trim();
    timer.current = window.setTimeout(() => void load(board, kw), kw ? 320 : 0);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [load, board, keyword]);

  const s = data?.stats;
  const y = data?.yesterday;
  const shown: LadderStock[] = useMemo(() => {
    if (!data) return [];
    if (pool === "up") return data.tiers.flatMap((t) => t.stocks);
    return pool === "blown" ? data.blown : data.down;
  }, [data, pool]);

  return (
    <div className="space-y-4">
      <Panel
        title="涨停梯队"
        subtitle={data
          ? `${tradeDate(data.trade_date)} · 最高 ${data.max_lbc} 板 · 涨停 ${data.stats.limitUp} 只 / 首板 ${data.first_board_count} 只 · 情绪 ${data.stats.score ?? "—"}`
          : "正在读取当日涨停池…"}
        right={(
          <>
            <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {POOLS.map((p) => (
                <button key={p.key} type="button" title={p.hint}
                  onClick={() => setPool(p.key)}
                  className={cn("px-2.5 py-1 text-xs transition",
                    pool === p.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {p.label}
                  <span className="nums ml-1 opacity-70">
                    {p.key === "up" ? (s?.poolRows.up ?? 0) : (s?.poolRows[p.key] ?? 0)}
                  </span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" loading={busy} onClick={() => void load(board, keyword.trim())}>刷新</Button>
          </>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Stat label="涨停" value={s?.limitUp ?? null} unit="只" tone="up"
            hint="东财涨停池口径：按各板真实涨停价（主板 10%、创业/科创 20%、北交所 30%、ST 5%）" />
          <Stat label="跌停" value={s?.limitDown ?? null} unit="只" tone="down" />
          <Stat label="炸板" value={s?.blown ?? null} unit="只" tone="flat"
            hint="摸到涨停价又打开的，计进炸板率分母" />
          <Stat label="封板率" value={s?.sealRate ?? null} unit="%" digits={1}
            hint="涨停 /（涨停 + 炸板），越高说明资金越愿意接力" />
          <Stat label="最高连板" value={data ? data.max_lbc : null} unit="板" tone="up"
            hint="当天最高的高度，决定情绪周期位置" />
          <Stat label="首板" value={data ? data.first_board_count : null} unit="只"
            hint="1 连板，题材扩散的新鲜度" />
          <Stat label="昨日晋级率" value={y?.promotionRate ?? null} unit="%" digits={1}
            hint={`${y?.date ? tradeDate(y.date) : "—"} 的连板股今天继续往上打板的比例；首板 ${y?.firstRate ?? "—"}%、二板以上 ${y?.contRate ?? "—"}%`} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setBoard("")}
            className={cn("rounded-md border px-2 py-0.5 text-[11px] transition",
              board === "" ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                : "border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300")}>
            全部板块
          </button>
          {(data?.boards ?? []).map((b) => (
            <button key={b.key} type="button" onClick={() => setBoard(board === b.key ? "" : b.key)}
              className={cn("nums rounded-md border px-2 py-0.5 text-[11px] transition",
                board === b.key ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300")}>
              {b.label} {b.count}
            </button>
          ))}
          <input className={cn(inputClass, "ml-auto w-full sm:w-56")} value={keyword}
            placeholder="搜名称或代码，比如 兆威 / 600838"
            onChange={(e) => setKeyword(e.target.value)} />
        </div>
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
      </Panel>

      {busy && !data && (
        <Panel title="加载中"><div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div></Panel>
      )}

      {data && pool === "up" && data.tiers.length === 0 && (
        <Panel title="连板梯队">
          <EmptyState text={keyword || board ? "筛选后没有标的" : "当天没有涨停池数据"}
            hint={keyword || board ? "换个关键词或点「全部板块」" : "休市日或池子接口未返回，重建快照后再看"} />
        </Panel>
      )}

      {data && pool === "up" && data.tiers.length > 0 && (
        <Panel title="连板梯队"
          subtitle="每档按封单资金降序 · 点个股名进分析页 · 标签来自板块成分（行业 + 概念）">
          <ul className="space-y-3">
            {data.tiers.map((tier) => {
              const collapsed = tier.count > 12 && openTier !== tier.level;
              const rows = collapsed ? tier.stocks.slice(0, 12) : tier.stocks;
              return (
                <li key={tier.level} className="rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                    <span className={cn("nums rounded px-2 py-0.5 text-xs font-semibold text-white", TIER_TONE(tier.level))}>
                      {tier.level} 板
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{tier.count} 只</span>
                    <span className="nums text-[11px] text-slate-400">封单合计 {yi(tier.sealFund)}</span>
                    {tier.level === data.max_lbc && tier.level >= 2 && <Chip tone="rose">最高板</Chip>}
                    {tier.count > 12 && (
                      <Button size="sm" variant="ghost" className="ml-auto"
                        onClick={() => setOpenTier(openTier === tier.level ? null : tier.level)}>
                        {openTier === tier.level ? "收起" : `展开全部 ${tier.count} 只`}
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-1.5 p-2 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((st) => (
                      <LadderCard key={st.symbol} stock={st} onOpen={() => navigate(`/stock-analysis/${st.symbol}`)} />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {data && pool !== "up" && (
        <Panel title={POOLS.find((p) => p.key === pool)!.label}
          subtitle={POOLS.find((p) => p.key === pool)!.hint + ` · ${shown.length} 只`}>
          {shown.length === 0 ? (
            <EmptyState text="这一天没有该池的数据" hint="重建快照或换一天再看" />
          ) : (
            <DataTable
              dense
              rows={shown}
              rowKey={(r) => r.symbol}
              maxHeight="max-h-[560px]"
              sortInitial={{ key: "change_percent", desc: true }}
              onRowClick={(r) => navigate(`/stock-analysis/${r.symbol}`)}
              columns={[
                { key: "name", label: "名称/代码", render: (r) => (
                  <span>{r.name}<span className="nums ml-1.5 text-[10px] text-slate-400">{r.symbol}</span>
                    {r.isSt && <Chip className="ml-1.5" tone="amber">ST</Chip>}
                    {r.oneWord && <Chip className="ml-1.5" tone="rose">一字</Chip>}</span>) },
                { key: "price", label: "现价", align: "right", value: (r) => r.price,
                  render: (r) => <span className="nums">{price(r.price)}</span> },
                { key: "change_percent", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
                  render: (r) => <UpDown value={r.change_percent} /> },
                ...(pool === "blown"
                  ? [{ key: "limitPrice", label: "涨停价", align: "right" as const, value: (r: LadderStock) => r.limitPrice ?? null,
                      render: (r: LadderStock) => <span className="nums text-slate-500">{price(r.limitPrice ?? null)}</span> },
                    { key: "zb_count", label: "炸板次数", align: "right" as const, value: (r: LadderStock) => r.zb_count ?? 0,
                      render: (r: LadderStock) => <span className="nums">{r.zb_count ?? 0}</span> },
                    { key: "fbt", label: "首次封板", align: "right" as const, render: (r: LadderStock) => <span className="nums text-slate-500">{r.fbt ?? "—"}</span> }]
                  : [{ key: "lbc", label: "连续跌停", align: "right" as const, value: (r: LadderStock) => r.lbc ?? 1,
                      render: (r: LadderStock) => <span className="nums">{r.lbc ?? 1} 天</span> },
                    { key: "zb_count", label: "开板次数", align: "right" as const, value: (r: LadderStock) => r.zb_count ?? 0,
                      render: (r: LadderStock) => (
                        <span className={cn("nums", (r.zb_count ?? 0) >= 5 && "font-semibold text-amber-600 dark:text-amber-400")}>
                          {r.zb_count ?? 0}
                        </span>) },
                    { key: "fund", label: "封单资金", align: "right" as const, value: (r: LadderStock) => r.fund ?? null,
                      render: (r: LadderStock) => <span className="nums text-slate-500">{money(r.fund ?? null)}</span> },
                    { key: "lbt", label: "最后封板", align: "right" as const, render: (r: LadderStock) => <span className="nums text-slate-500">{r.lbt ?? "—"}</span> }]),
                { key: "amount", label: "成交额", align: "right", value: (r) => r.amount ?? null,
                  render: (r) => <span className="nums text-slate-500">{money(r.amount ?? null)}</span> },
                { key: "turnover", label: "换手", align: "right", value: (r) => r.turnover ?? null,
                  render: (r) => <span className="nums text-slate-500">{num(r.turnover, 2, "%")}</span> },
                { key: "boardLabel", label: "板块", render: (r) => (
                  <span className="text-[11px] text-slate-500">{r.boardLabel ?? "—"}{r.sector ? ` · ${r.sector}` : ""}</span>) },
                { key: "tags", label: "标签", render: (r) => (
                  <span className="flex flex-wrap gap-1">{(r.tags ?? []).slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}
                    {!(r.tags ?? []).length && <span className="text-[11px] text-slate-400">—</span>}</span>) },
              ]}
            />
          )}
        </Panel>
      )}

      {data && y?.date && (
        <Panel title="昨日连板今日表现"
          subtitle={`${tradeDate(y.date)} 共 ${y.total ?? 0} 只连板股 · 晋级 ${y.promoted ?? 0} 只（${y.promotionRate ?? "—"}%）` +
            ` · 首板→二板 ${y.firstPromoted ?? 0}/${y.firstTotal ?? 0}（${y.firstRate ?? "—"}%）` +
            ` · 二板以上再上 ${y.contPromoted ?? 0}/${y.contTotal ?? 0}（${y.contRate ?? "—"}%）`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <MoveTable title="晋级" tone="up" rows={y.promotedList ?? []} empty="昨天没有票今天继续打板"
              onOpen={(sym) => navigate(`/stock-analysis/${sym}`)} />
            <MoveTable title="断板 / 降级" tone="down" rows={y.brokenList ?? []} empty="昨天连板的今天全晋级了"
              onOpen={(sym) => navigate(`/stock-analysis/${sym}`)} />
          </div>
        </Panel>
      )}

      {data && !y?.date && (
        <Panel title="昨日连板今日表现">
          <EmptyState text="库里只有当天一天的涨停池" hint="补齐前一交易日涨停池后这里会算晋级率（收盘快照任务会自动补）" />
        </Panel>
      )}
    </div>
  );
}

function Stat({
  label, value, unit, tone, digits = 0, hint,
}: { label: string; value: number | null | undefined; unit: string; tone?: "up" | "down" | "flat"; digits?: number; hint?: string }) {
  const dir = tone ? (tone === "flat" ? "flat" : tone) : dirOf(value);
  return (
    <div title={hint} className="rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/40">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums mt-0.5 text-xl font-semibold",
        dir === "up" ? "text-rose-500" : dir === "down" ? "text-emerald-500" : "text-slate-700 dark:text-slate-200")}>
        {value === null || value === undefined ? "—" : value.toFixed(digits)}
        <span className="ml-0.5 text-[11px] font-normal text-slate-400">{value === null || value === undefined ? "" : unit}</span>
      </p>
    </div>
  );
}

function LadderCard({ stock, onOpen }: { stock: LadderStock; onOpen: () => void }) {
  return (
    <div className="group rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 transition hover:border-rose-200 hover:bg-rose-50/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/5">
      <div className="flex items-baseline gap-2">
        <button type="button" onClick={onOpen}
          className="truncate text-[13px] font-medium text-slate-800 underline-offset-2 hover:underline dark:text-slate-100">
          {stock.name}
        </button>
        <span className="nums shrink-0 text-[10px] text-slate-400">{stock.symbol}</span>
        {!!stock.stat && (
          <span className="nums shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
            title="涨停统计：几天几板（连板数之外的历史强度）">{stock.stat}</span>
        )}
        <span className="nums ml-auto shrink-0 text-[13px]">{price(stock.price)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <UpDown value={stock.change_percent} />
        <span className="nums">封单 {money(stock.fund ?? null)}</span>
        <span className="nums">成交 {money(stock.amount ?? null)}</span>
        <span className="nums">换手 {num(stock.turnover, 2, "%")}</span>
        <span className="nums" title={stock.reseal ? "涨停打开后又回封" : "首次封板时间"}>
          首封 {stock.fbt ?? "—"}{stock.reseal ? " · 回封" : ""}
        </span>
        {!!stock.zb_count && (
          <span className="nums text-amber-600 dark:text-amber-400">炸板 {stock.zb_count} 次</span>
        )}
        <span className="nums opacity-70">{stock.boardLabel}</span>
        {stock.oneWord && <Chip tone="rose">一字</Chip>}
        {stock.isSt && <Chip tone="amber">ST</Chip>}
      </div>
      {!!stock.tags?.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {stock.tags.map((t) => <Chip key={t} className="max-w-full truncate">{t}</Chip>)}
        </div>
      )}
    </div>
  );
}

function MoveTable({
  title, tone, rows, empty, onOpen,
}: {
  title: string; tone: "up" | "down"; rows: LadderFull["yesterday"]["promotedList"]; empty: string;
  onOpen: (symbol: string) => void;
}) {
  const list = rows ?? [];
  return (
    <div>
      <p className={cn("mb-1.5 text-xs font-semibold", tone === "up" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
        {title} · {list.length} 只
      </p>
      {list.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-400 dark:bg-slate-800/50">{empty}</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-auto rounded-lg bg-slate-50/70 p-1.5 dark:bg-slate-800/40">
          {list.map((r) => (
            <li key={r.symbol}>
              <button type="button" onClick={() => onOpen(r.symbol)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-white dark:hover:bg-slate-900">
                <span className="w-20 shrink-0 truncate font-medium sm:w-24">{r.name}</span>
                <span className="nums w-14 shrink-0 text-[11px] text-slate-400">{r.lbc}→{r.newLbc || "断"}</span>
                <span className="nums w-16 shrink-0"><UpDown value={r.todayChange} /></span>
                <span className="nums w-28 shrink-0 whitespace-nowrap text-slate-500">{r.fund ? `封单${money(r.fund)}` : ""}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{r.sector ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
