import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { AcademyBooksResult, BookRow } from "../lib/types";
import { Chip, EmptyState, Panel, Skeleton, cn, inputClass, type Column, DataTable } from "../components/ui";

const LEVEL_TONE: Record<string, "rose" | "amber" | "sky"> = {
  入门: "sky", 进阶: "amber", 高阶: "rose",
};

/** 与后端 services/academy.py 的 BOOK_CATEGORIES 保持一致 */
const CATEGORY_LABEL: Record<string, string> = {
  equity: "股票交易", etf: "ETF 与指数", macro: "黄金现货与宏观",
};

export default function AcademyBooksPage() {
  const [data, setData] = useState<AcademyBooksResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [kw, setKw] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<AcademyBooksResult>("/academy/books"));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const all = data?.rows ?? [];
  const rows = all.filter((b) => (cat === "all" || b.category === cat)
    && (!kw.trim() || b.title.includes(kw.trim()) || b.author.includes(kw.trim())
      || b.insight.includes(kw.trim())));

  return (
    <div className="space-y-4">
      <Panel
        title="投资学堂 · 推荐书籍"
        subtitle={data
          ? `${data.total} 本 · 分 ${data.categories.length} 类：`
            + `${data.categories.map((c) => c.label).join(" / ")} · ${data.note}`
          : error ?? "正在读取书单…"}
        right={(
          <Link to="/academy/basics"
            className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            看盘基础
          </Link>
        )}
      >
        {busy && !data ? <Skeleton className="h-16 w-full" /> : (
          <div className="flex flex-wrap items-center gap-2">
            {[{ key: "all", label: "全部书单", count: data?.total ?? 0 }]
              .concat((data?.groups ?? []).map((g) => ({ key: g.key, label: g.label, count: g.count })))
              .map((t) => (
                <button key={t.key} type="button" onClick={() => setCat(t.key)}
                  className={cn("rounded-lg border px-2.5 py-1 text-xs transition",
                    cat === t.key
                      ? "border-slate-800 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  {t.label}<span className="nums ml-1 opacity-70">{t.count}</span>
                </button>
              ))}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {Object.entries(data?.levelDist ?? {}).map(([lv, n]) => (
                <Chip key={lv} tone={LEVEL_TONE[lv] ?? "slate"}>{lv} {n} 本</Chip>
              ))}
            </span>
          </div>
        )}
        {cat !== "all" && data?.categories.find((c) => c.key === cat) && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            分类说明：{data.categories.find((c) => c.key === cat)!.desc}
          </p>
        )}
      </Panel>

      {busy && !data ? <Skeleton className="h-64 w-full" /> : rows.length === 0 ? (
        <Panel title="书单"><EmptyState text={kw ? `没有匹配「${kw}」的书` : "这个分类下暂无书目"}
          hint="换个分类或清空关键词" /></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => <BookCard key={`${b.category}-${b.title}`} b={b} />)}
        </div>
      )}

      <Panel title="全部书目对照表"
        subtitle={`${rows.length} 行 · 阅读顺序为作者建议的递进关系，不是出版年`}
        right={<input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="筛书名/作者/洞察"
          className={cn(inputClass, "h-8 w-40! shrink-0 !py-1 text-xs")} />}
        bodyClass="p-0">
        <DataTable dense maxHeight="420px" rows={rows} rowKey={(r) => `${r.category}-${r.title}`}
          columns={cols} empty="没有匹配的书目" sortInitial={{ key: "o", desc: false }} />
      </Panel>
    </div>
  );
}

function BookCard({ b }: { b: BookRow }) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
          <span className="nums mr-1.5 text-slate-400">{String(b.order).padStart(2, "0")}</span>
          {b.title}
        </h3>
        <Chip tone={LEVEL_TONE[b.level] ?? "slate"}>{b.level}</Chip>
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{b.author}</p>
      <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
        核心洞察：{b.insight}
      </p>
      <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{b.why}</p>
    </article>
  );
}

const cols: Column<BookRow>[] = [
  { key: "o", label: "顺序", align: "right", value: (r) => r.order, render: (r) => (
    <span className="nums text-slate-400">{String(r.order).padStart(2, "0")}</span>) },
  { key: "t", label: "书名", value: (r) => r.title, render: (r) => (
    <span className="whitespace-normal text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.title}</span>) },
  { key: "a", label: "作者", value: (r) => r.author, render: (r) => (
    <span className="whitespace-normal text-xs text-slate-500">{r.author}</span>) },
  { key: "c", label: "分类", value: (r) => r.category, render: (r) => (
    <span className="whitespace-normal text-[11px] text-slate-500">{CATEGORY_LABEL[r.category] ?? r.category}</span>) },
  { key: "l", label: "难度", align: "center", value: (r) => r.level, render: (r) => (
    <Chip tone={LEVEL_TONE[r.level] ?? "slate"}>{r.level}</Chip>) },
  { key: "i", label: "核心洞察", value: (r) => r.insight, render: (r) => (
    <span className="whitespace-normal text-xs text-slate-600 dark:text-slate-300">{r.insight}</span>) },
  { key: "w", label: "为什么读它", render: (r) => (
    <span className="line-clamp-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{r.why}</span>) },
];
