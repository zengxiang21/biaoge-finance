import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { AnomalyRule, AnomalyRulesResult, AnomalyType } from "../lib/types";
import {
  Button, Chip, DataTable, Field, Panel, Skeleton, cn, inputClass, type Column,
} from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

export default function AnomalyRulesPage() {
  const { hasPerm } = useSession();
  const [data, setData] = useState<AnomalyRulesResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AnomalyRule | null>(null);
  const [draft, setDraft] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<AnomalyRulesResult>("/anomaly/rules", {}, 30_000));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startCreate = (types: AnomalyType[]) => {
    const t = types[0];
    setEditing(null);
    setDraft({
      name: t.label, event_type: t.key, scope: "all", cooldown_min: 30, enabled: true,
      params: Object.fromEntries(t.params.map((p) => [p.key, p.default])),
    });
  };

  const startEdit = (r: AnomalyRule) => {
    setEditing(r);
    setDraft({
      name: r.name, event_type: r.event_type, scope: r.scope, cooldown_min: r.cooldown_min,
      enabled: !!r.enabled, params: { ...r.params },
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/anomaly/rules/${editing.id}`, draft, 30_000);
        toast("规则已更新", "ok");
      } else {
        await api.post("/anomaly/rules", draft, 30_000);
        toast("规则已创建", "ok");
      }
      setDraft(null);
      setEditing(null);
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: AnomalyRule) => {
    try {
      await api.patch(`/anomaly/rules/${r.id}`, { enabled: !r.enabled }, 30_000);
      toast(r.enabled ? `已停用「${r.name}」` : `已启用「${r.name}」`, "ok");
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const remove = async (r: AnomalyRule) => {
    if (!window.confirm(`删除规则「${r.name}」？已生成的异动事件会保留。`)) return;
    try {
      await api.del(`/anomaly/rules/${r.id}`);
      toast("规则已删除", "ok");
      if (editing?.id === r.id) { setDraft(null); setEditing(null); }
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const types = data?.meta?.types ?? [];
  const scopes = data?.meta?.scopes ?? [];
  const readOnly = !hasPerm("anomaly:view");

  const cols: Column<AnomalyRule>[] = [
    { key: "name", label: "规则名称", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-nowrap text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
        {r.isSystem && <span className="ml-1.5 text-[10px] text-slate-400">内置</span>}
      </div>) },
    { key: "type", label: "异动类型", width: "w-28", value: (r) => r.eventTypeLabel,
      render: (r) => <Chip tone="sky">{r.eventTypeLabel}</Chip> },
    { key: "scope", label: "监控范围", width: "w-24", value: (r) => r.scopeLabel,
      render: (r) => <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.scopeLabel}</span> },
    { key: "params", label: "触发阈值", value: (r) => JSON.stringify(r.params), render: (r) => (
      <span className="nums whitespace-nowrap text-[11px] text-slate-600 dark:text-slate-300"
        title={paramHint(r, types)}>
        {paramText(r, types)}
      </span>) },
    { key: "cooldown", label: "冷却", align: "right", width: "w-20", value: (r) => r.cooldown_min,
      render: (r) => <span className="nums text-xs text-slate-600 dark:text-slate-300">{r.cooldown_min} 分</span> },
    { key: "created", label: "创建时间", width: "w-28", value: (r) => r.created_at, render: (r) => (
      <span className="nums whitespace-nowrap text-[11px] text-slate-400">{r.created_at}</span>) },
    { key: "status", label: "状态", align: "center", width: "w-16", value: (r) => (r.enabled ? "启用" : "停用"),
      render: (r) => <Chip tone={r.enabled ? "emerald" : "slate"}>{r.enabled ? "启用" : "停用"}</Chip> },
    { key: "ops", label: "操作", align: "right", width: "w-32", render: (r) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => void toggle(r)}>
          {r.enabled ? "停用" : "启用"}
        </Button>
        <Button size="sm" variant="outline" disabled={readOnly} onClick={() => startEdit(r)}>编辑</Button>
        <Button size="sm" variant="danger" disabled={readOnly}
          title={r.isSystem ? "内置规则只有管理员能删" : "删除该规则"}
          onClick={() => void remove(r)}>删</Button>
      </div>) },
  ];

  const currentType = types.find((t) => t.key === draft?.event_type);

  return (
    <div className="space-y-4">
      <Panel
        title="异动规则"
        subtitle={data
          ? `${data.rows.length} 条规则（启用 ${data.rows.filter((r) => r.enabled).length} 条）· 内置规则覆盖 7 类异动，可自行加阈值更严或只盯创业板的规则`
          : "正在读取规则…"}
        right={(
          <>
            <Link to="/anomaly"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              实时异动
            </Link>
            <Button size="sm" variant="outline" onClick={() => startCreate(types)}>新建规则</Button>
          </>
        )}
      >
        {draft && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 lg:grid-cols-4">
            <Field label="规则名称">
              <input className={inputClass} value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="异动类型" hint={editing ? "编辑时不改类型" : currentType?.desc}>
              <select className={inputClass} value={draft.event_type} disabled={!!editing}
                onChange={(e) => {
                  const t = types.find((x) => x.key === e.target.value)!;
                  setDraft({ ...draft, event_type: t.key,
                    params: Object.fromEntries(t.params.map((p) => [p.key, p.default])) });
                }}>
                {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="监控范围">
              <select className={inputClass} value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
                {scopes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="冷却时间（分钟）" hint="同一只票同类异动在冷却期内只记一次">
              <input className={inputClass} type="number" min={1} max={480} value={draft.cooldown_min}
                onChange={(e) => setDraft({ ...draft, cooldown_min: Number(e.target.value) })} />
            </Field>
            {currentType?.params.map((p) => (
              <Field key={p.key} label={p.label} hint={`默认 ${p.default}`}>
                <input className={cn(inputClass, "nums")} type="number" step="0.1"
                  value={draft.params[p.key] ?? p.default}
                  onChange={(e) => setDraft({ ...draft, params: { ...draft.params, [p.key]: Number(e.target.value) } })} />
              </Field>
            ))}
            <div className="flex items-end justify-end gap-2 lg:col-span-4">
              <label className="mr-auto flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                创建后立即启用
              </label>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setEditing(null); }}>取消</Button>
              <Button size="sm" loading={saving} onClick={() => void save()}>{editing ? "保存修改" : "创建规则"}</Button>
            </div>
          </div>
        )}

        {busy && !data ? <Skeleton className="h-64 w-full" /> : (
          <DataTable columns={cols} rows={data?.rows ?? []} rowKey={(r) => r.id} dense maxHeight="480px"
            empty="没有异动规则" sortInitial={{ key: "type", desc: false }} />
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          阈值单位：涨幅为百分比，成交额与净额为万元；规则改动下一轮扫描（默认 30 秒）即生效。
        </p>
      </Panel>
    </div>
  );
}

type FormState = {
  name: string;
  event_type: string;
  scope: string;
  cooldown_min: number;
  enabled: boolean;
  params: Record<string, number>;
};

function paramText(r: AnomalyRule, types: AnomalyType[]): string {
  const spec = types.find((t) => t.key === r.event_type);
  return (spec?.params ?? [])
    .filter((p) => r.params[p.key] !== undefined)
    .map((p) => `${p.label} ${r.params[p.key]}`)
    .join(" / ");
}

function paramHint(r: AnomalyRule, types: AnomalyType[]): string {
  return types.find((t) => t.key === r.event_type)?.desc ?? "";
}
