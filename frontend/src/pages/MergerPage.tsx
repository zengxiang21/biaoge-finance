import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { MergerEventRow, MergerResult } from "../lib/types";

import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, cn, inputClass, type Column,
} from "../components/ui";
import { toast } from "../store/toast";

const STAGES = ["", "终止", "完成", "审核", "股东会是", "方案", "筹划", "公告"];
const DAY_OPTIONS = [30, 60, 120, 365];

const STAGE_TONE: Record<string, "rose" | "amber" | "sky" | "violet" | "emerald" | "slate"> = {
  终止: "slate", 完成: "emerald", 审核: "sky", 股东会是: "violet", 方案: "amber", 筹划: "rose", 公告: "rose",
};

export default function MergerPage() {
  const [data, setData] = useState<MergerResult | null>(null);
  const [days, setDays] = useState(120);
  const [stage, setStage] = useState("");
  const [kw, setKw] = useState("");
  const [busy, setBusy] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<MergerResult>("/info/merger",
        { days, stage, keyword: kw, limit: 300 }, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, [days, stage, kw]);

  useEffect(() => { void load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.post<{ total: number; news: { matched: number }; announcements: { matched: number; scanned: number } }>(
        "/info/merger/scan", undefined, 180_000);
      toast(`扫描完成：公告 ${r.announcements.scanned} 条里命中 ${r.announcements.matched}，快讯命中 ${r.news.matched}`);
      void load();
    } catch (e) { toast(messageOf(e), "error"); }
    setScanning(false);
  };

  const cols: Column<MergerEventRow>[] = [
    { key: "date", label: "时间", value: (r) => r.date, render: (r) => (
      <span className="nums whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">{r.date ?? "—"}</span>) },
    { key: "stage", label: "阶段", value: (r) => r.stage, render: (r) => (
      <Chip tone={STAGE_TONE[r.stage ?? ""] ?? "slate"}>{r.stage ?? "未识别"}</Chip>) },
    { key: "target", label: "标的", value: (r) => r.name ?? "市场级", render: (r) => (
      r.symbol ? (
        <Link to={`/stock-analysis/${r.symbol}`} onClick={(e) => e.stopPropagation()}
          className="whitespace-normal text-[13px] font-medium text-slate-800 hover:text-sky-600 dark:text-slate-100">
          {r.name}<span className="nums ml-1 text-[11px] text-slate-400">{r.symbol}</span>
        </Link>
      ) : <span className="text-xs text-slate-400">市场级</span>) },
    { key: "title", label: "事件", value: (r) => r.title, render: (r) => (
      <div className="min-w-0">
        {r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer"
            className="line-clamp-2 text-[13px] leading-snug text-slate-700 hover:text-sky-600 dark:text-slate-200">
            {r.title}
          </a>
        ) : (
          <span className="line-clamp-2 text-[13px] leading-snug text-slate-700 dark:text-slate-200">{r.title}</span>
        )}
        {r.summary && (
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-400">{r.summary}</span>
        )}
      </div>) },
    { key: "kw", label: "命中关键词", render: (r) => (
      <div className="flex flex-wrap gap-1">
        {(r.keywords ?? []).slice(0, 3).map((k) => <Chip key={k}>{k}</Chip>)}
        {!r.keywords?.length && <span className="text-[11px] text-slate-400">—</span>}
      </div>) },
    { key: "src", label: "来源", value: (r) => r.event_type, render: (r) => (
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        {r.event_type === "merger" ? "公告" : r.event_type === "merger_news" ? "快讯" : r.event_type}
      </span>) },
  ];

  const stageEntries = Object.entries(data?.stages ?? {});

  return (
    <div className="space-y-4">
      <Panel
        title="并购重组事件追踪"
        subtitle={data
          ? `库内累计 ${data.stored} 条 · 近 ${days} 天命中 ${data.total} 条 · 更新于 ${data.generatedAt}`
          : error ?? "正在扫描公告流与本地快讯…"}
        right={(
          <>
            <Button size="sm" variant="outline" loading={scanning} onClick={() => void scan()}>立即扫描</Button>
            <Button size="sm" variant="ghost" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">时间窗口</span>
              {DAY_OPTIONS.map((d) => (
                <button key={d} type="button" onClick={() => setDays(d)}
                  className={cn("rounded-lg px-2 py-1 text-xs transition",
                    days === d ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  近 {d} 天
                </button>
              ))}
              <span className="ml-3 text-xs text-slate-500 dark:text-slate-400">阶段</span>
              {STAGES.map((s) => (
                <button key={s || "all"} type="button" onClick={() => setStage(s)}
                  className={cn("rounded-lg px-2 py-1 text-xs transition",
                    stage === s ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {s || "全部"}
                </button>
              ))}
              <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="公司名/代码/关键词"
                className={cn(inputClass, "h-8 w-44! shrink-0 !py-1 text-xs")} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="当前命中" value={String(data?.total ?? 0)} />
              <Stat label="库内累计" value={String(data?.stored ?? 0)} />
              <Stat label="涉及标的" value={String((data?.topStocks ?? []).filter((s) => s.name !== "市场级").length)} />
              <Stat label="最近扫描" value={data?.generatedAt?.slice(11, 16) ?? "—"} hint={data?.generatedAt} />
            </div>

            {!!stageEntries.length && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500 dark:text-slate-400">阶段分布</span>
                {stageEntries.sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <Chip key={k} tone={STAGE_TONE[k] ?? "slate"}>{k} {v}</Chip>
                ))}
              </div>
            )}

            {(data?.topStocks ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500 dark:text-slate-400">最活跃标的</span>
                {data!.topStocks.slice(0, 10).map((s) => (
                  <button key={s.name} type="button" disabled={!s.symbol}
                    onClick={() => s.symbol && setKw(s.name)}
                    className={cn("rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600",
                      "dark:bg-slate-800 dark:text-slate-300", s.symbol && "hover:bg-slate-200 dark:hover:bg-slate-700")}>
                    {s.name} {s.count}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          识别方式：对东财公告流与本地快讯做关键词命中（并购、重大资产重组、资产置换、发行股份购买资产、吸收合并、
          要约收购、重组报告书/预案、收购），再按标题里的「终止 / 完成 / 审核 / 股东会同意的 / 方案 / 筹划」标注阶段。
          东财没有公开的并购重组专题报表，所以这张表是本地规则扫描的结果，阶段标签可能有误读，点标题去原文核对。
        </p>
      </Panel>

      <Panel title="事件明细" subtitle={data ? `取前 ${data.rows.length} 条 · 点标题看原文` : ""} bodyClass="p-0">
        {busy && !data ? <div className="p-4"><Skeleton className="h-64 w-full" /></div>
          : (data?.rows ?? []).length === 0
            ? <EmptyState text="这个窗口里没有命中的并购重组事件"
                hint="把时间窗口放宽，或者点右上角「立即扫描」补一批公告流" />
            : <DataTable columns={cols} rows={data!.rows} rowKey={(r) => r.id} dense maxHeight="620px"
                sortInitial={{ key: "date", desc: true }} />}
      </Panel>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40"
      title={hint}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="nums mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}
