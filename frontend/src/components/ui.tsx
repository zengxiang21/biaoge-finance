import { ReactNode, useMemo, useState } from "react";
import { TONE, dirOf } from "../lib/colors";
import { useSession } from "../store/session";
import { useToast } from "../store/toast";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------------------------------------- 基础容器 */

export function Panel({
  title, subtitle, right, children, className, loading, bodyClass,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  loading?: boolean;
  bodyClass?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur",
        "dark:border-slate-700/60 dark:bg-slate-900/60",
        className,
      )}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm leading-snug font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center justify-end gap-2">{right}</div>}
        </header>
      )}
      <div className={cn("relative p-4", bodyClass)}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-900/60">
            <Spinner />
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-200",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
      {hint && <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

export function Chip({
  children, tone = "slate", className,
}: {
  children: ReactNode;
  tone?: "slate" | "rose" | "emerald" | "amber" | "sky" | "violet";
  className?: string;
}) {
  const map: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    sky: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", map[tone], className)}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = "primary", size = "md", disabled, loading, type = "button", className, title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800",
    ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        styles, className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Field({
  label, children, hint,
}: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none " +
  "placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 " +
  "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

/* --------------------------------------------------------------- 涨跌数字 */

export function UpDown({
  value, digits = 2, suffix = "%", sign = true, className, strong = true,
}: { value: number | null | undefined; digits?: number; suffix?: string; sign?: boolean; className?: string; strong?: boolean }) {
  const dir = dirOf(value);
  const text = value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : `${sign && value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
  return (
    <span className={cn("nums", dir === "up" ? "text-rose-500" : dir === "down" ? "text-emerald-500" : "text-slate-400",
      strong && "font-semibold", TONE[dir].text, className)}>
      {text}
    </span>
  );
}

/* ------------------------------------------------------ DataTable（文档 10.4） */

export type Column<T> = {
  key: string;
  label: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  value?: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
};

export function DataTable<T>({
  columns, rows, rowKey, loading, empty, onRowClick, sortInitial, maxHeight, dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  empty?: string;
  onRowClick?: (row: T) => void;
  sortInitial?: { key: string; desc: boolean };
  maxHeight?: string;
  dense?: boolean;
}) {
  const [sort, setSort] = useState(sortInitial ?? { key: "", desc: false });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value || !sort.key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      const an = av === null || av === undefined || av === "" ;
      const bn = bv === null || bv === undefined || bv === "";
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      const r = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "zh-CN");
      return sort.desc ? -r : r;
    });
    return copy;
  }, [rows, columns, sort]);

  const clickSort = (col: Column<T>) => {
    if (!col.value && !col.sortable) return;
    setSort((s) => (s.key === col.key ? { key: col.key, desc: !s.desc } : { key: col.key, desc: true }));
  };

  if (loading && !rows.length) {
    return (
      <div className="space-y-2 p-1">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState text={empty ?? "暂无数据"} />;

  const pad = dense ? "px-2 py-1" : "px-3 py-1.5";
  return (
    <div className={cn("overflow-auto rounded-lg", maxHeight ?? "max-h-[420px]")}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur dark:bg-slate-800/95">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => clickSort(c)}
                className={cn(
                  "select-none whitespace-nowrap px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400",
                  c.width,
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                  (c.value || c.sortable) && "cursor-pointer hover:text-slate-800 dark:hover:text-slate-200",
                )}
              >
                {c.label}
                {sort.key === c.key && <span className="ml-1">{sort.desc ? "↓" : "↑"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? (e) => {
                // 行内按钮（删除/自选/看行情）不该再触发整行跳转
                if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
                onRowClick(row);
              } : undefined}
              className={cn(
                "border-t border-slate-100 transition-colors dark:border-slate-800",
                "hover:bg-slate-50 dark:hover:bg-slate-800/60",
                onRowClick && "cursor-pointer",
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(pad, "whitespace-nowrap text-slate-700 dark:text-slate-200",
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------- Markdown（子集） */

/** AI 研报是 Markdown，项目没装 markdown 库，这里覆盖标题/列表/加粗/代码/分隔线够用 */
function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[1] !== undefined
      ? <strong key={`${keyBase}-${n}`} className="font-semibold text-slate-900 dark:text-slate-100">{m[1]}</strong>
      : <code key={`${keyBase}-${n}`} className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">{m[2]}</code>);
    last = m.index + m[0].length;
    n += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 本地小模型很爱把整篇回答包进 ```markdown 代码块，整段是代码块时拆开再按正文渲染 */
function unwrapFence(text: string) {
  const m = /^\s*```[a-zA-Z0-9]*[^\S\n]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1] : text;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = unwrapFence(text).replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    const id = key++;
    blocks.push(<p key={`p${id}`} className="leading-relaxed">{inline(para.join(" "), `p${id}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const id = key++;
    blocks.push(ordered ? (
      <ol key={`l${id}`} className="space-y-0.5">
        {items.map((it, i) => <li key={i} className="ml-5 list-decimal leading-relaxed">{inline(it, `o${id}-${i}`)}</li>)}
      </ol>
    ) : (
      <ul key={`l${id}`} className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 leading-relaxed">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span className="min-w-0">{inline(it, `u${id}-${i}`)}</span>
          </li>
        ))}
      </ul>
    ));
    list = null;
  };

  for (let li = 0; li < lines.length; li += 1) {
    const raw = lines[li];
    const line = raw.trimEnd();
    const fence = /^\s*```/.test(raw);
    if (fence) {
      flushPara(); flushList();
      const buf: string[] = [];
      while (li + 1 < lines.length && !/^\s*```/.test(lines[li + 1])) { buf.push(lines[li + 1]); li += 1; }
      li += 1;
      blocks.push(
        <pre key={`c${key++}`}
          className="overflow-x-auto rounded-lg bg-slate-100 p-2 text-[11.5px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {buf.join("\n")}
        </pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushPara(); flushList();
      blocks.push(<h4 key={`h${key++}`} className="pt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
        {inline(heading[2], `h${key}`)}
      </h4>);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara(); flushList();
      blocks.push(<hr key={`r${key++}`} className="border-slate-200 dark:border-slate-700" />);
    } else if (bullet || ordered) {
      flushPara();
      const o = Boolean(ordered);
      if (!list || list.ordered !== o) { flushList(); list = { ordered: o, items: [] }; }
      list.items.push((bullet ?? ordered)![1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return <div className={cn("space-y-1.5 text-[12.5px] text-slate-700 dark:text-slate-300", className)}>{blocks}</div>;
}

/* --------------------------------------------- PermissionGate（文档 10.4） */
export function PermissionGate({
  code, children, fallback = null,
}: { code: string; children: ReactNode; fallback?: ReactNode }) {
  const allowed = useSession((s) => s.permissions.includes(code));
  return <>{allowed ? children : fallback}</>;
}

/* --------------------------------------------------------------- Toast 宿主 */

const TOAST_TONE: Record<string, string> = {
  info: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  ok: "bg-emerald-600 text-white",
  error: "bg-rose-600 text-white",
  warn: "bg-amber-500 text-slate-900",
};

export function ToastHost() {
  const { items, drop } = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => drop(t.id)}
          className={cn("pointer-events-auto max-w-md animate-[pop_0.18s_ease-out] rounded-lg px-4 py-2 text-sm shadow-lg",
            TOAST_TONE[t.kind])}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
