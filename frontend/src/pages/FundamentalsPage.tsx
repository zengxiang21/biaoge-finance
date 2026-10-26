import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type {
  EventListResult, FundamentalsResult, HolderChangeRow, LockupRow, SurveyRow,
} from "../lib/types";
import { money, num, price, tradeDate, yi } from "../lib/format";
import { FundFlowChart } from "../components/charts";
import { SymbolSearchBar } from "../components/symbol-search";
import { SourceErrors } from "../components/global-quote";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";

type EventKind = "lockup" | "survey" | "holder_change";

const EVENT_TABS: { key: EventKind; label: string; hint: string }[] = [
  { key: "lockup", label: "解禁日历", hint: "按解禁市值排序，解禁规模占流通盘比例越大越要防抛压" },
  { key: "survey", label: "机构调研", hint: "一天多家机构上门调研，通常是机构在建立覆盖" },
  { key: "holder_change", label: "股东增减持", hint: "大股东/董监高的真金白银动作" },
];

export default function FundamentalsPage() {
  const [symbol, setSymbol] = useState("sh600519");
  const [name, setName] = useState("贵州茅台");
  const [data, setData] = useState<FundamentalsResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<FundamentalsResult>("/data/fundamentals", { symbol }, 90_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [symbol]);

  useEffect(() => { void load(); }, [load]);

  const q = data?.quote;

  return (
    <div className="space-y-4">
      <Panel
        title="基础数据 · 个股档案"
        subtitle={data
          ? `${data.name} ${data.symbol}（东财口径 ${data.secucode}）· 更新于 ${data.generatedAt}`
          : error ?? "正在读取 F10 主要财务指标、十大流通股东、调研与资金流…"}
        right={(
          <>
            <SymbolSearchBar recentKey="biaoge.recent.fundamentals" preset={symbol}
              current={data ? { symbol: data.symbol, name: data.name } : { symbol, name }}
              onPick={(s, n) => { setSymbol(s); setName(n); }} />
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">最新价 / 涨跌幅</p>
              <p className="nums mt-0.5 text-xl font-semibold text-slate-800 dark:text-slate-100">
                {price(q?.price ?? null)}
                <UpDown value={q?.change_percent ?? null} className="ml-2 text-sm" />
              </p>
            </div>
            <Mini label="昨收" value={price(q?.prev_close ?? null)} />
            <Mini label="今开" value={price(q?.open ?? null)} />
            <Mini label="最高 / 最低" value={`${price(q?.high ?? null)} / ${price(q?.low ?? null)}`} />
            <Mini label="成交额" value={money(q?.amount ?? null)} />
            <Mini label="时间" value={`${q?.date ?? "—"} ${q?.time?.slice(0, 8) ?? ""}`} />
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">所属板块</p>
              <div className="mt-1 flex max-w-xl flex-wrap gap-1">
                {(data?.boards ?? []).slice(0, 10).map((b) => (
                  <Chip key={`${b.kind}-${b.board_code}`} tone={b.kind === "industry" ? "sky" : "violet"}>
                    {b.board_name ?? b.board_code}
                  </Chip>
                ))}
                {!data?.boards?.length && <span className="text-xs text-slate-400">本地板块成分未覆盖该股</span>}
              </div>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="主要财务指标（按报告期）"
          subtitle={data ? `${data.mainFinancials.length} 期 · 营收/净利润为累计口径，单位亿元` : ""}
          bodyClass="p-0">
          <DataTable dense maxHeight="320px" loading={busy && !data}
            rows={data?.mainFinancials ?? []} rowKey={(r) => `${r.reportDate}`}
            columns={finCols} empty="F10 财务摘要没有返回数据" />
        </Panel>

        <Panel title="业绩报表（东财披露口径）"
          subtitle={data ? `${data.performance.length} 期 · 含环比与分红方案` : ""}
          bodyClass="p-0">
          <DataTable dense maxHeight="320px" loading={busy && !data}
            rows={data?.performance ?? []} rowKey={(r) => `${r.reportDate}-${r.quarter ?? ""}`}
            columns={perfCols} empty="没有业绩报表数据" />
        </Panel>

        <Panel title="十大流通股东"
          subtitle={data ? `${data.topHolders.length} 位 · 最新报告期 ${data.topHolders[0]?.endDate ?? "—"}` : ""}
          bodyClass="p-0">
          <DataTable dense maxHeight="320px" loading={busy && !data}
            rows={data?.topHolders ?? []} rowKey={(r) => `${r.endDate}-${r.name}`}
            columns={holderCols} empty="没有十大流通股东数据" />
        </Panel>

        <Panel title="个股主力资金（近 20 日）"
          subtitle={data ? `${data.fundFlow.length} 个交易日 · 主力净额=特大单+大单` : ""}>
          {busy && !data ? <Skeleton className="h-32 w-full" />
            : !data?.fundFlow?.length
              ? <EmptyState text="没有个股资金流历史" hint="新浪 money-flow 接口偶发拒绝，稍后刷新" />
              : (
                <>
                  <FundFlowChart rows={data.fundFlow.map((r) => ({
                    date: r.date, mainNet: r.mainNet ?? 0, netAmount: r.netAmount ?? 0,
                  }))} height={120} />
                  <div className="mt-2 max-h-44 overflow-y-auto">
                    <DataTable dense rows={data.fundFlow} rowKey={(r) => r.date} columns={flowCols} />
                  </div>
                </>
              )}
        </Panel>
      </div>

      <Panel title="个股调研记录"
        subtitle={data ? `近一年 ${data.surveys.length} 条记录（一家机构一行，已截前 20 条）` : ""}
        bodyClass="p-0">
        <DataTable dense maxHeight="300px" loading={busy && !data}
          rows={data?.surveys ?? []} rowKey={(r) => `${r.date}-${r.org}`}
          columns={surveyCols} empty="近一年没有机构调研记录" />
      </Panel>

      <EventLists />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="nums mt-0.5 text-sm text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

const finCols: Column<FundamentalsResult["mainFinancials"][number]>[] = [
  { key: "d", label: "报告期", value: (r) => r.reportDate, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-200">{r.reportName ?? r.reportDate}</span>
      <span className="nums ml-1 text-[11px] text-slate-400">{r.noticeDate ? `披露 ${r.noticeDate}` : ""}</span>
    </div>) },
  { key: "eps", label: "EPS", align: "right", value: (r) => r.eps,
    render: (r) => <span className="nums">{price(r.eps)}</span> },
  { key: "roe", label: "ROE", align: "right", value: (r) => r.roe, render: (r) => <UpDown value={r.roe} sign={false} /> },
  { key: "rev", label: "营收(亿)", align: "right", value: (r) => r.revenue,
    render: (r) => <span className="nums">{r.revenue === null ? "—" : num(r.revenue / 1e8)}</span> },
  { key: "revy", label: "营收同比", align: "right", value: (r) => r.revenueYoy,
    render: (r) => <UpDown value={r.revenueYoy} /> },
  { key: "np", label: "净利(亿)", align: "right", value: (r) => r.netProfit,
    render: (r) => <span className="nums">{r.netProfit === null ? "—" : num(r.netProfit / 1e8)}</span> },
  { key: "npy", label: "净利同比", align: "right", value: (r) => r.profitYoy,
    render: (r) => <UpDown value={r.profitYoy} /> },
  { key: "gm", label: "毛利率", align: "right", value: (r) => r.grossMargin, render: (r) => (
    <span className="nums text-slate-500">{r.grossMargin === null ? "—" : `${r.grossMargin.toFixed(1)}%`}</span>) },
  { key: "dr", label: "负债率", align: "right", value: (r) => r.debtRatio, render: (r) => (
    <span className="nums text-slate-500">{r.debtRatio === null ? "—" : `${r.debtRatio.toFixed(1)}%`}</span>) },
];

const perfCols: Column<FundamentalsResult["performance"][number]>[] = [
  { key: "d", label: "报告期", value: (r) => r.reportDate, render: (r) => (
    <span className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-200">{r.reportName ?? r.reportDate}</span>) },
  { key: "rev", label: "营收(亿)", align: "right", value: (r) => r.revenue,
    render: (r) => <span className="nums">{r.revenue === null ? "—" : num(r.revenue / 1e8)}</span> },
  { key: "revy", label: "同比", align: "right", value: (r) => r.revenueYoy, render: (r) => <UpDown value={r.revenueYoy} /> },
  { key: "revq", label: "环比", align: "right", value: (r) => r.revenueQoq ?? null, render: (r) => <UpDown value={r.revenueQoq ?? null} /> },
  { key: "np", label: "净利(亿)", align: "right", value: (r) => r.netProfit,
    render: (r) => <span className="nums">{r.netProfit === null ? "—" : num(r.netProfit / 1e8)}</span> },
  { key: "npy", label: "同比", align: "right", value: (r) => r.profitYoy, render: (r) => <UpDown value={r.profitYoy} /> },
  { key: "div", label: "分红送转", value: (r) => r.dividend ?? null, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.dividend ?? "—"}</span>) },
];

const holderCols: Column<FundamentalsResult["topHolders"][number]>[] = [
  { key: "n", label: "股东名称", value: (r) => r.name, render: (r) => (
    <span className="whitespace-normal text-xs leading-snug text-slate-700 dark:text-slate-200">{r.name}</span>) },
  { key: "r", label: "持股比例", align: "right", value: (r) => r.ratio, render: (r) => (
    <span className="nums">{r.ratio === null ? "—" : `${r.ratio.toFixed(2)}%`}</span>) },
  { key: "s", label: "持股数(股)", align: "right", value: (r) => r.shares,
    render: (r) => <span className="nums text-slate-500">{money(r.shares ?? null)}</span> },
  { key: "c", label: "较上期", value: (r) => r.change, render: (r) => (
    <span className={cn("text-xs", r.change === "增持" ? "text-rose-500"
      : r.change === "减持" ? "text-emerald-500" : "text-slate-400")}>{r.change ?? "—"}</span>) },
];

const flowCols: Column<FundamentalsResult["fundFlow"][number]>[] = [
  { key: "d", label: "日期", value: (r) => r.date, render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-500">{r.date}</span>) },
  { key: "c", label: "收盘", align: "right", value: (r) => r.close,
    render: (r) => <span className="nums">{price(r.close)}</span> },
  { key: "p", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
    render: (r) => <UpDown value={r.changePercent} /> },
  { key: "m", label: "主力净额", align: "right", value: (r) => r.mainNet, render: (r) => (
    <span className={cn("nums", (r.mainNet ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
      {money(r.mainNet ?? null)}
    </span>) },
  { key: "s", label: "特大单", align: "right", value: (r) => r.superNet, render: (r) => (
    <span className="nums text-slate-500">{money(r.superNet ?? null)}</span>) },
  { key: "b", label: "大单", align: "right", value: (r) => r.bigNet, render: (r) => (
    <span className="nums text-slate-500">{money(r.bigNet ?? null)}</span>) },
];

const surveyCols: Column<SurveyRow>[] = [
  { key: "d", label: "调研日期", value: (r) => r.date, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.date ?? "—"}</span>) },
  { key: "o", label: "机构", value: (r) => r.org, render: (r) => (
    <span className="whitespace-normal text-xs text-slate-700 dark:text-slate-200">{r.org ?? "—"}</span>) },
  { key: "w", label: "方式", value: (r) => r.way, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.way ?? "—"}</span>) },
  { key: "p", label: "地点", value: (r) => r.place, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.place ?? "—"}</span>) },
  { key: "c", label: "接待人员/内容", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
      {[r.receptionist, r.content].filter(Boolean).join(" · ") || "—"}
    </span>) },
];

