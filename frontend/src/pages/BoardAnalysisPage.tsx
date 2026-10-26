import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type {
  BoardHeatResult, BoardHeatRow, BoardMembersResult, SectorFlowResult,
} from "../lib/types";
import { money, num, price, tradeDate, yi } from "../lib/format";
import { HeatBars } from "../components/charts";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";

type Props = { kind: "concept" | "industry" };

const LABEL = { concept: "概念", industry: "行业" } as const;

export default function BoardAnalysisPage({ kind }: Props) {
  const [view, setView] = useState<"heat" | "flow">("heat");
  const [heat, setHeat] = useState<BoardHeatResult | null>(null);
  const [flow, setFlow] = useState<SectorFlowResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<BoardHeatRow | null>(null);
  const [members, setMembers] = useState<BoardMembersResult | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [kw, setKw] = useState("");

  const loadHeat = useCallback(async () => {
    try {
      setHeat(await api.get<BoardHeatResult>("/market-data/boards/heat",
        { kind, limit: 40, with_flow: true }, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
  }, [kind]);

  const loadFlow = useCallback(async () => {
    try {
      setFlow(await api.get<SectorFlowResult>("/market-data/boards/flow", { kind, limit: 60 }, 60_000));
    } catch (e) { setError(messageOf(e)); }
  }, [kind]);

  useEffect(() => {
    setPick(null);
    setFlow(null);
    setBusy(true);
    void Promise.all([loadHeat(), loadFlow()]).finally(() => setBusy(false));
  }, [loadHeat, loadFlow]);

  useEffect(() => {
    if (!pick) { setMembers(null); return; }
    let live = true;
    setMemberBusy(true);
    setMembers(null);
    api.get<BoardMembersResult>("/market-data/boards/members",
      { kind, code: pick.code, name: pick.name, limit: 120 }, 60_000)
      .then((r) => { if (live) setMembers(r); })
      .catch((e) => { if (live) setError(messageOf(e)); })
      .finally(() => { if (live) setMemberBusy(false); });
    return () => { live = false; };
  }, [pick, kind]);

  const rows = heat?.rows ?? [];
  const filtered = kw.trim()
    ? rows.filter((r) => r.name.includes(kw.trim()) || r.code.includes(kw.trim()))
    : rows;

  const heatCols: Column<BoardHeatRow>[] = [
    { key: "name", label: `${LABEL[kind]}板块`, value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-normal text-[13px] font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.code}</span>
      </div>) },
    { key: "chg", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
      render: (r) => <UpDown value={r.change_percent} /> },
    { key: "count", label: "成分家数", align: "right", value: (r) => r.members_local ?? r.stock_count,
      render: (r) => <span className="nums text-slate-500">{r.members_local ?? r.stock_count ?? "—"}</span> },
    { key: "amount", label: "成交额", align: "right",
      value: (r) => r.amount_local ?? r.amount, render: (r) => (
        <span className="nums text-slate-500">{yi(r.amount_local ?? r.amount ?? null)}</span>) },
    { key: "turn", label: "换手率", align: "right", value: (r) => r.turnover_local ?? null, render: (r) => (
      <span className="nums text-slate-500">{r.turnover_local === null || r.turnover_local === undefined
        ? "—" : `${r.turnover_local.toFixed(2)}%`}</span>) },
    { key: "net", label: "主力净流入", align: "right", value: (r) => r.netAmount ?? null, render: (r) => (
      r.netAmount === null || r.netAmount === undefined ? <span className="text-slate-400">—</span>
        : <span className={cn("nums font-semibold", r.netAmount >= 0 ? "text-rose-500" : "text-emerald-500")}>
          {yi(r.netAmount)}
        </span>) },
    { key: "ratio", label: "净占比", align: "right", value: (r) => r.netRatio ?? null, render: (r) => (
      <span className="nums text-slate-500">{r.netRatio === null || r.netRatio === undefined
        ? "—" : `${r.netRatio.toFixed(2)}%`}</span>) },
    { key: "leader", label: "龙头股", value: (r) => r.leader_name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-normal text-xs text-slate-700 dark:text-slate-200">
          {r.leader_name ?? "—"}
        </span>
        {r.leader_local && <span className="ml-1 text-[10px] text-sky-500" title="龙头按本地成分股当日涨幅重算">本地重算</span>}
        <span className="nums ml-1.5 text-[11px] text-slate-400">
          {r.leader_change === null || r.leader_change === undefined ? "" : `${r.leader_change.toFixed(2)}%`}
        </span>
      </div>) },
    { key: "movers", label: "领涨/领跌", render: (r) => <Movers row={r} /> },
  ];

  const flowRows = flow?.rows ?? [];
  const flowCols: Column<SectorFlowResult["rows"][number]>[] = [
    { key: "name", label: "板块", value: (r) => r.name, render: (r) => (
      <span className="whitespace-normal text-[13px] text-slate-800 dark:text-slate-100">{r.name}</span>) },
    { key: "avg", label: "平均涨跌幅", align: "right", value: (r) => r.avgChangePercent,
      render: (r) => <UpDown value={r.avgChangePercent} /> },
    { key: "net", label: "净流入", align: "right", value: (r) => r.netAmount, render: (r) => (
      <span className={cn("nums font-semibold", (r.netAmount ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
        {money(r.netAmount ?? null)}
      </span>) },
    { key: "in", label: "流入", align: "right", value: (r) => r.inAmount,
      render: (r) => <span className="nums text-slate-500">{money(r.inAmount ?? null)}</span> },
    { key: "out", label: "流出", align: "right", value: (r) => r.outAmount,
      render: (r) => <span className="nums text-slate-500">{money(r.outAmount ?? null)}</span> },
    { key: "ratio", label: "净占比", align: "right", value: (r) => r.netRatio, render: (r) => (
      <span className="nums text-slate-500">{r.netRatio === null ? "—" : `${r.netRatio.toFixed(2)}%`}</span>) },
    { key: "leader", label: "领涨股", value: (r) => r.leaderName, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-normal text-xs text-slate-700 dark:text-slate-200">
          {r.leaderName ?? "—"}
        </span>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.leaderSymbol ?? ""}</span>
        <UpDown value={r.leaderChangePercent} className="ml-1.5 text-[11px]" />
      </div>) },
  ];

  const memberCols = members ? memberColumns() : [];

  return (
    <div className="space-y-4">
      <Panel
        title={`${LABEL[kind]}分析`}
        subtitle={heat
          ? `${heat.kindLabel} · 交易日 ${tradeDate(heat.trade_date)} · ${heat.count} 个板块（涨 ${heat.upCount} / 跌 ${heat.downCount}）`
            + `${flow ? ` · 板块主力净流入合计 ${yi(flow.sumNet)}` : ""}`
          : error ?? `正在汇总${LABEL[kind]}热度与成分…`}
        right={(
          <>
            <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {(["heat", "flow"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={cn("px-2.5 py-1 text-xs transition",
                    view === v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {v === "heat" ? `${LABEL[kind]}热度榜` : "板块资金流"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" loading={busy && !!heat}
              onClick={() => { setPick(null); void loadHeat(); void loadFlow(); }}>刷新</Button>
          </>
        )}
      >
        {busy && !heat ? <Skeleton className="h-16 w-full" /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">领涨 {LABEL[kind]}板块</p>
              <HeatBars rows={(heat?.top ?? []).slice(0, 10).map((r) => ({
                code: r.code, name: r.name, changePercent: r.change_percent,
                stockCount: r.members_local ?? r.stock_count,
              }))} onClick={(code) => setPick((heat?.rows ?? []).find((r) => r.code === code) ?? null)} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">领跌 {LABEL[kind]}板块</p>
              <HeatBars rows={[...(heat?.bottom ?? [])].reverse().slice(0, 10).map((r) => ({
                code: r.code, name: r.name, changePercent: r.change_percent,
                stockCount: r.members_local ?? r.stock_count,
              }))} onClick={(code) => setPick((heat?.rows ?? []).find((r) => r.code === code) ?? null)} />
            </div>
          </div>
        )}
        {heat?.flowError && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            板块资金流：{heat.flowError}
          </p>
        )}
      </Panel>

      {view === "heat" ? (
        <Panel title={`${LABEL[kind]}热度明细`}
          subtitle={heat ? `交易日 ${tradeDate(heat.trade_date)} · 点一行看该板块成分股（当前 ${filtered.length} 行）` : ""}
          right={<input value={kw} onChange={(e) => setKw(e.target.value)} placeholder={`筛${LABEL[kind]}名`}
            className={cn(inputClass, "h-8 w-28! shrink-0 !py-1 text-xs")} />}
          bodyClass="p-0">
          <DataTable columns={heatCols} rows={filtered} rowKey={(r) => r.code}
            loading={busy && !heat} dense maxHeight="460px"
            sortInitial={{ key: "chg", desc: true }}
            empty={kw ? `没有匹配「${kw}」的板块` : "板块热度为空，先在仪表盘重建收盘快照"}
            onRowClick={(r) => setPick(pick?.code === r.code ? null : r)} />
        </Panel>
      ) : (
        <Panel title="板块主力资金流"
          subtitle={flow ? `新浪盘中口径 · ${flow.rows.length} 个板块 · 交易日 ${tradeDate(flow.date)} · 合计净流入 ${yi(flow.sumNet)}`
            : "正在读取板块资金流…"}
          bodyClass="p-0">
          <DataTable columns={flowCols} rows={flowRows} rowKey={(r) => r.code}
            loading={busy && !flow} dense maxHeight="520px"
            sortInitial={{ key: "net", desc: true }}
            empty={flow?.error ?? "板块资金流暂无数据"} />
        </Panel>
      )}

      {pick && (
        <Panel
          title={`${pick.name} · 成分股`}
          subtitle={members
            ? `${members.rows.length} 只（取前 ${members.rows.length}）· 交易日 ${tradeDate(members.trade_date)} · `
              + `涨 ${members.upCount} 跌 ${members.downCount} · 均涨 ${num(members.avgChange, 2)}% · `
              + `合计成交 ${yi(members.totalAmount)} · 涨停 ${members.limitUp} 家`
            : memberBusy ? "正在读取该板块成分名单…" : ""}
          right={(
            <>
              <Chip tone={pick.netAmount && pick.netAmount >= 0 ? "rose" : "emerald"}>
                主力 {pick.netAmount === null || pick.netAmount === undefined ? "—" : yi(pick.netAmount)}
              </Chip>
              <Button size="sm" variant="ghost" onClick={() => setPick(null)}>关闭</Button>
            </>
          )}
          bodyClass="p-0"
        >
          {memberBusy && !members ? <div className="p-4"><Skeleton className="h-40 w-full" /></div>
            : !members || members.rows.length === 0
              ? <EmptyState text="该板块没有可用成分股"
                  hint={members ? "本地成分名单与快照都没匹配上" : "成分接口异常，稍后重试"} />
              : (
                <>
                  <DataTable columns={memberCols} rows={members.rows} rowKey={(r) => r.symbol}
                    dense maxHeight="440px" sortInitial={{ key: "chg", desc: true }} />
                  <p className="px-4 py-2 text-[11px] leading-relaxed text-slate-400">
                    成分名单来源：{members.source === "local" ? "本地 stock_board（首次访问该板块时抓取并落库）"
                      : "新浪板块接口现抓"}；行情列取 {tradeDate(members.trade_date)} 收盘快照。
                    {members.board?.change_percent !== null && members.board?.change_percent !== undefined
                      ? ` 板块当日 ${members.board.change_percent.toFixed(2)}%。` : ""}
                  </p>
                </>
              )}
        </Panel>
      )}
    </div>
  );
}

function Movers({ row }: { row: BoardHeatRow }) {
  if (row.movers_note) {
    return <span className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">成分名单不可用</span>;
  }
  const up = row.movers?.up ?? [];
  const down = row.movers?.down ?? [];
  if (!up.length && !down.length) return <span className="text-[11px] text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-tight">
      {up.slice(0, 3).map((m) => (
        <span key={`u-${m.name}`} className="nums whitespace-nowrap text-rose-500">
          {m.name} {m.changePercent.toFixed(2)}%
        </span>
      ))}
      {down.slice(0, 2).map((m) => (
        <span key={`d-${m.name}`} className="nums whitespace-nowrap text-emerald-500">
          {m.name} {m.changePercent.toFixed(2)}%
        </span>
      ))}
    </div>
  );
}

function memberColumns(): Column<BoardMembersResult["rows"][number]>[] {
  return [
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <Link to={`/stock-analysis/${r.symbol}`} onClick={(e) => e.stopPropagation()}
          className="whitespace-normal text-[13px] font-medium text-slate-800 hover:text-sky-600 dark:text-slate-100">
          {r.name}
        </Link>
        {r.isSt ? <Chip tone="amber" className="ml-1.5">ST</Chip> : null}
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
      </div>) },
    { key: "chg", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
      render: (r) => <UpDown value={r.changePercent} /> },
    { key: "price", label: "现价", align: "right", value: (r) => r.price,
      render: (r) => <span className="nums">{price(r.price)}</span> },
    { key: "amount", label: "成交额", align: "right", value: (r) => r.amount,
      render: (r) => <span className="nums text-slate-500">{money(r.amount ?? null)}</span> },
    { key: "turn", label: "换手率", align: "right", value: (r) => r.turnoverRatio, render: (r) => (
      <span className="nums text-slate-500">{r.turnoverRatio === null ? "—"
        : `${r.turnoverRatio.toFixed(2)}%`}</span>) },
    { key: "pe", label: "PE", align: "right", value: (r) => r.pe, render: (r) => (
      <span className="nums text-slate-500">{r.pe === null || r.pe === 0 ? "—" : r.pe.toFixed(2)}</span>) },
    { key: "nmc", label: "流通市值", align: "right", value: (r) => r.nmcCap, render: (r) => (
      <span className="nums text-slate-500">{money(r.nmcCap ?? null)}</span>) },
  ];
}
