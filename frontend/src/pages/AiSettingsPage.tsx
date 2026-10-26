import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { AiConfig } from "../lib/types";
import {
  Button, Chip, DataTable, EmptyState, Field, Panel, Skeleton, cn, inputClass,
} from "../components/ui";
import { toast } from "../store/toast";
import { useSession } from "../store/session";

type GetResp = {
  config: AiConfig;
  reachable: boolean;
  models: string[];
  error?: string | null;
  usage: Usage;
};
type Usage = {
  calls: number; promptTokens: number; completionTokens: number;
  avgLatencyMs: number; ok: number; window_days: number;
};
type CallRow = {
  id: number; purpose: string; model: string; engine: string | null;
  prompt_tokens: number; completion_tokens: number; latency_ms: number;
  status: string; note: string | null; created_at: string;
};

export default function AiSettingsPage() {
  const [data, setData] = useState<GetResp | null>(null);
  const [form, setForm] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("用一句话说明沪深300指数是什么");
  const [testResult, setTestResult] = useState<{ answer: string; model: string; latencyMs: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const hasPerm = useSession((s) => s.hasPerm);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const r = await api.get<GetResp>("/settings/ai");
      setData(r);
      setForm(r.config);
      const u = await api.get<{ stat: Usage; recent: CallRow[] }>("/ai/usage");
      setCalls(u.recent);
      setData((old) => (old ? { ...old, usage: u.stat } : old));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data || !form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const save = async () => {
    setBusy("save");
    try {
      const body: Record<string, unknown> = {
        provider: form.provider, base_url: form.base_url, model: form.model,
        temperature: form.temperature, max_tokens: form.max_tokens,
        timeout_s: form.timeout_s, keep_alive: form.keep_alive, enabled: form.enabled,
      };
      if (apiKey.trim()) body.apiKeyPlain = apiKey.trim();
      const r = await api.put<{ config: AiConfig }>("/settings/ai", body);
      setForm(r.config);
      setData((old) => (old ? { ...old, config: r.config } : old));
      setApiKey("");
      toast("AI 引擎配置已保存", "ok");
      void reloadCheck();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const reloadCheck = async () => {
    try {
      const m = await api.get<{ ok: boolean; models: string[]; error?: string }>("/settings/ai/models");
      setData((old) => (old ? { ...old, reachable: m.ok, models: m.models, error: m.error ?? null } : old));
    } catch {
      /* 检查失败不影响保存结果 */
    }
  };

  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await api.post<{ answer: string; model: string; latencyMs: number }>(
        `/settings/ai/test?prompt=${encodeURIComponent(prompt)}`);
      setTestResult(r);
      toast(`调用成功，${r.latencyMs.toFixed(0)}ms`, "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const editable = hasPerm("settings:ai:update");

  return (
    <div className="space-y-4">
      <Panel title="AI 引擎" subtitle="本轮接本机 Ollama，14B 模型跑完就卸载以免抢内存"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" loading={busy === "load"} onClick={() => void load()}>重新检查</Button>
            {editable && <Button size="sm" onClick={save} loading={busy === "save"}>保存配置</Button>}
          </div>
        }>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="连通性" value={data.reachable ? "可用" : "连不上"}
            tone={data.reachable ? "ok" : "error"} hint={data.error ?? undefined} />
          <Tile label="引擎 / 模型" value={`${form.provider} · ${form.model}`} />
          <Tile label={`近 ${data.usage.window_days} 天调用`} value={`${data.usage.calls} 次`}
            hint={`成功 ${data.usage.ok} 次，平均 ${data.usage.avgLatencyMs.toFixed(0)}ms`} />
          <Tile label="Token 用量" value={`${(data.usage.promptTokens + data.usage.completionTokens).toLocaleString("zh-CN")}`}
            hint={`输入 ${data.usage.promptTokens} / 输出 ${data.usage.completionTokens}`} />
        </div>
        {!data.reachable && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            连不上 {form.base_url}。先启动 Ollama（<span className="nums">ollama serve</span>），
            再确认模型已拉取（<span className="nums">ollama pull {form.model}</span>）。
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="配置" subtitle="API Key 只写不读，界面只显示指纹">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="引擎类型">
              <select className={inputClass} value={form.provider} disabled={!editable}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                <option value="ollama">Ollama（原生 /api/chat）</option>
                <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
              </select>
            </Field>
            <Field label="Base URL">
              <input className={cn(inputClass, "nums")} value={form.base_url} disabled={!editable}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </Field>
            <Field label="模型" hint={form.provider === "ollama" ? "下拉来自 /api/tags，也可以手输" : "下拉来自 /models"}>
              {data.models.length ? (
                <select className={cn(inputClass, "nums")} value={form.model} disabled={!editable}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  {[form.model, ...data.models.filter((m) => m !== form.model)].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input className={cn(inputClass, "nums")} value={form.model} disabled={!editable}
                  onChange={(e) => setForm({ ...form, model: e.target.value })} />
              )}
            </Field>
            <Field label="API Key"
              hint={form.apiKeyFingerprint ? `当前已保存 ${form.apiKeyFingerprint}，留空则不改` : "本机 Ollama 不需要 Key"}>
              <input className={inputClass} type="password" value={apiKey} disabled={!editable}
                placeholder={form.provider === "ollama" ? "可留空" : "sk-…"}
                onChange={(e) => setApiKey(e.target.value)} />
            </Field>
            <Field label="temperature">
              <input className={cn(inputClass, "nums")} type="number" step="0.1" min="0" max="1"
                value={form.temperature} disabled={!editable}
                onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
            </Field>
            <Field label="max_tokens（输出上限）">
              <input className={cn(inputClass, "nums")} type="number" min="128" max="8192" step="128"
                value={form.max_tokens} disabled={!editable}
                onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
            </Field>
            <Field label="超时（秒）" hint="14B 冷启动第一次会慢">
              <input className={cn(inputClass, "nums")} type="number" min="10" max="600"
                value={form.timeout_s} disabled={!editable}
                onChange={(e) => setForm({ ...form, timeout_s: Number(e.target.value) })} />
            </Field>
            <Field label="keep_alive" hint="填 30s：调用完 30 秒后卸载模型，16G 内存更稳">
              <input className={cn(inputClass, "nums")} value={form.keep_alive} disabled={!editable}
                onChange={(e) => setForm({ ...form, keep_alive: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={!!form.enabled} disabled={!editable}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            启用 AI 引擎（关掉后所有分析接口直接报错，不会偷偷换源）
          </label>
        </Panel>

        <Panel title="连通性测试" subtitle="走的就是分析接口同一条链路，含超时与 Token 统计">
          <Field label="提示词">
            <textarea className={cn(inputClass, "min-h-24 resize-y")} value={prompt} maxLength={500}
              onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={test} loading={busy === "test"}
              disabled={!hasPerm("settings:ai:test")}>发一次试试</Button>
            {!hasPerm("settings:ai:test") && <span className="text-[11px] text-slate-400">需要 settings:ai:test 权限</span>}
          </div>
          {testResult && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                <Chip tone="emerald">成功</Chip>
                <span className="nums">{testResult.model}</span>
                <span className="nums ml-auto">{testResult.latencyMs.toFixed(0)} ms</span>
              </div>
              <p className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-200">{testResult.answer}</p>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            个股研报（/ai/analyze）与目标价推演接口已接通同一配置，正式的「股票分析」页在 P1 阶段做
          </p>
        </Panel>
      </div>

      <Panel title="调用记录" subtitle="最近 20 次，含失败；每次调用的 Token 和延迟都落库">
        {calls.length === 0 ? (
          <EmptyState text="还没有调用记录" hint="点上面的「发一次试试」就会产生一条" />
        ) : (
          <DataTable
            dense
            maxHeight="max-h-72"
            rows={calls}
            rowKey={(r) => r.id}
            columns={[
              { key: "created_at", label: "时间", render: (r) => <span className="nums text-[11px]">{r.created_at}</span> },
              { key: "purpose", label: "用途", render: (r) => <span className="text-xs">{r.purpose}</span> },
              { key: "model", label: "模型", render: (r) => <span className="nums text-[11px] text-slate-500">{r.model}</span> },
              { key: "tokens", label: "输入/输出", align: "right",
                render: (r) => <span className="nums text-xs">{r.prompt_tokens} / {r.completion_tokens}</span> },
              { key: "latency_ms", label: "延迟", align: "right", value: (r) => r.latency_ms,
                render: (r) => <span className="nums text-xs">{r.latency_ms.toFixed(0)}ms</span> },
              { key: "status", label: "状态", align: "right", render: (r) => (
                <Chip tone={r.status === "ok" ? "emerald" : "rose"}>{r.status === "ok" ? "成功" : "失败"}</Chip>) },
              { key: "note", label: "备注", render: (r) => (
                <span className="block max-w-[16rem] truncate text-[11px] text-slate-400" title={r.note ?? ""}>
                  {r.note || "—"}
                </span>) },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: "ok" | "error"; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums break-all text-sm font-semibold",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
          : tone === "error" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-200")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 break-all text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}
