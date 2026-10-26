import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { FinancialRow, IndicatorRow, IndicatorsResult } from "../lib/types";
import { money, num, price } from "../lib/format";
import { KlineChart } from "../components/charts";
import { SymbolSearchBar } from "../components/symbol-search";
import { SourceErrors } from "../components/global-quote";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";

const DAY_CHOICES = [120, 250, 500] as const;

export default function FinanceIndicatorsPage() {
  const [symbol, setSymbol] = useState("sh600519");
  const [name, setName] = useState("贵州茅台");
  const [days, setDays] = useState<number>(250);
  const [showBoll, setShowBoll] = useState(false);
  const [data, setData] = useState<IndicatorsResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<IndicatorsResult>("/finance/indicators", { symbol, days }, 90_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [symbol, days]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const latest = data?.latest;
  const boll = data?.boll;

  // 后端按倒序返回（rows[0] 是最新），K 线要正序画
  const bars = [...rows].reverse().map((r) => ({
    day: r.date ?? "", open: r.open ?? 0, close: r.close ?? 0,
    high: r.high ?? 0, low: r.low ?? 0, volume: r.volume ?? 0,
  }));

  const readings = latest && rows.length >= 2 ? buildReadings(latest, rows, boll) : [];
  const shown = Math.min(bars.length, 160);

  return (
    <div className="space-y-4">
      <Panel
        title="财务指标 · 技术面与财务面同屏"
        subtitle={data
          ? `${data.name} ${data.symbol} · 本地取 ${data.count} 个交易日日线，表格展示最近 ${rows.length} 条`
            + `，指标由本地日线实时计算 · 更新于 ${data.generatedAt}`
          : error ?? "正在拉日线并计算 MA/MACD/KDJ/RSI/BOLL/ATR…"}
        right={(
          <>
            <SymbolSearchBar recentKey="biaoge.recent.indicators" preset={symbol}
              current={data ? { symbol: data.symbol, name: data.name } : { symbol, name }}
              onPick={(s, n) => { setSymbol(s); setName(n); }} />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className={cn(inputClass, "h-8 w-24! shrink-0 !py-1 text-xs")}>
              {DAY_CHOICES.map((d) => <option key={d} value={d}>近 {d} 日</option>)}
            </select>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : !latest ? (
          <EmptyState text="没有可用的日线数据" hint="新股、长期停牌或 K 线源失败；错误明细见下方提示" />
        ) : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">最新收盘（{rows[0]?.date ?? "—"}）</p>
              <p className="nums mt-0.5 text-xl font-semibold text-slate-800 dark:text-slate-100">
                {price(latest.close)}
                <UpDown value={latest.changePercent} className="ml-2 text-sm" />
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">均线</p>
              <p className="nums mt-0.5 text-sm text-slate-800 dark:text-slate-100">
                MA5 {price(latest.ma5)} <span className="text-slate-300 dark:text-slate-600">·</span>
                MA10 {price(latest.ma10)} <span className="text-slate-300 dark:text-slate-600">·</span>
                MA20 {price(latest.ma20)} <span className="text-slate-300 dark:text-slate-600">·</span>
                MA60 {price(latest.ma60)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">MACD / RSI / ATR</p>
              <p className="nums mt-0.5 text-sm text-slate-800 dark:text-slate-100">
                DIF {num(latest.macd, 3)} <span className="text-slate-300 dark:text-slate-600">·</span>
                柱 {num(latest.hist, 3)} <span className="text-slate-300 dark:text-slate-600">·</span>
                RSI {num(latest.rsi, 1)} <span className="text-slate-300 dark:text-slate-600">·</span>
                ATR {data.atr === null ? "—" : `${data.atr.toFixed(2)}%`}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">布林带（20,2）</p>
              <p className="nums mt-0.5 text-sm text-slate-800 dark:text-slate-100">
                上 {price(boll?.upper ?? null)} <span className="text-slate-300 dark:text-slate-600">·</span>
                中 {price(boll?.mid ?? null)} <span className="text-slate-300 dark:text-slate-600">·</span>
                下 {price(boll?.lower ?? null)} <span className="text-slate-300 dark:text-slate-600">·</span>
                宽 {num(boll?.width ?? null, 1)}%
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">区间涨跌幅</p>
              <p className="nums mt-0.5 flex gap-2 text-sm">
                <UpDown value={data.momentum.r5} /><UpDown value={data.momentum.r20} />
                <UpDown value={data.momentum.r60} />
              </p>
              <p className="text-[10px] text-slate-400">5 / 20 / 60 交易日</p>
            </div>
            <Link to={`/stock-analysis/${symbol}`}
              className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-300/60 dark:text-slate-200 dark:hover:bg-slate-800">
              打开个股诊断 {name}
            </Link>
          </div>
        )}
        <SourceErrors errors={data?.errors ?? {}} />
        {readings.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {readings.map((r) => (
              <Chip key={r.label} tone={r.tone}>{r.label}：{r.text}</Chip>
            ))}
          </div>
        )}
        {data?.note && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{data.note}</p>}
      </Panel>

      <Panel title="日 K 与均线"
        subtitle={`共 ${bars.length} 根${shown < bars.length ? `，显示最近 ${shown} 根` : "，全部画出"} · 悬停看单根数据`}
        right={(
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={showBoll} onChange={(e) => setShowBoll(e.target.checked)}
              className="h-3.5 w-3.5 accent-rose-500" />
            叠加布林带
          </label>
        )}>
        {busy && !data ? <Skeleton className="h-64 w-full" />
          : bars.length < 2 ? <EmptyState text="日线不足两根" hint="只有新股或长期停牌的股票会这样" />
            : (
              <KlineChart bars={bars} height={340} count={shown}
                ma={[5, 10, 20, 60]} boll={showBoll} withVolume />
            )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="指标明细表" subtitle="倒序 · 点表头可按该列排序" bodyClass="p-0">
          <DataTable dense maxHeight="460px" loading={busy && !data}
            rows={rows} rowKey={(r) => r.date ?? ""} columns={indCols}
            empty="没有日线指标数据" sortInitial={{ key: "d", desc: true }} />
        </Panel>

        <Panel title="财务面（同一次请求带上，省一次接口）"
          subtitle={`${data?.financial.length ?? 0} 个报告期 · 东财 F10，金额未换算`} bodyClass="p-0">
          <DataTable dense maxHeight="460px" loading={busy && !data}
            rows={data?.financial ?? []} rowKey={(r) => r.reportDate ?? ""} columns={finCols}
            empty="这只股票没有 F10 财务摘要" />
          <p className="px-4 py-2 text-[11px] leading-relaxed text-slate-400">
            要看完整口径（含扣非、周转天数、分红方案），去
            <Link to="/finance/statements" className="mx-1 text-sky-600 hover:underline">财务报表</Link>
            页；技术面选股条件请在
            <Link to="/strategy" className="mx-1 text-sky-600 hover:underline">策略引擎</Link>
            里配置。
          </p>
        </Panel>
      </div>
    </div>
  );
}

type Reading = { label: string; text: string; tone: "rose" | "emerald" | "sky" | "slate" | "amber" };

function buildReadings(
  latest: IndicatorsResult["latest"],
  rows: IndicatorRow[],
  boll: IndicatorsResult["boll"] | undefined,
): Reading[] {
  const out: Reading[] = [];
  const prev = rows[1];
  const c = latest.close;

  const mas = [latest.ma5, latest.ma10, latest.ma20, latest.ma60];
  if (c !== null && mas.every((m) => m !== null)) {
    const bull = mas.every((m, i) => i === 0 || (mas[i - 1] as number) >= (m as number)) && c >= latest.ma5!;
    const bear = mas.every((m, i) => i === 0 || (mas[i - 1] as number) <= (m as number)) && c <= latest.ma5!;
    out.push({
      label: "均线排列", tone: bull ? "rose" : bear ? "emerald" : "slate",
      text: bull ? "多头（价>MA5>MA10>MA20>MA60）" : bear ? "空头（价<MA5<MA10<MA20<MA60）" : "缠绕，方向未定",
    });
  }

  if (latest.hist !== null && prev?.hist !== null && prev?.hist !== undefined) {
    const cross = latest.hist > 0 && prev.hist <= 0 ? "刚上穿（红柱首日）"
      : latest.hist < 0 && prev.hist >= 0 ? "刚下穿（绿柱首日）" : null;
    out.push({
      label: "MACD", tone: latest.hist > 0 ? "rose" : "emerald",
      text: `${latest.hist > 0 ? "红柱" : "绿柱"} ${Math.abs(latest.hist).toFixed(3)}`
        + `，DIF ${latest.macd! >= prev.macd! ? "抬头" : "回落"}`,
    });
    if (cross) out.push({ label: "MACD 交叉", tone: latest.hist > 0 ? "rose" : "emerald", text: cross });
  }

  const k = latest.kdjK, d = latest.kdjD, kp = latest.kdjKPrev, dp = latest.kdjDPrev;
  if (k !== null && d !== null && kp !== null && dp !== null) {
    const golden = k > d && kp <= dp;
    const dead = k < d && kp >= dp;
    out.push({
      label: "KDJ", tone: golden ? "rose" : dead ? "emerald" : k > 80 || k < 20 ? "amber" : "slate",
      text: golden ? "K 上穿 D，金叉"
        : dead ? "K 下穿 D，死叉"
          : `K ${k.toFixed(1)} / D ${d.toFixed(1)}${k > 80 ? "，超买区" : k < 20 ? "，超卖区" : "，中性区"}`,
    });
  }

  if (latest.rsi !== null) {
    out.push({
      label: "RSI(14)", tone: latest.rsi >= 70 ? "amber" : latest.rsi <= 30 ? "sky" : "slate",
      text: latest.rsi >= 70 ? `${latest.rsi.toFixed(1)}，偏热`
        : latest.rsi <= 30 ? `${latest.rsi.toFixed(1)}，偏冷` : `${latest.rsi.toFixed(1)}，中性`,
    });
  }

  if (boll && c !== null && boll.upper !== null && boll.lower !== null && boll.upper > boll.lower) {
    const pos = (c - boll.lower) / (boll.upper - boll.lower);
    out.push({
      label: "布林位置", tone: pos >= 0.95 ? "rose" : pos <= 0.05 ? "emerald" : "slate",
      text: `${(pos * 100).toFixed(0)}%（0=下轨，100=上轨）· 带宽 ${boll.width?.toFixed(1)}%`,
    });
  }

  if (rows.length >= 60) out.push({ label: "计算样本", tone: "slate", text: `${rows.length} 个交易日` });
  return out;
}

const indCols: Column<IndicatorRow>[] = [
  { key: "d", label: "日期", value: (r) => r.date, render: (r) => (
    <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.date ?? "—"}</span>) },
  { key: "c", label: "收盘", align: "right", value: (r) => r.close,
    render: (r) => <span className="nums font-medium">{price(r.close)}</span> },
  { key: "p", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
    render: (r) => <UpDown value={r.changePercent} /> },
  { key: "ma5", label: "MA5", align: "right", value: (r) => r.ma5,
    render: (r) => <span className="nums text-slate-500">{price(r.ma5)}</span> },
  { key: "ma10", label: "MA10", align: "right", value: (r) => r.ma10,
    render: (r) => <span className="nums text-slate-500">{price(r.ma10)}</span> },
  { key: "ma20", label: "MA20", align: "right", value: (r) => r.ma20,
    render: (r) => <span className="nums text-slate-500">{price(r.ma20)}</span> },
  { key: "ma60", label: "MA60", align: "right", value: (r) => r.ma60,
    render: (r) => <span className="nums text-slate-500">{price(r.ma60)}</span> },
  { key: "dif", label: "DIF", align: "right", value: (r) => r.macd,
    render: (r) => <span className="nums text-slate-500">{num(r.macd, 3)}</span> },
  { key: "dea", label: "DEA", align: "right", value: (r) => r.signal,
    render: (r) => <span className="nums text-slate-500">{num(r.signal, 3)}</span> },
  { key: "hist", label: "MACD 柱", align: "right", value: (r) => r.hist, render: (r) => (
    <span className={cn("nums", (r.hist ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
      {num(r.hist, 3)}
    </span>) },
  { key: "rsi", label: "RSI", align: "right", value: (r) => r.rsi, render: (r) => (
    <span className={cn("nums", r.rsi === null ? "text-slate-400"
      : r.rsi >= 70 ? "text-rose-500" : r.rsi <= 30 ? "text-emerald-500" : "text-slate-500")}>
      {num(r.rsi, 1)}
    </span>) },
  { key: "v", label: "成交量", align: "right", value: (r) => r.volume,
    render: (r) => <span className="nums text-slate-500">{money(r.volume ?? null, "股")}</span> },
];

const finCols: Column<FinancialRow>[] = [
  { key: "d", label: "报告期", value: (r) => r.reportDate, render: (r) => (
    <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.reportName ?? r.reportDate}</span>) },
  { key: "eps", label: "EPS", align: "right", value: (r) => r.eps,
    render: (r) => <span className="nums">{price(r.eps)}</span> },
  { key: "roe", label: "ROE", align: "right", value: (r) => r.roe,
    render: (r) => <span className="nums">{r.roe === null ? "—" : `${r.roe.toFixed(2)}%`}</span> },
  { key: "gm", label: "毛利率", align: "right", value: (r) => r.grossMargin,
    render: (r) => <span className="nums text-slate-500">{r.grossMargin === null ? "—" : `${r.grossMargin.toFixed(1)}%`}</span> },
  { key: "nm", label: "净利率", align: "right", value: (r) => r.netMargin ?? null,
    render: (r) => <span className="nums text-slate-500">{r.netMargin === null || r.netMargin === undefined ? "—" : `${r.netMargin.toFixed(1)}%`}</span> },
  { key: "dr", label: "负债率", align: "right", value: (r) => r.debtRatio,
    render: (r) => <span className="nums text-slate-500">{r.debtRatio === null ? "—" : `${r.debtRatio.toFixed(1)}%`}</span> },
  { key: "ry", label: "营收同比", align: "right", value: (r) => r.revenueYoy,
    render: (r) => <UpDown value={r.revenueYoy} /> },
  { key: "py", label: "净利同比", align: "right", value: (r) => r.profitYoy,
    render: (r) => <UpDown value={r.profitYoy} /> },
  { key: "at", label: "总资产周转(天)", align: "right", value: (r) => r.assetTurn ?? null,
    render: (r) => <span className="nums text-slate-500">{num(r.assetTurn, 1)}</span> },
];
