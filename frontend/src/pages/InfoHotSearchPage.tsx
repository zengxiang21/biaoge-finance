import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { HotRow, HotSearchResult } from "../lib/types";
import { num } from "../lib/format";
import { Button, Chip, EmptyState, Panel, Skeleton, cn } from "../components/ui";

const BOARDS: { key: string; label: string; hint: string }[] = [
  { key: "baidu", label: "百度热搜", hint: "全网关注度最高的话题" },
  { key: "weibo", label: "微博热搜", hint: "社交传播热度，情绪指标" },
  { key: "eastmoney_hot", label: "东财人气榜", hint: "股票关注度排行，可直接跳个股分析" },
];

export default function InfoHotSearchPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<HotSearchResult | null>(null);
  const [board, setBoard] = useState("baidu");
  const [finOnly, setFinOnly] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<HotSearchResult>("/info/hot-search", { num: 30 }, 40_000));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = (data?.boards?.[board] ?? []).filter((r) => !finOnly || r.finance);
  const counts = Object.fromEntries(
    Object.entries(data?.boards ?? {}).map(([k, v]) => [k, v.filter((r) => r.finance).length]));

  return (
    <div className="space-y-4">
      <Panel
        title="热搜"
        subtitle={data
          ? `${data.generatedAt} · 百度 ${data.boards.baidu?.length ?? 0} 条 / 微博 ${data.boards.weibo?.length ?? 0} 条 / 人气榜 ${data.boards.eastmoney_hot?.length ?? 0} 条 · 财经相关已置顶`
          : error ?? "正在抓取百度、微博与东财热榜…"}
        right={(
          <>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={finOnly} onChange={(e) => setFinOnly(e.target.checked)} />
              只看财经相关
            </label>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {BOARDS.map((b) => {
            const total = data?.boards?.[b.key]?.length ?? 0;
            return (
              <button key={b.key} type="button" title={b.hint} onClick={() => setBoard(b.key)}
                className={cn("nums rounded-md border px-2.5 py-1 text-xs transition",
                  board === b.key
                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                    : "border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300")}>
                {b.label}
                <span className="ml-1 opacity-70">{total}</span>
                {counts[b.key] > 0 && <span className="ml-1 text-amber-500">财{counts[b.key]}</span>}
              </button>
            );
          })}
        </div>

        {busy && !data ? (
          <div className="mt-4 space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState text={data ? "这个榜暂时没有数据" : "热榜取数失败"}
            hint={data?.errors?.[board] ?? "百度/微博接口偶发限流，稍后重试"} />
        ) : (
          <ol className="mt-4 grid gap-2 lg:grid-cols-2">
            {rows.map((r) => (
              <HotRowView key={`${r.source}-${r.rank}`} r={r}
                onStock={r.symbol ? () => navigate(`/stock-analysis/${r.symbol}`) : undefined} />
            ))}
          </ol>
        )}

        {!!data && Object.keys(data.errors ?? {}).length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {Object.entries(data.errors).map(([k, v]) => `${BOARDS.find((b) => b.key === k)?.label ?? k}：${v}`).join("；")}
          </p>
        )}
      </Panel>
    </div>
  );
}

function HotRowView({ r, onStock }: { r: HotRow; onStock?: () => void }) {
  const hot = typeof r.hot === "string" ? Number(r.hot) : r.hot;
  return (
    <li className="flex gap-2.5 rounded-lg border border-slate-200/70 bg-white/70 p-2.5 dark:border-slate-700/60 dark:bg-slate-900/40">
      <span className={cn("nums w-6 shrink-0 text-center text-[13px] font-semibold",
        r.rank <= 3 ? "text-rose-500" : "text-slate-400")}>{r.rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {r.finance && <Chip tone="amber">财经</Chip>}
          {r.tag && r.tag !== "0" && <Chip tone="slate">{String(r.tag)}</Chip>}
          {onStock && (
            <button type="button" onClick={onStock}
              className="nums text-[11px] text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
              {r.symbol}
            </button>
          )}
        </div>
        {r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer"
            className="mt-0.5 block text-[13px] font-medium leading-snug text-slate-800 underline-offset-2 hover:underline dark:text-slate-100">
            {r.word}
          </a>
        ) : (
          <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-800 dark:text-slate-100">{r.word}</p>
        )}
        {r.desc && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
            title={r.desc}>{r.desc}</p>
        )}
      </div>
      <span className="nums shrink-0 self-center text-[11px] text-slate-400">
        {hot === null || hot === undefined ? "" : num(hot / 1e4, 1, "万")}
      </span>
    </li>
  );
}
