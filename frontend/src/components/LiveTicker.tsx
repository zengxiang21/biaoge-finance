import { useEffect, useRef, useState } from "react";
import { isDemo } from "../lib/api";
import { fetchLiveQuotes, LIVE_INDEXES, type LiveQuote } from "../lib/live";
import { dirOf, TONE } from "../lib/colors";
import { pct } from "../lib/format";
import { cn } from "./ui";

const EVERY_MS = 5000;
const FLASH_MS = 900;

/** 演示站没有后端，这一条报价是浏览器直连腾讯源，5 秒一跳；其余面板仍是冻结快照 */
export function LiveTicker({ symbols = LIVE_INDEXES }: { symbols?: string[] }) {
  const [rows, setRows] = useState<LiveQuote[]>([]);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const [error, setError] = useState<string | null>(null);
  const lastPrice = useRef<Record<string, number>>({});
  // 传进来的数组每次渲染都是新的，只认它的字符串形态，否则定时器每帧都被重建
  const key = symbols.join(",");

  useEffect(() => {
    if (!isDemo) return;
    const list = key.split(",");
    let alive = true;
    const run = async () => {
      try {
        const got = await fetchLiveQuotes(list);
        if (!alive || got.length === 0) return;
        const changed: Record<string, "up" | "down"> = {};
        for (const q of got) {
          const prev = lastPrice.current[q.symbol];
          if (prev !== undefined && q.price !== prev) changed[q.symbol] = q.price > prev ? "up" : "down";
          lastPrice.current[q.symbol] = q.price;
        }
        setRows(got);
        setError(null);
        if (Object.keys(changed).length) {
          setFlash(changed);
          window.setTimeout(() => alive && setFlash({}), FLASH_MS);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    const timer = window.setInterval(run, EVERY_MS);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  if (!isDemo) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        实时报价 · 浏览器直连腾讯源，5 秒一跳
      </span>
      {rows.map((q) => {
        const dir = dirOf(q.change);
        return (
          <span
            key={q.symbol}
            className={cn(
              "nums flex items-baseline gap-1 rounded px-1 text-[12px] transition-colors duration-300",
              flash[q.symbol] === "up" && "bg-rose-100 dark:bg-rose-500/20",
              flash[q.symbol] === "down" && "bg-emerald-100 dark:bg-emerald-500/20",
            )}
          >
            <span className="text-slate-500 dark:text-slate-400">{q.name}</span>
            <span className={cn("font-semibold", TONE[dir].text)}>{q.price.toFixed(2)}</span>
            <span className={TONE[dir].text}>{pct(q.changePercent)}</span>
          </span>
        );
      })}
      {rows.length === 0 && !error && <span className="text-[11px] text-slate-400">报价连接中…</span>}
      <span className="ml-auto text-[11px] text-slate-400">
        {error
          ? `实时源没响应（${error.slice(0, 40)}），其余面板仍是冻结快照`
          : `行情时间 ${rows[0]?.at ?? "—"}`}
      </span>
    </div>
  );
}