/** 解禁 / 调研 / 增减持三个列表，共用 /data/fundamentals/events */
function EventLists() {
  const [kind, setKind] = useState<EventKind>("lockup");
  const [days, setDays] = useState(60);
  const [kw, setKw] = useState("");
  const [data, setData] = useState<EventListResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<EventListResult>("/data/fundamentals/events",
        { kind, days, keyword: kw, limit: 120 }, 90_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [kind, days, kw]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const tab = EVENT_TABS.find((t) => t.key === kind)!;

  return (
    <Panel
      title="市场级基础数据"
      subtitle={error ?? (data
        ? `${tab.label}：近 ${data.days} 天命中 ${data.total} 条，展示 ${data.shown} 条 · ${tab.hint}`
        : "正在读取解禁/调研/增减持列表…")}
      right={(
        <>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
            {EVENT_TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setKind(t.key)}
                className={cn("px-2.5 py-1 text-xs transition",
                  kind === t.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                {t.label}
              </button>
            ))}
          </div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className={cn(inputClass, "h-8 w-24! shrink-0 !py-1 text-xs")}>
            {[30, 60, 90, 180].map((d) => <option key={d} value={d}>近 {d} 天</option>)}
          </select>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="筛关键词"
            className={cn(inputClass, "h-8 w-24! shrink-0 !py-1 text-xs")} />
        </>
      )}
      bodyClass="p-0"
    >
      {busy && !data ? <div className="p-4"><Skeleton className="h-40 w-full" /></div>
        : data?.error
          ? <EmptyState text="上游返回异常" hint={data.error} />
          : rows.length === 0
            ? <EmptyState text={kw ? `没有匹配「${kw}」的记录` : "这个窗口里没有记录"} hint="放宽时间窗口或换关键词" />
            : (
              <>
                <DataTable dense maxHeight="420px" rows={rows} rowKey={rowKeyOf(kind)}
                  columns={kind === "lockup" ? lockupCols : kind === "survey" ? eventSurveyCols : holderChangeCols}
                  sortInitial={{ key: kind === "holder_change" ? "td" : "d", desc: true }} />
                <p className="px-4 py-2 text-[11px] text-slate-400">
                  {kind === "lockup" && `合计解禁市值 ${yi(data?.sumMarketCapYi ?? null)}`}
                  {kind === "survey" && `按「公司 + 日期」聚合，机构数为去重后的名单长度`}
                  {kind === "holder_change" && `其中增持方向 ${data?.increaseCount ?? 0} 条`}
                  {" · 交易日 "}{tradeDate(data?.generatedAt ?? null)}
                </p>
              </>
            )}
    </Panel>
  );
}

