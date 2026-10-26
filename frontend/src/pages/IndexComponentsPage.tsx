import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { IndexComponentResult, IndexComponentRow } from "../lib/types";
import { num, price, tradeDate } from "../lib/format";
import { SymbolSearchBar } from "../components/symbol-search";
import { ValuationSummary } from "../components/valuation";
import {
  Button, DataTable, EmptyState, Panel, UpDown, cn, inputClass, type Column,
} from "../components/ui";

const INDEX_NOTE: Record<string, string> = {
  hs300: "沪深300：跨市场大盘基准，权重股决定指数走向，最能代表「核心资产」",
  sz50: "上证50：沪市超大盘，金融+白酒+能源占比高",
  zz500: "中证500：中盘股代表，与沪深300成分不重叠",
  kc50: "科创50：科创板龙头，半导体权重极大",
  bse50: "北证50：北交所龙头，源接口不给成分权重，只能看等权统计",
  sse180: "上证180：沪市中大盘，源接口同样不给权重",
};

export default function IndexComponentsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const index = params.get("index") || "hs300";
  const [data, setData] = useState<IndexComponentResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kw, setKw] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<IndexComponentResult>("/index/components", { index }, 90_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [index]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const stats = data?.stats;
  const filtered = useMemo(() => {
    const k = kw.trim();
    if (!k) return rows;
    return rows.filter((r) => (r.name ?? "").includes(k) || (r.code ?? "").includes(k)
      || (r.industry ?? "").includes(k));
  }, [rows, kw]);

  const indexes = data?.indexes ?? [];
  const maxIndustryCount = Math.max(1, ...(stats?.industryDist ?? []).map((d) => d.count));

  return (
    <div className="space-y-4">
      <Panel
        title="指数成分"
        subtitle={data && data.ok
          ? `${data.index?.label}（${data.index?.code}）· 成分 ${stats?.count ?? 0}/${stats?.expected ?? 0} 只`
            + ` · 数据日 ${tradeDate(data.date ?? null)}`
          : error ?? (data ? data.message ?? "没有这个指数" : "正在读取成分名单…")}
        right={(
          <>
            <SymbolSearchBar recentKey="biaoge.recent.index-stock"
              onPick={(s) => navigate(`/stock-analysis/${s}`)}
              placeholder="搜个股直达诊断…" />
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          {indexes.map((i) => (
            <button key={i.key} type="button"
              onClick={() => setParams({ index: i.key })}
              className={cn("rounded-lg border px-2.5 py-1 text-xs transition",
                index === i.key
                  ? "border-slate-800 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
              {i.label}
              <span className="nums ml-1 opacity-70">{i.expected}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{INDEX_NOTE[index]}</p>
        {data?.error && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            成分接口：{data.error}
          </p>
        )}
      </Panel>

      <ValuationSummary code={data?.valuationCode ?? null}
        label={data?.index?.label ?? "该指数"} note={data?.valuationNote ?? null} />

      {stats && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="成分统计" subtitle={stats.hasWeight ? "加权涨跌幅按权重归一，可与指数实际涨幅对照" : "该指数源未提供权重，只给等权口径"}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Cell k="上涨" v={num(stats.up, 0)} tone="text-rose-500" />
              <Cell k="下跌" v={num(stats.down, 0)} tone="text-emerald-500" />
              <Cell k="平盘" v={num(stats.flat, 0)} />
              <Cell k="等权均涨" v={stats.avgChange === null ? "—" : `${stats.avgChange.toFixed(2)}%`} />
              <Cell k="加权涨跌" v={stats.weightedChange === null ? "无权重"
                : `${stats.weightedChange.toFixed(2)}%`} tone="text-slate-800 dark:text-slate-100" />
              <Cell k="权重合计" v={stats.covered === null ? "—" : `${stats.covered.toFixed(1)}%`} />
            </div>
            <BreadthMini up={stats.up} down={stats.down} flat={stats.flat} />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              等权均涨与加权涨跌差距大，说明当天是权重股行情（加权高）还是题材小票行情（等权高）。
              名单不足「应有」数量时，多为新股未纳入或源接口分页缺失。
            </p>
          </Panel>

          <Panel title="前十大权重" subtitle={stats.hasWeight
            ? "点名称看个股诊断" : "该指数接口没有权重字段"} bodyClass="p-0">
            {stats.hasWeight ? (
              <DataTable dense maxHeight="260px" rows={stats.topWeight} rowKey={(r) => r.symbol}
                columns={weightOnlyCols} empty="没有权重数据" />
            ) : <div className="p-4"><EmptyState text="接口未返回权重"
                hint="北证50 与上证180 的成分表接口只给名单，权重列需按自由流通市值另算" /></div>}
          </Panel>

          <Panel title="行业分布" subtitle={`共 ${stats.industryDist.length} 个行业（取前 15）· 权重为行业内成分之和`}>
            <ul className="space-y-1.5">
              {stats.industryDist.map((d) => (
                <li key={d.industry} className="flex items-center gap-2">
                  <span title={d.industry}
                    className="w-24 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">{d.industry}</span>
                  <span className="relative h-3 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <span className="absolute inset-y-0 left-0 bg-sky-500/70"
                      style={{ width: `${(d.count / maxIndustryCount) * 100}%` }} />
                  </span>
                  <span className="nums w-10 shrink-0 text-right text-xs text-slate-500">{d.count} 只</span>
                  <span className={cn("nums w-16 shrink-0 text-right text-xs",
                    (d.avgChange ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500")}>
                    {d.avgChange === null ? "—" : `${d.avgChange.toFixed(2)}%`}
                  </span>
                  <span className="nums w-14 shrink-0 text-right text-[11px] text-slate-400">
                    {d.weight ? `${d.weight.toFixed(1)}%` : "—"}
                  </span>
                </li>
              ))}
              {!stats.industryDist.length && <li className="text-xs text-slate-400">没有行业分布数据</li>}
            </ul>
          </Panel>
        </div>
      )}

      {stats && stats.gainers.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="成分内领涨 Top 10" bodyClass="p-0">
            <DataTable dense maxHeight="260px" rows={stats.gainers} rowKey={(r) => r.symbol}
              columns={moverCols} empty="—" />
          </Panel>
          <Panel title="成分内领跌 Top 10" bodyClass="p-0">
            <DataTable dense maxHeight="260px" rows={stats.losers} rowKey={(r) => r.symbol}
              columns={moverCols} empty="—" />
          </Panel>
        </div>
      )}

      <Panel title="全部成分"
        subtitle={`${filtered.length} 行${kw ? `（关键词「${kw}」）` : ""} · 可按列排序`}
        right={<input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="筛名称/代码/行业"
          className={cn(inputClass, "h-8 w-36! shrink-0 !py-1 text-xs")} />}
        bodyClass="p-0">
        <DataTable dense maxHeight="520px" loading={busy && !data}
          rows={filtered} rowKey={(r) => r.symbol} columns={compCols}
          empty={kw ? `没有匹配「${kw}」的成分股` : "没有成分数据"}
          sortInitial={{ key: "w", desc: true }} />
      </Panel>
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60">
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{k}</p>
      <p className={cn("nums text-sm font-semibold text-slate-800 dark:text-slate-100", tone)}>{v}</p>
    </div>
  );
}

function BreadthMini({ up, down, flat }: { up: number; down: number; flat: number }) {
  const total = Math.max(up + down + flat, 1);
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="bg-rose-500" style={{ width: `${(up / total) * 100}%` }} title={`上涨 ${up}`} />
      <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${(flat / total) * 100}%` }} title={`平盘 ${flat}`} />
      <div className="bg-emerald-500" style={{ width: `${(down / total) * 100}%` }} title={`下跌 ${down}`} />
    </div>
  );
}

function Name({ r }: { r: IndexComponentRow }) {
  return (
    <div className="min-w-0">
      <Link to={`/stock-analysis/${r.symbol}`}
        className="whitespace-normal text-[13px] font-medium text-slate-800 hover:text-sky-600 dark:text-slate-100">
        {r.name}
      </Link>
      <span className="nums ml-1.5 text-[11px] text-slate-400">{r.code}</span>
    </div>
  );
}

const weightOnlyCols: Column<IndexComponentRow>[] = [
  { key: "n", label: "成分股", render: (r) => <Name r={r} /> },
  { key: "w", label: "权重", align: "right", value: (r) => r.weight, render: (r) => (
    <span className="nums font-semibold text-slate-800 dark:text-slate-100">
      {r.weight === null ? "—" : `${r.weight.toFixed(2)}%`}
    </span>) },
  { key: "p", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
    render: (r) => <UpDown value={r.changePercent} /> },
  { key: "i", label: "行业", render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.industry ?? "—"}</span>) },
];

const moverCols: Column<IndexComponentRow>[] = [
  { key: "n", label: "成分股", render: (r) => <Name r={r} /> },
  { key: "p", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
    render: (r) => <UpDown value={r.changePercent} /> },
  { key: "pr", label: "现价", align: "right", value: (r) => r.price,
    render: (r) => <span className="nums">{price(r.price)}</span> },
  { key: "w", label: "权重", align: "right", value: (r) => r.weight, render: (r) => (
    <span className="nums text-slate-500">{r.weight === null ? "—" : `${r.weight.toFixed(2)}%`}</span>) },
  { key: "i", label: "行业", render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.industry ?? "—"}</span>) },
];

const compCols: Column<IndexComponentRow>[] = [
  { key: "n", label: "成分股", render: (r) => <Name r={r} /> },
  { key: "w", label: "权重", align: "right", value: (r) => r.weight, render: (r) => (
    <span className="nums font-medium">{r.weight === null ? "—" : `${r.weight.toFixed(2)}%`}</span>) },
  { key: "p", label: "涨跌幅", align: "right", value: (r) => r.changePercent,
    render: (r) => <UpDown value={r.changePercent} /> },
  { key: "pr", label: "现价", align: "right", value: (r) => r.price,
    render: (r) => <span className="nums">{price(r.price)}</span> },
  { key: "i", label: "行业", value: (r) => r.industry, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{r.industry ?? "—"}</span>) },
  { key: "r", label: "地区", render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-400">{r.region ?? "—"}</span>) },
  { key: "eps", label: "EPS", align: "right", value: (r) => r.eps,
    render: (r) => <span className="nums text-slate-500">{price(r.eps)}</span> },
  { key: "roe", label: "ROE", align: "right", value: (r) => r.roe, render: (r) => (
    <span className="nums text-slate-500">{r.roe === null ? "—" : `${r.roe.toFixed(2)}%`}</span>) },
  { key: "pe", label: "PE", align: "right", value: (r) => r.pe, render: (r) => (
    <span className="nums text-slate-500">{r.pe === null || r.pe === 0 ? "—" : r.pe.toFixed(2)}</span>) },
  { key: "bps", label: "每股净资产", align: "right", value: (r) => r.bps,
    render: (r) => <span className="nums text-slate-500">{price(r.bps)}</span> },
  { key: "fc", label: "自由流通市值", align: "right", value: (r) => r.freeCap, render: (r) => (
    <span className="nums text-slate-500">{r.freeCap === null ? "—" : `${r.freeCap.toFixed(0)}亿`}</span>) },
  { key: "t", label: "数据日", render: (r) => (
    <span className="nums whitespace-nowrap text-[11px] text-slate-400">{r.date ?? "—"}</span>) },
];
