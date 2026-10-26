import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { money, num, price } from "../lib/format";
import type { CommonFilter, HardParam, Pick, StrategyRow } from "../lib/types";
import { BOARD_LABEL } from "../lib/strategy";
import {
  Button, Chip, DataTable, Field, UpDown, cn, inputClass, type Column,
} from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

/* --------------------------------------------------------- 选股结果表 */

export function PickTable({ items, loading }: { items: Pick[]; loading?: boolean }) {
  const navigate = useNavigate();
  const hasPerm = useSession((s) => s.hasPerm);
  const canAdd = hasPerm("watchlist:item_create");

  const addWatch = async (p: Pick) => {
    try {
      await api.post("/watchlists/items", { keyword: p.symbol, note: `策略选股 ${p.score}` });
      toast(`${p.name} 已加入自选`, "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const cols: Column<Pick>[] = [
    { key: "name", label: "名称/代码", width: "w-36", render: (r) => (
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{r.name}</div>
        <div className="nums text-[10px] text-slate-400">{r.symbol}</div>
      </div>) },
    { key: "score", label: "评分", align: "right", width: "w-16", value: (r) => r.score,
      render: (r) => <span className={cn("nums font-semibold",
        r.score >= 80 ? "text-rose-500" : r.score >= 65 ? "text-amber-500" : "text-slate-500")}>
        {r.score.toFixed(1)}
      </span> },
    { key: "price", label: "现价", align: "right", width: "w-16", value: (r) => r.price,
      render: (r) => <span className="nums">{price(r.price)}</span> },
    { key: "pct_chg", label: "涨跌", align: "right", width: "w-20", value: (r) => r.pct_chg,
      render: (r) => <UpDown value={r.pct_chg} /> },
    { key: "volume_ratio", label: "量比", align: "right", width: "w-14", value: (r) => r.volume_ratio,
      render: (r) => <span className="nums">{num(r.volume_ratio, 2)}</span> },
    { key: "turnover", label: "换手", align: "right", width: "w-16", value: (r) => r.turnover,
      render: (r) => <span className="nums">{num(r.turnover, 2, "%")}</span> },
    { key: "amount", label: "成交额", align: "right", width: "w-20", value: (r) => r.amount,
      render: (r) => <span className="nums">{money(r.amount)}</span> },
    { key: "signals", label: "命中信号", width: "w-56", render: (r) => (
      <div className="flex max-w-[14rem] flex-wrap gap-1">
        {r.signals.slice(0, 4).map((s) => <Chip key={s} tone="sky" className="max-w-full truncate">{s}</Chip>)}
        {!r.signals.length && <span className="text-xs text-slate-400">—</span>}
      </div>) },
    { key: "industry", label: "行业", value: (r) => r.industry, render: (r) => (
      // 行业名最长有十几个字，折行会把行高顶到 3 倍；表格本来就能横向滚，让它单行铺开
      <span className="whitespace-nowrap text-xs text-slate-500"
        title={r.industry ?? ""}>{r.industry || "—"}</span>) },
    { key: "concepts", label: "概念", width: "w-40", render: (r) => (
      <div className="flex max-w-40 flex-wrap gap-1">
        {r.concepts.slice(0, 3).map((c) => <Chip key={c} className="max-w-full truncate">{c}</Chip>)}
        {!r.concepts.length && <span className="text-xs text-slate-400">—</span>}
      </div>) },
    { key: "act", label: "操作", align: "center", width: "w-16", render: (r) => (
      <Button size="sm" variant="ghost" disabled={!canAdd} title={canAdd ? "加入自选" : "无自选权限"}
        onClick={() => void addWatch(r)}>自选</Button>) },
  ];

  return (
    <DataTable columns={cols} rows={items} rowKey={(r) => r.symbol} loading={loading}
      sortInitial={{ key: "score", desc: true }}
      empty="这次运行没有股票满足全部条件，可以把最低评分调低一档再跑"
      onRowClick={(r) => navigate(`/stock-analysis/${r.symbol}`)} />
  );
}

/* --------------------------------------------------------- 参数编辑器 */

export type ParamDraft = {
  max_output: number;
  min_score: number;
  hard: Record<string, number | boolean>;
  filters: Record<string, number | boolean | string[]>;
};

export function defaultDraft(row: StrategyRow, filters: CommonFilter[]): ParamDraft {
  return {
    max_output: row.params?.max_output ?? 100,
    min_score: row.params?.min_score ?? 55,
    hard: { ...(Object.fromEntries(row.hardParams.map((h) => [h.key, h.default])) as Record<string, number | boolean>),
            ...(row.params?.hard ?? {}) },
    filters: { ...(Object.fromEntries(filters.map((f) => [f.key, f.default])) as ParamDraft["filters"]),
               ...(row.params?.filters ?? {}) },
  };
}

function NumBox({ label, unit, hint, value, onChange, disabled }: {
  label: string; unit?: string; hint?: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint ?? unit}>
      <input type="number" className={cn(inputClass, "nums py-1 text-[13px]")} value={value}
        disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition",
        checked ? "border-slate-800 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
        disabled && "cursor-not-allowed opacity-60")}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", checked ? "bg-emerald-400" : "bg-slate-400/60")} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/** 硬条件 + 通用过滤 + 输出控制（文档 3.5.6 / 3.5.7） */
export function ParamsEditor({ hard, filters, value, onChange, readOnly }: {
  hard: HardParam[];
  filters: CommonFilter[];
  value: ParamDraft;
  onChange: (v: ParamDraft) => void;
  readOnly?: boolean;
}) {
  const setHard = (k: string, v: number | boolean) => onChange({ ...value, hard: { ...value.hard, [k]: v } });
  const setFilter = (k: string, v: number | boolean | string[]) =>
    onChange({ ...value, filters: { ...value.filters, [k]: v } });
  const boards = useMemo(() => (value.filters.boards as string[] | undefined) ?? [], [value.filters.boards]);
  const toggleBoard = (k: string) => {
    const next = boards.includes(k) ? boards.filter((b) => b !== k) : [...boards, k];
    setFilter("boards", next);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumBox label="最大输出数量" unit="只" value={value.max_output} disabled={readOnly}
          onChange={(v) => onChange({ ...value, max_output: v })} />
        <NumBox label="最低评分" unit="0-100，填 0 = 只用硬条件" value={value.min_score} disabled={readOnly}
          onChange={(v) => onChange({ ...value, min_score: v })} />
      </div>

      {!!hard.length && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">专属硬条件</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {hard.map((h) => (h.type === "boolean"
              ? <div key={h.key} className="self-end">
                  <Toggle label={h.label} checked={Boolean(value.hard[h.key] ?? h.default)} disabled={readOnly}
                    onChange={(v) => setHard(h.key, v)} />
                </div>
              : <NumBox key={h.key} label={h.label} value={Number(value.hard[h.key] ?? h.default)} disabled={readOnly}
                  onChange={(v) => setHard(h.key, v)} />))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">通用基础过滤（所有策略共享）</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filters.filter((f) => f.type === "boolean").map((f) => (
            <div key={f.key} className="self-end">
              <Toggle label={f.label} checked={Boolean(value.filters[f.key])} disabled={readOnly}
                onChange={(v) => setFilter(f.key, v)} />
            </div>
          ))}
          {filters.filter((f) => f.type === "number").map((f) => (
            <NumBox key={f.key} label={f.label} unit={f.unit} hint={f.hint} disabled={readOnly}
              value={Number(value.filters[f.key] ?? f.default ?? 0)}
              onChange={(v) => setFilter(f.key, v)} />
          ))}
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-xs font-medium text-slate-500">板块多选</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(BOARD_LABEL).map(([k, label]) => (
              <button key={k} type="button" disabled={readOnly} onClick={() => toggleBoard(k)}
                className={cn("rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-60",
                  boards.includes(k)
                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                    : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400")}>
                {label}
              </button>
            ))}
          </div>
          {!boards.length && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">板块全不选会一只都扫不出来</p>}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 叠加权重编辑 */

export type CompositePart = { strategy_code: string; name?: string; weight: number };

/** 权重实时归一为 100%（文档 3.5.9） */
export function normalize(parts: CompositePart[]): CompositePart[] {
  const total = parts.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  return parts.map((p) => ({ ...p, weight: Math.round(Math.max(0, p.weight) / total * 1000) / 10 }));
}

export function CompositeEditor({ pool, parts, onChange, readOnly }: {
  pool: { code: string; name: string }[];
  parts: CompositePart[];
  onChange: (p: CompositePart[]) => void;
  readOnly?: boolean;
}) {
  const shown = normalize(parts);
  const total = parts.reduce((s, p) => s + Math.max(0, p.weight), 0);
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={p.strategy_code + i} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200/80 px-3 py-2 dark:border-slate-700/60">
          <select className={cn(inputClass, "w-44 py-1 text-[13px]")} value={p.strategy_code} disabled={readOnly}
            onChange={(e) => {
              const next = parts.map((x, j) => j === i
                ? { ...x, strategy_code: e.target.value, name: pool.find((q) => q.code === e.target.value)?.name }
                : x);
              onChange(next);
            }}>
            {pool.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
          <input type="range" min={1} max={90} value={p.weight} disabled={readOnly}
            className="min-w-28 flex-1 accent-slate-700"
            onChange={(e) => onChange(parts.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} />
          <span className="nums w-14 text-right text-[13px] font-semibold">{shown[i]?.weight ?? 0}%</span>
          {!readOnly && parts.length > 2 && (
            <Button size="sm" variant="ghost" onClick={() => onChange(parts.filter((_, j) => j !== i))}>删除</Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <Button size="sm" variant="outline" disabled={parts.length >= 5}
            onClick={() => onChange([...parts, { strategy_code: pool[0]?.code ?? "", weight: 20 }])}>
            添加子策略
          </Button>
        )}
        <span className={cn("text-[11px]", total > 0 ? "text-slate-400" : "text-amber-600")}>
          权重合计 {total}，保存时自动归一为 100%；至少 2 个、每个必须大于 0
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 代码查看/编辑 */

export function CodeEditor({ value, onChange, readOnly, problems }: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  problems?: string[];
}) {
  return (
    <div>
      <textarea
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => onChange?.(e.target.value)}
        rows={Math.min(26, Math.max(10, value.split("\n").length + 1))}
        className={cn(inputClass, "nums resize-y whitespace-pre font-mono text-[11.5px] leading-[1.55]")}
      />
      {!!problems?.length && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-rose-600 dark:text-rose-400">
          {problems.map((p) => <li key={p}>· {p}</li>)}
        </ul>
      )}
      {!problems?.length && (
        <p className="mt-1 text-[11px] text-slate-400">
          必须包含 META、def basic_filter、def scoring 三段；不接受 import 之外的文件读写与网络调用。
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------- 运行摘要条 */

/** PicksResult 与 StrategyRun 的公共子集：字段可空，两者都能直接传进来 */
export type RunLike = {
  universe_count?: number | null;
  candidate_count?: number | null;
  pick_count?: number | null;
  elapsed_ms?: number | null;
  summary?: string | null;
  data_warnings?: string[];
  error_message?: string | null;
};

export function RunSummary({ result }: { result: RunLike | null }) {
  const r = result;
  if (!r) return null;
  const meta = [
    { k: "全市场", v: r.universe_count, unit: "只" },
    { k: "过滤后候选", v: r.candidate_count, unit: "只" },
    { k: "命中", v: r.pick_count, unit: "只" },
    { k: "耗时", v: r.elapsed_ms != null ? Math.round(r.elapsed_ms / 100) / 10 : null, unit: "秒" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {meta.map((m) => (
          <div key={m.k} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/50">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.k}</p>
            <p className="nums text-[15px] font-semibold">
              {m.v ?? "—"}
              {m.v !== null && m.v !== undefined && <span className="ml-0.5 text-[11px] font-normal text-slate-400">{m.unit}</span>}
            </p>
          </div>
        ))}
      </div>
      {!!r.data_warnings?.length && (
        <ul className="space-y-0.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          {r.data_warnings.map((w, i) => <li key={i}>· {w}</li>)}
        </ul>
      )}
      {r.error_message && (
        <p className="text-[12px] text-rose-600 dark:text-rose-400">{r.error_message}</p>
      )}
    </div>
  );
}
