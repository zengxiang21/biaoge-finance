import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { StudentUsageResult, StudentUsageRow } from "../lib/types";
import { num, timeAgo } from "../lib/format";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import {
  Button, Chip, DataTable, EmptyState, Field, inputClass, Panel, Skeleton, type Column,
} from "../components/ui";

/** 管理工作台 · 学员管理（拆解文档 3.17.2） */

const ROLE_TONE: Record<string, "violet" | "sky" | "slate"> = {
  admin: "violet", vip: "sky", user: "slate",
};

const STATUS_LABEL: Record<string, string> = { active: "正常", disabled: "停用", closed: "已注销" };

type EditForm = {
  id: number; username: string; displayName: string; email: string; phone: string;
  role: string; status: string; tokenQuota: number; memberPlan: string; memberExpireAt: string;
  remark: string; password: string;
};

type NewForm = {
  username: string; displayName: string; email: string; password: string;
  role: string; tokenQuota: number; memberPlan: string; memberExpireAt: string; remark: string;
};

const EMPTY_NEW: NewForm = {
  username: "", displayName: "", email: "", password: "", role: "user",
  tokenQuota: 0, memberPlan: "", memberExpireAt: "", remark: "",
};

function tok(v: number) {
  return num(v, 0);
}

export default function StudentsPage() {
  const me = useSession((s) => s.user);
  const location = useLocation();
  const [data, setData] = useState<StudentUsageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(7);
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [creating, setCreating] = useState<NewForm>(EMPTY_NEW);
  const [batchAction, setBatchAction] = useState<"set" | "add" | "reduce">("set");
  const [batchQuota, setBatchQuota] = useState(200000);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<StudentUsageResult>("/admin/workbench/student-usage", { days }, 30000));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.username, r.displayName, r.email, r.phone, r.remark]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [rows, query]);

  async function run(fn: () => Promise<unknown>, okText: string, reload = true) {
    setSaving(true);
    try {
      await fn();
      toast(okText, "ok");
      if (reload) await load();
      return true;
    } catch (e) {
      toast(messageOf(e), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveQuota(id: number, quota: number) {
    if (await run(() => api.put("/admin/workbench/student-quota", { userId: id, tokenQuota: quota }),
      "配额已更新")) setEditing((cur) => (cur && cur.id === id ? { ...cur, tokenQuota: quota } : cur));
  }

  async function applyBatch() {
    if (!selected.length) return toast("先勾选要调整的学员", "warn");
    await run(() => api.post("/admin/workbench/student-quota/batch",
      { userIds: selected, action: batchAction, tokenQuota: batchQuota }),
    `已批量调整 ${selected.length} 名学员配额`);
    setSelected([]);
  }

  async function patchStudent(body: Record<string, unknown>, okText: string) {
    if (!editing) return;
    if (await run(() => api.patch(`/admin/students/${editing.id}`, body), okText)) {
      setEditing((cur) => (cur ? { ...cur, ...body, password: "" } as EditForm : cur));
    }
  }

  async function createStudent() {
    if (creating.username.trim().length < 2) return toast("用户名至少 2 个字符", "warn");
    if (creating.password.length < 8) return toast("初始密码至少 8 位", "warn");
    const body = {
      username: creating.username.trim(), password: creating.password,
      displayName: creating.displayName.trim() || creating.username.trim(),
      email: creating.email.trim() || null, role: creating.role,
      tokenQuota: Number(creating.tokenQuota) || 0,
      memberPlan: creating.memberPlan.trim() || null,
      memberExpireAt: creating.memberExpireAt.trim() || null,
      remark: creating.remark.trim() || null,
    };
    if (await run(() => api.post("/admin/students", body), `学员 ${body.username} 已创建`)) {
      setCreating(EMPTY_NEW);
      setShowCreate(false);
    }
  }

  const cols: Column<StudentUsageRow>[] = [
    { key: "pick", label: "", width: "w-8", value: () => 0,
      render: (r) => (
        <input type="checkbox" checked={selected.includes(r.id)} aria-label={`选择 ${r.displayName}`}
          onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((i) => i !== r.id)))}
          className="h-3.5 w-3.5 accent-rose-600" />
      ) },
    { key: "name", label: "学员", value: (r) => r.displayName, sortable: true,
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.displayName}
            <span className="ml-1 text-[11px] font-normal text-slate-400">@{r.username}</span>
          </span>
          <span className="flex items-center gap-1">
            <Chip tone={ROLE_TONE[r.role] ?? "slate"}>{r.roleLabel}</Chip>
            {r.status !== "active" && <Chip tone="amber">{STATUS_LABEL[r.status] ?? r.status}</Chip>}
            {r.memberPlan && <Chip tone="sky">{r.memberPlan}</Chip>}
          </span>
        </span>
      ) },
    { key: "tokenQuota", label: "配额", align: "right", value: (r) => r.tokenQuota, sortable: true,
      render: (r) => <span className="tabular-nums">{r.tokenQuota ? tok(r.tokenQuota) : "不限"}</span> },
    { key: "tokenUsed", label: "已用", align: "right", value: (r) => r.tokenUsed, sortable: true,
      render: (r) => (
        <span className={r.tokenQuota > 0 && r.tokenUsed > r.tokenQuota ? "tabular-nums text-rose-600" : "tabular-nums"}
          title={r.tokenQuota ? `剩余 ${tok(r.tokenRemaining ?? 0)}` : "未设配额"}>
          {tok(r.tokenUsed)}
        </span>
      ) },
    { key: "tokenWindow", label: `近 ${days} 天`, align: "right", value: (r) => r.tokenWindow, sortable: true,
      render: (r) => <span className="tabular-nums">{tok(r.tokenWindow)}</span> },
    { key: "ai", label: "调用(成/败)", align: "right", value: (r) => r.aiCalls,
      render: (r) => (
        <span className="tabular-nums">{r.aiCalls}
          <span className="text-slate-400">（</span>
          <span className="text-emerald-600">{r.aiOk}</span>/<span className={r.aiFailed ? "text-rose-600" : "text-slate-400"}>{r.aiFailed}</span>
          <span className="text-slate-400">）</span>
        </span>
      ) },
    { key: "biz", label: "业务量", value: (r) => r.watchlist,
      render: (r) => (
        <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400"
          title={`自选 ${r.watchlist} · 策略 ${r.strategies} · 持仓账户 ${r.holdings} · 模拟账户 ${r.simAccounts} · 复盘 ${r.reviews}`}>
          自{r.watchlist} 策{r.strategies} 仓{r.holdings} 模{r.simAccounts} 盘{r.reviews}
        </span>
      ) },
    { key: "lastLoginAt", label: "最近登录", value: (r) => r.lastLoginAt ?? "",
      render: (r) => <span title={r.lastLoginAt ?? "从未登录"}>{timeAgo(r.lastLoginAt)}</span> },
    { key: "op", label: "操作", value: () => 0,
      render: (r) => (
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={saving}
            onClick={() => setEditing({
              id: r.id, username: r.username, displayName: r.displayName, email: r.email ?? "",
              phone: r.phone ?? "", role: r.role, status: r.status, tokenQuota: r.tokenQuota,
              memberPlan: r.memberPlan ?? "", memberExpireAt: r.memberExpireAt ?? "",
              remark: r.remark ?? "", password: "",
            })}>
            编辑
          </Button>
          {r.status === "active" ? (
            <Button size="sm" variant="ghost" disabled={saving || r.id === me?.id}
              title={r.id === me?.id ? "不能停用自己" : "停用后该账号无法登录"}
              onClick={() => void run(() => api.patch(`/admin/students/${r.id}`, { status: "disabled" }), `${r.displayName} 已停用`)}>
              停用
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={saving}
              onClick={() => void run(() => api.patch(`/admin/students/${r.id}`, { status: "active" }), `${r.displayName} 已恢复`)}>
              恢复
            </Button>
          )}
        </span>
      ) },
  ];

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-3">
        <Panel title="学员账号与 Token 配额"
          subtitle={`共 ${data?.totals.users ?? 0} 个账号，在册 ${data?.totals.active ?? 0}，超配额 ${data?.totals.overQuota ?? 0}；已发放 ${tok(data?.totals.tokenQuota ?? 0)}，已消耗 ${tok(data?.totals.tokenUsed ?? 0)}`}
          right={
            <span className="flex items-center gap-1.5">
              {([1, 7, 30] as const).map((d) => (
                <Button key={d} size="sm" variant={days === d ? "primary" : "outline"} onClick={() => setDays(d)}>
                  {d === 1 ? "今日" : `近 ${d} 天`}
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? "收起开户" : "新建学员"}
              </Button>
            </span>
          }
          loading={loading}>
          <div className="space-y-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜用户名 / 昵称 / 手机 / 备注"
              className={`${inputClass} w-full sm:w-72`} />
            {filtered.length ? (
              <DataTable columns={cols} rows={filtered} rowKey={(r) => r.id} dense sortInitial={{ key: "tokenUsed", desc: true }} />
            ) : <EmptyState text="没有匹配的学员" hint="换个关键字，或先在上方开户" />}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                已选 <b className="text-slate-800 dark:text-slate-100">{selected.length}</b> 人
              </span>
              <select value={batchAction} onChange={(e) => setBatchAction(e.target.value as typeof batchAction)}
                className={`${inputClass} w-28! shrink-0`}>
                <option value="set">设为</option>
                <option value="add">增加</option>
                <option value="reduce">减少</option>
              </select>
              <input type="number" min={0} step={10000} value={batchQuota}
                onChange={(e) => setBatchQuota(Number(e.target.value))}
                className={`${inputClass} w-36! shrink-0`} aria-label="批量配额数量" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Token</span>
              <Button size="sm" disabled={saving || !selected.length} onClick={() => void applyBatch()}>批量调整</Button>
              <Button size="sm" variant="ghost" disabled={!selected.length} onClick={() => setSelected([])}>
                清空选择
              </Button>
              <Button size="sm" variant="ghost" disabled={!rows.length} onClick={() => setSelected(rows.map((r) => r.id))}>
                全选
              </Button>
              <span className="ml-auto text-[11px] text-slate-400">
                口径：Token = ai_calls 的 prompt+completion 累加；清零请在编辑里把配额设为 0（不限）
              </span>
            </div>
          </div>
        </Panel>

        {editing && (
          <Panel title={`编辑学员 · ${editing.displayName}（@${editing.username}）`}
            subtitle="改资料、换角色、设配额、重置密码；注销后账号不能再登录"
            right={<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>收起</Button>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="昵称"><input className={inputClass} value={editing.displayName}
                onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} /></Field>
              <Field label="手机号"><input className={inputClass} value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label="邮箱"><input className={inputClass} value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="角色">
                <select className={inputClass} value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  <option value="user">普通用户</option><option value="vip">付费会员</option><option value="admin">管理员</option>
                </select>
              </Field>
              <Field label="状态">
                <select className={inputClass} value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="active">正常</option><option value="disabled">停用</option><option value="closed">已注销</option>
                </select>
              </Field>
              <Field label="Token 配额" hint="0 表示不限额">
                <input type="number" min={0} step={10000} className={inputClass} value={editing.tokenQuota}
                  onChange={(e) => setEditing({ ...editing, tokenQuota: Number(e.target.value) })} />
              </Field>
              <Field label="订阅方案"><input className={inputClass} placeholder="月付 / 季付 / 年付"
                value={editing.memberPlan} onChange={(e) => setEditing({ ...editing, memberPlan: e.target.value })} /></Field>
              <Field label="会员到期" hint="留空即不限期">
                <input type="date" className={inputClass} value={editing.memberExpireAt?.slice(0, 10) ?? ""}
                  onChange={(e) => setEditing({ ...editing, memberExpireAt: e.target.value })} />
              </Field>
              <Field label="重置密码" hint="留空表示不改，改完至少 8 位">
                <input type="password" className={inputClass} value={editing.password}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              </Field>
              <Field label="备注"><input className={inputClass} value={editing.remark}
                onChange={(e) => setEditing({ ...editing, remark: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={saving}
                onClick={() => void patchStudent({
                  displayName: editing.displayName, phone: editing.phone, email: editing.email,
                  role: editing.role, status: editing.status, memberPlan: editing.memberPlan,
                  memberExpireAt: editing.memberExpireAt, remark: editing.remark,
                }, "资料已保存")}>保存资料</Button>
              <Button size="sm" variant="outline" disabled={saving}
                onClick={() => void saveQuota(editing.id, Number(editing.tokenQuota) || 0)}>单独存配额</Button>
              {editing.password && (
                <Button size="sm" variant="outline" disabled={saving}
                  onClick={() => void patchStudent({ password: editing.password }, "密码已重置")}>
                  重置密码
                </Button>
              )}
              <Button size="sm" variant="danger" disabled={saving || editing.id === me?.id}
                title={editing.id === me?.id ? "不能注销自己" : "注销后需手动改回正常才能登录"}
                onClick={() => { void run(() => api.del(`/admin/students/${editing.id}`), `${editing.displayName} 已注销`); setEditing(null); }}>
                注销账号
              </Button>
            </div>
          </Panel>
        )}
      </div>

      <div className="space-y-3">
        {showCreate && (
          <Panel title="新建学员" subtitle="初始密码交给对方，登录后自行修改">
            <div className="space-y-2.5">
              <Field label="用户名"><input className={inputClass} value={creating.username}
                onChange={(e) => setCreating({ ...creating, username: e.target.value })} placeholder="登录用的英文/数字" /></Field>
              <Field label="昵称"><input className={inputClass} value={creating.displayName}
                onChange={(e) => setCreating({ ...creating, displayName: e.target.value })} /></Field>
              <Field label="初始密码" hint="至少 8 位"><input type="password" className={inputClass} value={creating.password}
                onChange={(e) => setCreating({ ...creating, password: e.target.value })} /></Field>
              <Field label="角色">
                <select className={inputClass} value={creating.role}
                  onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                  <option value="user">普通用户</option><option value="vip">付费会员</option><option value="admin">管理员</option>
                </select>
              </Field>
              <Field label="Token 配额" hint="0 表示不限额">
                <input type="number" min={0} step={10000} className={inputClass} value={creating.tokenQuota}
                  onChange={(e) => setCreating({ ...creating, tokenQuota: Number(e.target.value) })} />
              </Field>
              <Field label="会员到期" hint="可留空">
                <input type="date" className={inputClass} value={creating.memberExpireAt}
                  onChange={(e) => setCreating({ ...creating, memberExpireAt: e.target.value })} />
              </Field>
              <Field label="邮箱 / 手机号"><input className={inputClass} value={creating.email}
                onChange={(e) => setCreating({ ...creating, email: e.target.value })} placeholder="邮箱（选填）" /></Field>
              <Button size="sm" className="w-full" disabled={saving} onClick={() => void createStudent()}>创建学员</Button>
            </div>
          </Panel>
        )}

        <Panel title="配额发放概览">
          <div className="space-y-2 text-xs">
            <p className="text-slate-500 dark:text-slate-400">
              全平台已发放 <b className="text-slate-800 dark:text-slate-100">{tok(data?.totals.tokenQuota ?? 0)}</b> Token，
              累计消耗 <b className="text-slate-800 dark:text-slate-100">{tok(data?.totals.tokenUsed ?? 0)}</b>，
              今日消耗 <b className="text-slate-800 dark:text-slate-100">{tok(data?.totals.tokenToday ?? 0)}</b>。
            </p>
            {rows.filter((r) => r.tokenQuota > 0).map((r) => {
              const pct = Math.min(100, r.tokenUsedPct ?? 0);
              return (
                <div key={r.id}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate" title={`${r.displayName} @${r.username}`}>{r.displayName}</span>
                    <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                      {tok(r.tokenUsed)} / {tok(r.tokenQuota)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={pct >= 100 ? "h-full bg-rose-500" : pct >= 80 ? "h-full bg-amber-500" : "h-full bg-emerald-500"}
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!rows.some((r) => r.tokenQuota > 0) && (
              <p className="text-[11px] text-slate-400">当前没人设配额，全部按不限额跑。</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
