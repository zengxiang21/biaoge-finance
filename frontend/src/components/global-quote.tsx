import { GlobalQuote } from "../lib/types";
import { num, price } from "../lib/format";
import { cn } from "./ui";

/** 分组行情卡：一组（美股/能源/汇率…）一个小卡，卡头给组内平均涨跌幅 */
export function QuoteGroupCard({
  group, unitHint, onRowClick,
}: {
  group: { key: string; label: string; rows: GlobalQuote[]; avgChange: number | null };
  unitHint?: (q: GlobalQuote) => string | null;
  onRowClick?: (q: GlobalQuote) => void;
}) {
  const avg = group.avgChange;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 dark:border-slate-700/60 dark:bg-slate-900/50">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{group.label}</span>
        <span className={cn("nums text-xs font-medium",
          avg === null ? "text-slate-400" : avg >= 0 ? "text-rose-500" : "text-emerald-500")}>
          {avg === null ? "均值 —" : `均 ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`}
        </span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {group.rows.map((q) => {
          const up = (q.change_percent ?? 0) >= 0;
          const flat = q.change_percent === null || q.change_percent === 0;
          const hint = unitHint?.(q) ?? null;
          return (
            <li key={q.code}>
              <button type="button" disabled={!onRowClick} onClick={() => onRowClick?.(q)}
                title={`${q.name} ${q.date ?? ""} ${q.time ?? ""}${hint ? ` · ${hint}` : ""}`}
                className={cn("flex w-full items-start gap-2 px-3 py-1.5 text-left",
                  onRowClick && "hover:bg-slate-50 dark:hover:bg-slate-800/60")}>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-tight text-slate-700 dark:text-slate-200">{q.name}</span>
                  <span className="nums mt-0.5 block text-[10px] leading-tight text-slate-400">
                    {q.date ?? "—"} {q.time?.slice(0, 5) ?? ""}
                    {hint ? ` · ${hint}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="nums block text-xs font-medium text-slate-800 dark:text-slate-100">
                    {price(q.price, q.price !== null && q.price < 10 ? 4 : 2)}
                  </span>
                  <span className={cn("nums block text-[11px] leading-tight",
                    flat ? "text-slate-400" : up ? "text-rose-500" : "text-emerald-500")}>
                    {q.change_percent === null ? "—"
                      : `${up ? "+" : ""}${q.change_percent.toFixed(2)}%`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {group.rows.length === 0 && (
          <li className="px-3 py-2 text-xs text-slate-400">该组暂无行情</li>
        )}
      </ul>
    </div>
  );
}

/** 外围标的与 A 股的对照条：指数涨跌并排，判断传导方向 */
export function AshareStrip({ rows }: { rows: { symbol: string; name?: string; label?: string;
  price?: number | null; change_percent?: number | null }[] }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => {
        const up = (r.change_percent ?? 0) >= 0;
        return (
          <div key={r.symbol}
            className="rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1.5 dark:border-slate-700/60 dark:bg-slate-900/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{r.label ?? r.name ?? r.symbol}</p>
            <p className="nums mt-0.5 text-xs">
              <span className="text-slate-700 dark:text-slate-200">{num(r.price ?? null, 2)}</span>
              <span className={cn("ml-1.5 font-medium", up ? "text-rose-500" : "text-emerald-500")}>
                {r.change_percent === null || r.change_percent === undefined ? "—"
                  : `${up ? "+" : ""}${r.change_percent.toFixed(2)}%`}
              </span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function SourceErrors({ errors }: { errors: Record<string, string> }) {
  const items = Object.entries(errors ?? {});
  if (!items.length) return null;
  return (
    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
      {items.map(([k, v]) => `${k}：${v}`).join("；")}
    </p>
  );
}
