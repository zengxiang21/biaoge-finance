import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import http, { api, messageOf } from "../lib/api";
import type { AiGeneration, CommonFilter, StrategyMeta, StrategyRow } from "../lib/types";
import { familyChip, isTradingTime, readRunStats, scheduleWarning, stars, writeRunStats } from "../lib/strategy";
import {
  Button, Chip, EmptyState, Field, Panel, PermissionGate, Skeleton,
  cn, inputClass,
} from "../components/ui";
import { CodeEditor, CompositeEditor, type CompositePart } from "../components/strategy";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

const KINDS = [
  { key: "all", label: "全部" },
  { key: "system", label: "内置" },
  { key: "custom", label: "自定义" },
  { key: "ai", label: "AI 创建" },
  { key: "composite", label: "叠加" },
] as const;

const TYPE_TONE: Record<string, "slate" | "rose" | "sky" | "violet" | "amber"> = {
  内置: "slate", 自定义: "sky", AI: "violet", 叠加: "rose",
};

const FAMILY_TONE: Record<string, "emerald" | "sky" | "amber" | "rose"> = {
  技术面: "emerald", 资金面: "sky", 事件面: "amber", 叠加组合: "rose",
};

export default function StrategyListPage() {
  const navigate = useNavigate();
  const hasPerm = useSession((s) => s.hasPerm);
  const [rows, setRows] = useState<StrategyRow[] | null>(null);
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [kind, setKind] = useState<string>("all");
  const [family, setFamily] = useState("");
  const [kw, setKw] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ rows: StrategyRow[]; total: number; families: { key: string; label: string }[];
        commonFilters: CommonFilter[] }>("/strategies?kind=all", undefined, 30_000);
      const cached = readRunStats();
      let touched = false;
      for (const row of r.rows) {
        if (row.lastPickCount) { cached[String(row.id)] = row.lastPickCount; touched = true; }
      }
      if (touched) writeRunStats(cached);
      setRows(r.rows.map((row) => ({ ...row, lastPickCount: row.lastPickCount || cached[String(row.id)] || 0 })));
    } catch (e) {
      setError(messageOf(e));
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api.get<StrategyMeta>("/strategies/meta").then(setMeta).catch(() => undefined);
  }, []);

  // 与后端 list_strategies 的 kind 分支同一套判定，一次拉全量后本地筛，标签数字才不会随筛选变 0
  const matchKind = useCallback((r: StrategyRow, k: string) => {
    if (k === "system") return !!r.is_system;
    if (k === "composite") return r.strategy_type === "composite";
    if (k === "ai") return !!r.is_ai;
    if (k === "custom") return !r.is_system && !r.is_ai && r.strategy_type !== "composite";
    return true;
  }, []);

  const kindCount = useCallback((k: string) => (rows ?? []).filter((r) => matchKind(r, k)).length, [rows, matchKind]);

  const shown = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return (rows ?? []).filter((r) => matchKind(r, kind)
      && (!family || r.familyLabel === family)
      && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
          || (r.description ?? "").toLowerCase().includes(q)));
  }, [rows, kind, family, kw, matchKind]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const doc = list.map((r) => r.winRateDoc).filter((v): v is number => typeof v === "number");
    return {
      total: list.length,
      picked: list.reduce((s, r) => s + (r.lastPickCount ?? 0), 0),
      avgWin: doc.length ? Math.round(doc.reduce((a, b) => a + b, 0) / doc.length) : null,
      best: [...list].sort((a, b) => (b.winRateDoc ?? 0) - (a.winRateDoc ?? 0))[0],
    };
  }, [rows]);

  const runNow = async (row: StrategyRow) => {
    const warn = scheduleWarning(row);
    if (warn) {
      toast(warn, "error");
      navigate(`/strategy/${row.id}`);
      return;
    }
    setRunningId(row.id);
    try {
      const r = await api.post<{ run_id: number }>(`/strategies/${row.id}/run`, undefined, 60_000);
      navigate(`/strategy/${row.id}?run=${r.run_id}`);
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (row: StrategyRow) => {
    if (!window.confirm(`删除策略「${row.name}」？运行历史与选股结果会一并清掉。`)) return;
    try {
      await api.del(`/strategies/${row.id}`);
      toast(`已删除 ${row.name}`, "ok");
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="策略引擎"
        subtitle={busy && !rows ? "正在读取策略库…"
          : `${stats.total} 个策略 · 技术面/资金面/事件面全覆盖 · 单因子胜率普遍 35%-50%，叠加组合才是提高胜率的关键`}
        right={(
          <>
            <PermissionGate code="strategy:create">
              <Button size="sm" variant={creating ? "outline" : "primary"} onClick={() => setCreating((v) => !v)}>
                {creating ? "收起" : "新建策略"}
              </Button>
            </PermissionGate>
            <Button size="sm" variant="outline" loading={busy} onClick={() => void load()}>刷新</Button>
          </>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label="策略总数" value={stats.total} hint="内置 35 个 + 你自建/叠加/AI 生成的" />
          <Mini label="累计命中" value={stats.picked} hint="各策略最近一次 ready 运行的选股数之和" />
          <Mini label="文档平均胜率" value={stats.avgWin} unit="%"
            hint="拆解文档 3.5.14A 的公开回测参考值，不等于实盘" />
          <Mini label="最高文档胜率" value={stats.best?.winRateDoc ?? null} unit="%"
            hint={stats.best ? `${stats.best.name} · ${stats.best.scene ?? ""}` : undefined} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
            {KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)}
                className={cn("px-2.5 py-1 text-xs transition",
                  kind === k.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                {k.label}
                <span className="nums ml-1 opacity-70">
                  {kindCount(k.key)}
                </span>
              </button>
            ))}
          </div>
          {["技术面", "资金面", "事件面", "自定义"].map((f) => (
            <button key={f} type="button" onClick={() => setFamily(family === f ? "" : f)}
              className={cn("rounded-md border px-2 py-0.5 text-[11px] transition",
                family === f ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300")}>
              {f}
            </button>
          ))}
          <input className={cn(inputClass, "ml-auto w-full py-1 text-[13px] sm:w-56")} value={kw}
            placeholder="按名称/代码/描述筛选" onChange={(e) => setKw(e.target.value)} />
        </div>
        {!isTradingTime() && (
          <p className="mt-2 text-[11px] text-slate-400">
            当前非交易时段：盘中策略（intraday）会被调度拦下，随时可用（any）与盘后（after_hours）的正常跑。
          </p>
        )}
      </Panel>

      {creating && <CreatePanel meta={meta} pool={rows ?? []}
        onDone={() => { setCreating(false); void load(); }} />}

      {error && <Panel title="加载失败"><p className="text-xs text-rose-600">{error}</p></Panel>}

      {busy && !rows ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : !shown.length ? (
        <Panel title="没有匹配的策略">
          <EmptyState text="换个关键词或切回「全部」" hint="内置 35 个策略不受筛选影响，只要类型/板块选对就能看到" />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <StrategyCard key={r.id} row={r} busy={runningId === r.id} canDelete={!r.is_system && hasPerm("strategy:delete")}
              canRun={hasPerm("strategy:run")}
              onRun={() => void runNow(r)}
              onOpen={() => navigate(`/strategy/${r.id}`)}
              onDelete={() => void remove(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, unit, hint }: { label: string; value: number | null; unit?: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50" title={hint}>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="nums text-lg font-semibold leading-tight">
        {value ?? "—"}
        {value !== null && unit && <span className="ml-0.5 text-[11px] font-normal text-slate-400">{unit}</span>}
      </p>
    </div>
  );
}

function StrategyCard({ row, busy, canRun, canDelete, onRun, onOpen, onDelete }: {
  row: StrategyRow; busy: boolean; canRun: boolean; canDelete: boolean;
  onRun: () => void; onOpen: () => void; onDelete: () => void;
}) {
  const warn = scheduleWarning(row);
  const fam = familyChip(row);
  return (
    <div className="flex flex-col rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm transition hover:border-slate-400 dark:border-slate-700/60 dark:bg-slate-900/60 dark:hover:border-slate-500">
      <div className="flex items-baseline gap-2">
        <button type="button" onClick={onOpen} title={row.name}
          className="line-clamp-2 min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug text-slate-800 underline-offset-2 hover:underline dark:text-slate-100">
          {row.name}
        </button>
        <span className="nums shrink-0 text-[10px] text-slate-400">{row.code}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Chip tone={TYPE_TONE[row.typeLabel] ?? "slate"}>{row.typeLabel}</Chip>
        {fam && <Chip tone={FAMILY_TONE[fam] ?? "slate"}>{fam}</Chip>}
        {row.stars ? <span className="nums text-[11px] text-amber-500" title="推荐指数">{stars(row.stars)}</span> : null}
        {row.run_time_type !== "any" && <Chip tone="amber">{row.run_time_type === "intraday" ? "盘中" : "盘后"}</Chip>}
        {row.status === "inactive" && <Chip>已停用</Chip>}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        {row.description || "（无描述）"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="nums">文档胜率 {row.winRateDoc ?? "—"}%</span>
        <span className="nums">上次命中 {row.lastPickCount ?? 0} 只</span>
        {row.scene && <span className="truncate">{row.scene}</span>}
      </div>
      {!!row.dims.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {row.dims.map(([k, label]) => <Chip key={k} tone="sky" className="max-w-full truncate">{label}</Chip>)}
        </div>
      )}
      {warn && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">{warn}</p>}
      <div className="mt-2.5 flex items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
        <PermissionGate code="strategy:run">
          <Button size="sm" loading={busy} disabled={!canRun} onClick={onRun}>运行</Button>
        </PermissionGate>
        <Button size="sm" variant="outline" onClick={onOpen}>参数 / 结果</Button>
        {row.strategy_type === "composite" && (
          <Button size="sm" variant="ghost" onClick={onOpen} title="编辑子策略与权重">编辑叠加</Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="ml-auto text-rose-500" onClick={onDelete}>删除</Button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 新建策略 */

const TABS = [
  { key: "ai", label: "AI 生成" },
  { key: "code", label: "自定义编写" },
  { key: "composite", label: "叠加组合" },
] as const;

/** 试运行结果已经用芯片单独展示了，后端 note 里的同一句话不再重复 */
function noteWithoutDryRun(note?: string | null) {
  return (note ?? "").split("；").filter((s) => s && !s.startsWith("试运行覆盖")).join("；");
}

function CreatePanel({ meta, pool, onDone }: {
  meta: StrategyMeta | null;
  pool: StrategyRow[];
  onDone: () => void;
}) {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("ai");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [direction, setDirection] = useState("long");
  const [engine, setEngine] = useState("polars");
  const [rules, setRules] = useState("");
  const [code, setCode] = useState("");
  const [parts, setParts] = useState<CompositePart[]>([
    { strategy_code: "shrink_pullback", name: "缩量回调", weight: 60 },
    { strategy_code: "ma_bullish", name: "均线多头进阶", weight: 40 },
  ]);
  const [gen, setGen] = useState<AiGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const generate = async () => {
    if (rules.trim().length < 4) { toast("先用一句话描述选股逻辑", "error"); return; }
    setBusy(true);
    try {
      const r = await api.post<AiGeneration>("/strategies/ai-generate", { description: rules }, 180_000);
      setGen(r);
      setCode(r.code ?? "");
      setName((v) => v || r.name || "");
      setDesc((v) => v || r.description || "");
      toast(r.source === "ai" ? `AI 已生成（${r.model}）` : "AI 没给出可用代码，已回落模板", "info");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { toast("策略名称必填", "error"); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), description: desc.trim(), direction };
      if (tab === "composite") {
        payload.strategy_type = "composite";
        payload.params = { max_output: 100, min_score: 45, composite: parts };
      } else if (tab === "code" || (tab === "ai" && code)) {
        payload.params = { max_output: 100, min_score: gen?.min_score ?? 50, code, engine,
                           ...(tab === "ai" ? { ai: true, rules } : {}) };
      } else {
        payload.params = { max_output: 100, min_score: 50, ai: true, rules, engine };
      }
      await api.post("/strategies", payload, 180_000);
      toast(`已创建「${name}」`, "ok");
      onDone();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 50_000) { toast("文件超过 50KB", "error"); return; }
    const fd = new FormData();
    fd.append("upload", f, f.name);
    setBusy(true);
    try {
      const r = await http.post("/strategies/import", fd, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 180_000,
      });
      toast(`导入成功（${(r.data as { mode: string }).mode}）`, "ok");
      onDone();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const strategyPool = useMemo(
    () => (meta?.strategies ?? []).map((s) => ({ code: s.code, name: s.name })), [meta]);

  return (
    <Panel title="新建策略" subtitle="AI 生成写自然语言，自定义编写要交三段代码，叠加组合至少 2 个子策略"
      right={(
        <>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            导入 .json/.txt/.md
            <input ref={fileRef} type="file" accept=".json,.txt,.md" className="hidden"
              onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
          <Button size="sm" loading={busy} onClick={() => void save()}>保存策略</Button>
        </>
      )}>
      <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("px-3 py-1 text-xs transition",
              tab === t.key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="策略名称">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="比如 主力接力二波" />
        </Field>
        <Field label="一句话描述">
          <input className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="列表卡片上展示" />
        </Field>
        {tab !== "composite" && (
          <Field label="方向">
            <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="long">做多 long</option>
              <option value="short">做空 short</option>
            </select>
          </Field>
        )}
        {tab !== "composite" && (
          <Field label="执行后端">
            <select className={inputClass} value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="polars">polars 表达式</option>
              <option value="matrix">matrix 矩阵原生</option>
            </select>
          </Field>
        )}
      </div>

      <div className="mt-3">
        {tab === "ai" && (
          <div className="space-y-2">
            <Field label="选股逻辑（自然语言，本地 14B 会据此生成代码）">
              <textarea className={cn(inputClass, "min-h-20 resize-y")} value={rules}
                placeholder="例如：选出连续 3 日主力资金净流入且均线多头排列的股票，剔除 ST"
                onChange={(e) => setRules(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={busy} onClick={() => void generate()}>生成代码</Button>
              {gen && (
                <>
                  <Chip tone={gen.source === "ai" ? "violet" : "amber"}>
                    来源 {gen.source === "ai" ? "AI" : "模板回落"}
                  </Chip>
                  {gen.model && <span className="nums text-[11px] text-slate-400">{gen.model} · {Math.round((gen.latencyMs ?? 0) / 100) / 10} 秒</span>}
                  {gen.dryRun && (
                    <Chip tone={gen.dryRun.hits > 0 ? "emerald" : "amber"}>
                      试运行 {gen.dryRun.rows} 只，命中 {gen.dryRun.hits} 只
                    </Chip>
                  )}
                </>
              )}
            </div>
            {!!noteWithoutDryRun(gen?.note) && <p className="text-[11.5px] text-slate-500">{noteWithoutDryRun(gen?.note)}</p>}
            {gen?.fallbackReason && <p className="text-[11.5px] text-amber-600">{gen.fallbackReason}</p>}
          </div>
        )}

        {tab === "composite" && (
          <>
            <p className="mb-2 text-[11.5px] text-slate-500">
              推荐组合：{(meta?.recommendedComposites ?? []).map((c) => c.name).join(" / ") || "加载中…"}
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(meta?.recommendedComposites ?? []).map((c) => (
                <button key={c.name} type="button"
                  title={c.note}
                  onClick={() => { setParts(c.parts.map((p) => ({ ...p, name: strategyPool.find((q) => q.code === p.strategy_code)?.name }))); setName((v) => v || c.name); }}
                  className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-rose-300 hover:bg-rose-50/50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-rose-500/10">
                  {c.name}
                </button>
              ))}
            </div>
            <CompositeEditor pool={strategyPool} parts={parts} onChange={setParts} />
          </>
        )}

        {(tab === "code" || (tab === "ai" && code)) && (
          <Field label={tab === "ai" ? "AI 生成的代码（可手改后再保存）" : "策略代码"}>
            <CodeEditor value={code || TEMPLATE} onChange={setCode}
              problems={gen?.validation?.problems ?? (code ? undefined : ["代码为空"])} />
          </Field>
        )}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        {pool.length ? `当前已有 ${pool.length} 个策略；同名会自动加用户后缀，不会覆盖别人的策略。` : ""}
        不接受 .py 文件上传，导入只吃 .json / .txt / .md（&lt; 50KB）。
      </p>
    </Panel>
  );
}

const TEMPLATE = `META = {
    "name": "my_strategy",
    "display_name": "我的策略",
    "description": "一句话说明选股逻辑",
    "direction": "long",
}

def basic_filter(df):
    """返回布尔列，True 表示进入候选。"""
    return (df["close"] > df["ma20"]) & (df["amount"] > 1e8)

def scoring(df):
    """返回 0~100 的分数列，越高越优先。"""
    return (df["momentum_60d"].clip(-0.3, 0.3) + 0.3) / 0.6 * 100
`;
