import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../lib/api";
import type {
  MarketFlowResult, SectorFlowResult, StockFlowDailyResult, StockFlowResult, StockFlowRow,
} from "../lib/types";
import { money, num, price, tradeDate, yi } from "../lib/format";
import { FundFlowChart } from "../components/charts";
import {
  Button, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, type Column,
} from "../components/ui";
import { toast } from "../store/toast";

const KINDS = [
  { key: "industry", label: "行业板块" },
  { key: "concept", label: "概念板块" },
  { key: "region", label: "地域板块" },
];

export default function InfoFundFlowPage() {
  const [market, setMarket] = useState<MarketFlowResult | null>(null);
  const [sector, setSector] = useState<SectorFlowResult | null>(null);
  const [stocks, setStocks] = useState<StockFlowResult | null>(null);
  const [kind, setKind] = useState("industry");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [pick, setPick] = useState<StockFlowRow | null>(null);
  const [daily, setDaily] = useState<StockFlowDailyResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMarket = useCallback(async () => {
    try {
      setMarket(await api.get<MarketFlowResult>("/info/fund-flow/market", {}, 60_000));
    } catch (e) { setError(messageOf(e)); }
  }, []);

  const loadSector = useCallback(async (k: string) => {
    try {
      setSector(await api.get<SectorFlowResult>("/info/fund-flow/sectors", { kind: k, limit: 60 }, 60_000));
    } catch (e) { setError(messageOf(e)); }
  }, []);

  const loadStocks = useCallback(async (d: "in" | "out") => {
    try {
      setStocks(await api.get<StockFlowResult>("/info/fund-flow/stocks", { direction: d, limit: 60 }, 60_000));
    } catch (e) { setError(messageOf(e)); }
  }, []);

  useEffect(() => {
    setBusy(true);
    void Promise.all([loadMarket(), loadSector(kind), loadStocks(direction)]).finally(() => setBusy(false));
  }, [loadMarket, loadSector, loadStocks, kind, direction]);

  useEffect(() => {
    if (!pick) { setDaily(null); return; }
    let live = true;
    setDaily(null);
    api.get<StockFlowDailyResult>("/info/fund-flow/stock", { symbol: pick.symbol, days: 20 }, 60_000)
      .then((r) => { if (live) setDaily(r); })
      .catch((e) => { if (live) toast(messageOf(e), "error"); });
    return () => { live = false; };
  }, [pick]);

  const net = market?.industryNet ?? null;
  const cols: Column<StockFlowRow>[] = [
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-nowrap text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
      </div>) },
    { key: "price", label: "现价", align: "right", value: (r) => r.price, render: (r) => (
      <span className="nums">{price(r.price)}</span>) },
    { key: "chg", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
      render: (r) => <UpDown value={r.changePercent} /> },
    { key: "net", label: "主力净流入", align: "right", value: (r) => r.netAmount, render: (r) => (
      <span className={cn("nums font-semibold", (r.netAmount ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
        {money(r.netAmount)}
      </span>) },
    { key: "ratio", label: "净占比", align: "right", value: (r) => r.netRatio, render: (r) => (
      <span className="nums">{r.netRatio === null ? "—" : `${r.netRatio.toFixed(2)}%`}</span>) },
    { key: "in", label: "流入", align: "right", value: (r) => r.inAmount,
      render: (r) => <span className="nums text-slate-500">{money(r.inAmount)}</span> },
    { key: "out", label: "流出", align: "right", value: (r) => r.outAmount,
      render: (r) => <span className="nums text-slate-500">{money(r.outAmount)}</span> },
    { key: "amount", label: "成交额", align: "right", value: (r) => r.amount,
      render: (r) => <span className="nums text-slate-500">{money(r.amount)}</span> },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="大盘资金概览"
        subtitle={market
          ? `${market.generatedAt} · 行业板块口径 ${market.boardCount ?? 0} 个板块合计 · 快照交易日 ${tradeDate(market.daily?.trade_date ?? null)}`
          : error ?? "正在汇总板块资金流与两市成交额…"}
        right={<Button size="sm" variant="outline" loading={busy && !!market}
          onClick={() => { void loadMarket(); void loadSector(kind); void loadStocks(direction); }}>刷新</Button>}
      >
        {busy && !market ? <Skeleton className="h-24 w-full" /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="行业板块主力净流入" value={net === null ? "—" : yi(net)}
              tone={net === null ? undefined : net >= 0 ? "up" : "down"}
              hint="全市场行业板块大单净流入合计（新浪盘中口径，元→亿元）" />
            <Card label="板块总流入 / 总流出"
              value={market ? `${yi(market.inAmount)} / ${yi(market.outAmount)}` : "—"}
              hint="流入流出为各板块汇总，与两市成交额口径接近" />
            <Card label="两市成交额"
              value={market?.daily ? `${num(market.daily.amount ?? null, 0)} 亿` : "—"}
              hint={market?.amountChange !== undefined && market?.amountChange !== null
                ? `较上一交易日 ${market.amountChange >= 0 ? "+" : ""}${market.amountChange.toFixed(2)} 亿`
                : "来自最近一次收盘快照"} />
            <Card label="北向资金"
              value={market?.northToday ? yi(market.northToday) : (market?.northNote ? "停止披露" : "—")}
              hint={market?.north5d !== null && market?.north5d !== undefined
                ? `近 5 日合计 ${yi(market.north5d)} 亿`
                : market?.northNote ?? "接口暂无净买入数据"} />
          </div>
        )}
        {!!market && Object.keys(market.errors ?? {}).length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {Object.entries(market.errors).map(([k, v]) => `${k}：${v}`).join("；")}
          </p>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="板块资金流"
          subtitle={sector
            ? `${sector.rows.length} 个板块 · 净流入合计 ${yi(sector.sumNet)} · ${tradeDate(sector.date ?? null)}`
            : "按主力净流入排序"}
          right={(
            <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {KINDS.map((k) => (
                <button key={k.key} type="button" onClick={() => setKind(k.key)}
                  className={cn("px-2 py-1 text-xs transition",
                    kind === k.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
        >
          {busy && !sector ? <Skeleton className="h-64 w-full" />
            : !sector || sector.rows.length === 0
              ? <EmptyState text="板块资金流为空" hint={sector?.error ?? "新浪资金流接口偶发拒绝，稍后重试"} />
              : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <NetList title="净流入前 10" rows={sector.rows.slice(0, 10)} />
                  <NetList title="净流出前 10"
                    rows={[...sector.rows].sort((a, b) => (a.netAmount ?? 0) - (b.netAmount ?? 0)).slice(0, 10)} />
                </div>
              )}
        </Panel>

        <Panel title="个股主力资金"
          subtitle={stocks
            ? `取 ${stocks.rows.length} 只 · ${direction === "in" ? "净流入榜" : "净流出榜"} · 点一行看该股本月资金流历史`
            : "新浪盘中口径"}
          right={(
            <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {(["in", "out"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDirection(d)}
                  className={cn("px-2.5 py-1 text-xs transition",
                    direction === d ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {d === "in" ? "净流入" : "净流出"}
                </button>
              ))}
            </div>
          )}
          bodyClass="p-0"
        >
          <DataTable columns={cols} rows={stocks?.rows ?? []} rowKey={(r) => r.symbol}
            loading={busy && !stocks} dense maxHeight="360px"
            empty="个股资金流暂无数据"
            onRowClick={(r) => setPick(pick?.symbol === r.symbol ? null : r)} />
        </Panel>
      </div>

      {pick && (
        <Panel title={`${pick.name} 主力资金历史`}
          subtitle={daily ? `近 ${daily.rows.length} 个交易日 · 累计主力净流入 ${yi(daily.cumNet)} · 点其他行可切换`
            : "正在读取该股按日资金流…"}
          right={<Button size="sm" variant="ghost" onClick={() => setPick(null)}>关闭</Button>}
        >
          {!daily ? <Skeleton className="h-32 w-full" /> : daily.rows.length === 0 ? (
            <EmptyState text="没有按日资金流数据" hint={daily.error ?? "该股可能停牌或数据源未覆盖"} />
          ) : (
            <>
              <FundFlowChart rows={daily.rows.map((r) => ({
                date: r.date, mainNet: r.mainNet, netAmount: r.netAmount ?? 0,
              }))} height={130} />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      {["日期", "收盘", "涨跌幅", "特大单净额", "大单净额", "中单净额", "小单净额", "主力净额"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {daily.rows.slice(-10).reverse().map((r) => (
                      <tr key={r.date}>
                        <td className="nums whitespace-nowrap px-2 py-1 text-slate-500">{r.date}</td>
                        <td className="nums px-2 py-1">{price(r.close)}</td>
                        <td className="px-2 py-1"><UpDown value={r.changePercent} /></td>
                        <NetCell v={r.superNet} /><NetCell v={r.bigNet} />
                        <NetCell v={r.midNet} /><NetCell v={r.smallNet} />
                        <NetCell v={r.mainNet} strong />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40"
      title={hint}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums mt-1 text-lg font-semibold",
        tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-500" : "text-slate-800 dark:text-slate-100")}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-400">{hint}</p>}
    </div>
  );
}

function NetList({ title, rows }: { title: string; rows: { name: string; netAmount: number | null; avgChangePercent: number | null; leaderName: string | null; leaderSymbol: string | null }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.netAmount ?? 0)));
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => {
          const v = r.netAmount ?? 0;
          return (
            <li key={r.name} className="flex items-center gap-2" title={`${r.name} 龙头 ${r.leaderName ?? "—"}`}>
              <span className="w-28 shrink-0 text-xs leading-tight text-slate-600 dark:text-slate-300">{r.name}</span>
              <span className="relative h-3 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <span className={cn("absolute inset-y-0", v >= 0 ? "left-1/2 bg-rose-500" : "right-1/2 bg-emerald-500")}
                  style={{ width: `${(Math.abs(v) / max) * 50}%` }} />
                <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
              </span>
              <span className="nums w-16 shrink-0 text-right text-xs font-medium text-slate-700 dark:text-slate-200">
                {num(v / 1e8, 2)}
              </span>
              <span className="w-14 shrink-0 text-right"><UpDown value={r.avgChangePercent} /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NetCell({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  return (
    <td className={cn("nums px-2 py-1", (v ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500",
      strong && "font-semibold")}>{money(v ?? null)}</td>
  );
}
