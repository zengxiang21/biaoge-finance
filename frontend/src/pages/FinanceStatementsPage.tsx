import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { FinancialRow, StatementsResult } from "../lib/types";
import { num, price } from "../lib/format";
import { SymbolSearchBar } from "../components/symbol-search";
import { SourceErrors } from "../components/global-quote";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, type Column,
} from "../components/ui";

/** 需要展示口径的单位说明（后端 units 字典里这几项最容易看错） */
const UNIT_KEYS = [
  "revenue", "netProfit", "deductProfit", "roe", "roic", "grossMargin", "netMargin",
  "debtRatio", "currentRatio", "assetTurn", "inventoryTurn", "receivableTurn", "cashPerShare",
] as const;

export default function FinanceStatementsPage() {
  const [symbol, setSymbol] = useState("sh600519");
  const [name, setName] = useState("贵州茅台");
  const [data, setData] = useState<StatementsResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<StatementsResult>("/finance/statements", { symbol }, 90_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [symbol]);

  useEffect(() => { void load(); }, [load]);

  const latest = data?.rows?.[0];
  const perfLatest = data?.performance?.[0];

  return (
    <div className="space-y-4">
      <Panel
        title="财务报表 · 主要财务指标"
        subtitle={data
          ? `${data.name} ${data.symbol}（东财口径 ${data.secucode}）· 共 ${data.rows.length} 个报告期`
            + `，最新 ${latest?.reportName ?? "—"} · 更新于 ${data.generatedAt}`
          : error ?? "正在读取东财 F10 主要财务指标…"}
        right={(
          <>
            <SymbolSearchBar recentKey="biaoge.recent.statements" preset={symbol}
              current={data ? { symbol: data.symbol, name: data.name } : { symbol, name }}
              onPick={(s, n) => { setSymbol(s); setName(n); }} />
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : !latest
          ? <EmptyState text="这只股票没有财务摘要" hint="新股、退市或 F10 接口未返回，换一只试试" />
          : (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <Stat label={`营收 · ${latest.reportName ?? "最新期"}`} value={`${num(latest.revenue)} 亿`}
                sub={<UpDown value={latest.revenueYoy} />} />
              <Stat label="归母净利" value={`${num(latest.netProfit)} 亿`}
                sub={<UpDown value={latest.profitYoy} />} />
              <Stat label="扣非净利" value={`${num(latest.deductProfit)} 亿`}
                sub={<UpDown value={latest.deductYoy} />} />
              <Stat label="EPS" value={price(latest.eps)} sub={<span className="text-[11px] text-slate-400">元/股</span>} />
              <Stat label="ROE" value={latest.roe === null ? "—" : `${latest.roe.toFixed(2)}%`}
                sub={<span className="text-[11px] text-slate-400">扣非 {fmtPct(latest.roeDeduct)}</span>} />
              <Stat label="毛利率 / 净利率" value={`${fmtPct(latest.grossMargin)} / ${fmtPct(latest.netMargin)}`}
                sub={<span className="text-[11px] text-slate-400">负债率 {fmtPct(latest.debtRatio)}</span>} />
              <Stat label="每股净资产 / 每股现金流"
                value={`${price(latest.bps)} / ${price(latest.cashPerShare)}`}
                sub={<span className="text-[11px] text-slate-400">流动比率 {price(latest.currentRatio)}</span>} />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">周转效率（天，越小越快）</p>
                <p className="nums mt-0.5 text-sm text-slate-800 dark:text-slate-100">
                  总资产 {num(latest.assetTurn, 1)}
                  <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                  存货 {num(latest.inventoryTurn, 1)}
                  <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                  应收 {num(latest.receivableTurn, 1)}
                </p>
              </div>
              <Link to={`/stock-analysis/${symbol}`}
                className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                打开个股诊断 {name}
              </Link>
            </div>
          )}
        <SourceErrors errors={data?.errors ?? {}} />
        {data?.note && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{data.note}</p>}
      </Panel>

      <Panel title="主要财务指标明细"
        subtitle="按报告期倒序 · 营收与净利润为「累计口径」（一季报只含 1-3 月，中报含 1-6 月）"
        bodyClass="p-0">
        <DataTable dense maxHeight="460px" loading={busy && !data}
          rows={data?.rows ?? []} rowKey={(r) => `${r.reportDate}-${r.reportType ?? ""}`}
          columns={mainCols} empty="F10 财务摘要没有返回数据" />
      </Panel>

      <Panel title="业绩报表（含环比与分红方案）"
        subtitle={data ? `${data.performance.length} 期 · 这一张表是东财「业绩报表」口径，金额单位为元，环比与累计同比同时给出` : ""}
        bodyClass="p-0">
        <DataTable dense maxHeight="400px" loading={busy && !data}
          rows={data?.performance ?? []} rowKey={(r) => `${r.reportDate}-${r.quarter ?? ""}`}
          columns={perfCols} empty="没有业绩报表数据"
          sortInitial={{ key: "d", desc: true }} />
      </Panel>

      <Panel title="字段口径速查" subtitle="同一份 F10 里既有「率」也有「天数」，看错列会把好公司读成差公司">
        <div className="flex flex-wrap gap-1.5">
          {UNIT_KEYS.filter((k) => data?.units?.[k]).map((k) => (
            <Chip key={k} tone="sky">{k} = {data!.units[k]}</Chip>
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <li>· 总资产/存货/应收周转给的是<strong className="text-slate-700 dark:text-slate-200">周转天数</strong>，不是次数；
            茅台存货周转上千天是白酒工艺使然，不能横向和制造业比。</li>
          <li>· 累计口径下「同比」对的是去年同期累计数；要判断景气度得配合上一季度的
            <strong className="text-slate-700 dark:text-slate-200">环比</strong>（业绩报表里的 QoQ）。</li>
          <li>· ROE 与扣非 ROE 差额大，说明利润里有一次性收益（政府补助、公允价值变动等）。</li>
          {perfLatest && (
            <li>· 本次最新业绩报表：{perfLatest.reportName} · {perfLatest.industry ?? "行业未标注"}
              ，营收 {num((perfLatest.revenue ?? 0) / 1e8)} 亿、净利 {num((perfLatest.netProfit ?? 0) / 1e8)} 亿。
              分红方案：{perfLatest.dividend ?? "暂无披露"}。</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)}%`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="nums mt-0.5 text-lg font-semibold text-slate-800 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px]">{sub}</p>}
    </div>
  );
}

const mainCols: Column<FinancialRow>[] = [
  { key: "d", label: "报告期", value: (r) => r.reportDate, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-100">
        {r.reportName ?? r.reportDate}
      </span>
      <span className="nums ml-1 text-[11px] text-slate-400">{r.noticeDate ? `披露 ${r.noticeDate}` : ""}</span>
    </div>) },
  { key: "rev", label: "营收(亿)", align: "right", value: (r) => r.revenue,
    render: (r) => <span className="nums">{num(r.revenue)}</span> },
  { key: "revy", label: "营收同比", align: "right", value: (r) => r.revenueYoy,
    render: (r) => <UpDown value={r.revenueYoy} /> },
  { key: "np", label: "归母净利(亿)", align: "right", value: (r) => r.netProfit,
    render: (r) => <span className="nums">{num(r.netProfit)}</span> },
  { key: "npy", label: "净利同比", align: "right", value: (r) => r.profitYoy,
    render: (r) => <UpDown value={r.profitYoy} /> },
  { key: "dp", label: "扣非净利(亿)", align: "right", value: (r) => r.deductProfit ?? null,
    render: (r) => <span className="nums text-slate-500">{num(r.deductProfit)}</span> },
  { key: "eps", label: "EPS(元)", align: "right", value: (r) => r.eps,
    render: (r) => <span className="nums">{price(r.eps)}</span> },
  { key: "roe", label: "ROE", align: "right", value: (r) => r.roe,
    render: (r) => <span className="nums">{fmtPct(r.roe)}</span> },
  { key: "roic", label: "ROIC", align: "right", value: (r) => r.roic ?? null,
    render: (r) => <span className="nums text-slate-500">{fmtPct(r.roic)}</span> },
  { key: "gm", label: "毛利率", align: "right", value: (r) => r.grossMargin,
    render: (r) => <span className="nums">{fmtPct(r.grossMargin)}</span> },
  { key: "nm", label: "净利率", align: "right", value: (r) => r.netMargin ?? null,
    render: (r) => <span className="nums text-slate-500">{fmtPct(r.netMargin)}</span> },
  { key: "dr", label: "资产负债率", align: "right", value: (r) => r.debtRatio,
    render: (r) => <span className="nums">{fmtPct(r.debtRatio)}</span> },
  { key: "bps", label: "每股净资产", align: "right", value: (r) => r.bps,
    render: (r) => <span className="nums text-slate-500">{price(r.bps)}</span> },
  { key: "cf", label: "每股经营现金流", align: "right", value: (r) => r.cashPerShare,
    render: (r) => <span className="nums text-slate-500">{price(r.cashPerShare)}</span> },
  { key: "at", label: "总资产周转(天)", align: "right", value: (r) => r.assetTurn ?? null,
    render: (r) => <span className="nums text-slate-500">{num(r.assetTurn, 1)}</span> },
  { key: "it", label: "存货周转(天)", align: "right", value: (r) => r.inventoryTurn ?? null,
    render: (r) => <span className="nums text-slate-500">{num(r.inventoryTurn, 1)}</span> },
  { key: "rt", label: "应收周转(天)", align: "right", value: (r) => r.receivableTurn ?? null,
    render: (r) => <span className="nums text-slate-500">{num(r.receivableTurn, 1)}</span> },
];

const perfCols: Column<FinancialRow>[] = [
  { key: "d", label: "报告期", value: (r) => r.reportDate, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-nowrap text-xs font-medium text-slate-800 dark:text-slate-100">
        {r.reportName ?? r.reportDate}
      </span>
      <span className="nums ml-1 text-[11px] text-slate-400">{r.quarter ?? ""}</span>
    </div>) },
  { key: "ind", label: "所属行业", value: (r) => r.industry ?? null, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.industry ?? "—"}</span>) },
  { key: "rev", label: "营收(亿)", align: "right", value: (r) => r.revenue,
    render: (r) => <span className="nums">{yiFromYuan(r.revenue)}</span> },
  { key: "revy", label: "同比", align: "right", value: (r) => r.revenueYoy,
    render: (r) => <UpDown value={r.revenueYoy} /> },
  { key: "revq", label: "环比", align: "right", value: (r) => r.revenueQoq ?? null,
    render: (r) => <UpDown value={r.revenueQoq ?? null} /> },
  { key: "np", label: "净利(亿)", align: "right", value: (r) => r.netProfit,
    render: (r) => <span className="nums">{yiFromYuan(r.netProfit)}</span> },
  { key: "npy", label: "同比", align: "right", value: (r) => r.profitYoy,
    render: (r) => <UpDown value={r.profitYoy} /> },
  { key: "npq", label: "环比", align: "right", value: (r) => r.profitQoq ?? null,
    render: (r) => <UpDown value={r.profitQoq ?? null} /> },
  { key: "eps", label: "EPS", align: "right", value: (r) => r.eps,
    render: (r) => <span className="nums">{price(r.eps)}</span> },
  { key: "roe", label: "ROE", align: "right", value: (r) => r.roe,
    render: (r) => <span className="nums">{fmtPct(r.roe)}</span> },
  { key: "gm", label: "毛利率", align: "right", value: (r) => r.grossMargin,
    render: (r) => <span className="nums text-slate-500">{fmtPct(r.grossMargin)}</span> },
  { key: "div", label: "分红送转方案", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
      {r.dividend ?? "暂无披露"}
    </span>) },
  { key: "n", label: "披露日", value: (r) => r.noticeDate ?? null, render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-400">{r.noticeDate ?? "—"}</span>) },
];

/** 业绩报表是「元」口径，这里统一换算成亿 */
function yiFromYuan(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : (v / 1e8).toFixed(2);
}