function rowKeyOf(kind: EventKind): (r: EventListResult["rows"][number]) => string {
  if (kind === "lockup") return (r) => `${r.date}-${r.symbol}-${r.type ?? ""}`;
  if (kind === "survey") return (r) => `${r.date}-${r.symbol}`;
  return (r) => `${r.tradeDate}-${r.symbol}-${r.holder ?? r.name}`;
}

const lockupCols: Column<LockupRow>[] = [
  { key: "d", label: "解禁日", value: (r) => r.date, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.date ?? "—"}</span>) },
  { key: "n", label: "名称/代码", value: (r) => r.name, render: (r) => (
    <div className="min-w-0">
      <Link to={`/stock-analysis/sh${r.symbol ?? ""}`}
        className="whitespace-normal text-[13px] font-medium text-slate-800 hover:text-sky-600 dark:text-slate-100">
        {r.name}
      </Link>
      <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
    </div>) },
  { key: "cap", label: "解禁市值", align: "right", value: (r) => r.marketCapYi, render: (r) => (
    <span className="nums font-semibold text-slate-800 dark:text-slate-100">{yi(r.marketCapYi)}</span>) },
  { key: "sh", label: "解禁股数", align: "right", value: (r) => r.sharesYi, render: (r) => (
    <span className="nums text-slate-500">{r.sharesYi === null ? "—" : `${r.sharesYi.toFixed(2)}亿股`}</span>) },
  { key: "ratio", label: "占总股本", align: "right", value: (r) => r.ratio, render: (r) => (
    <span className="nums text-slate-500">{r.ratio === null ? "—" : `${r.ratio.toFixed(2)}%`}</span>) },
  { key: "h", label: "股东户数", align: "right", value: (r) => r.holders, render: (r) => (
    <span className="nums text-slate-500">{r.holders === null ? "—" : num(r.holders, 0)}</span>) },
  { key: "t", label: "类型", value: (r) => r.type ?? null, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.type ?? "—"}</span>) },
];

const eventSurveyCols: Column<SurveyRow>[] = [
  { key: "d", label: "调研日", value: (r) => r.date, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.date ?? "—"}</span>) },
  { key: "n", label: "公司", value: (r) => r.name, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-normal text-[13px] text-slate-800 dark:text-slate-100">{r.name}</span>
      <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
    </div>) },
  { key: "c", label: "机构数", align: "right", value: (r) => r.orgCount ?? null, render: (r) => (
    <span className="nums font-semibold text-slate-800 dark:text-slate-100">{r.orgCount ?? "—"}</span>) },
  { key: "w", label: "方式", value: (r) => r.way, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.way ?? "—"}</span>) },
  { key: "s", label: "参与机构（前 6 家）", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
      {r.orgSample ?? r.org ?? "—"}
    </span>) },
  { key: "x", label: "原文", render: (r) => (r.url
    ? <a href={r.url} target="_blank" rel="noreferrer" className="text-[11px] text-sky-600 hover:underline">公告</a>
    : <span className="text-[11px] text-slate-400">—</span>) },
];

const holderChangeCols: Column<HolderChangeRow>[] = [
  { key: "td", label: "变动日", value: (r) => r.tradeDate, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.tradeDate || r.date || "—"}</span>) },
  { key: "n", label: "名称/代码", value: (r) => r.name, render: (r) => (
    <div className="min-w-0">
      <span className="whitespace-normal text-[13px] text-slate-800 dark:text-slate-100">{r.name}</span>
      <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
    </div>) },
  { key: "dir", label: "方向", value: (r) => r.direction, render: (r) => (
    <Chip tone={r.direction === "增持" ? "rose" : r.direction === "减持" ? "emerald" : "slate"}>
      {r.direction ?? "—"}
    </Chip>) },
  { key: "r", label: "变动比例", align: "right", value: (r) => r.holdRatio, render: (r) => (
    <span className="nums text-slate-500">{r.holdRatio === null ? "—" : `${r.holdRatio.toFixed(2)}%`}</span>) },
  { key: "a", label: "均价", align: "right", value: (r) => r.avgPrice, render: (r) => (
    <span className="nums text-slate-500">{price(r.avgPrice)}</span>) },
  { key: "c", label: "收盘价", align: "right", value: (r) => r.close, render: (r) => (
    <span className="nums text-slate-500">{price(r.close)}</span>) },
  { key: "m", label: "变动市值", align: "right", value: (r) => r.market, render: (r) => (
    <span className="nums text-slate-500">{money(r.market ?? null)}</span>) },
  { key: "h", label: "股东", render: (r) => (
    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500">{r.holder ?? "—"}</span>) },
];
