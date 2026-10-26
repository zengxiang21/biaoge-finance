import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, messageOf, TOKEN_KEY } from "../lib/api";
import type { FeedbackRow, PublicSettings } from "../lib/types";
import { Button, Chip, DataTable, EmptyState, Field, inputClass, Panel, Skeleton, cn } from "../components/ui";
import { useSession } from "../store/session";
import { useTheme, THEME_KEY } from "../store/theme";
import { toast } from "../store/toast";
import { num, timeAgo } from "../lib/format";

type AllPerms = { all: string[]; roles: Record<string, string[]>; stored: { role: string; code: string }[] };
type AuditRow = { id: number; user_id: number | null; action: string; target: string | null; created_at: string };

const FEEDBACK_TONE: Record<string, "amber" | "emerald" | "slate"> = {
  open: "amber", replied: "emerald", closed: "slate",
};
const FEEDBACK_LABEL: Record<string, string> = { open: "待回复", replied: "已回复", closed: "已归档" };

export default function ProfilePage() {
  const { user, permissions, hasPerm } = useSession();
  const logout = useSession((s) => s.logout);
  const toggleTheme = useTheme((s) => s.toggle);
  const theme = useTheme((s) => s.theme);
  const [all, setAll] = useState<AllPerms | null>(null);
  const [logs, setLogs] = useState<AuditRow[] | null>(null);
  const [storage, setStorage] = useState<Record<string, number>>({});
  const [feedbacks, setFeedbacks] = useState<FeedbackRow[] | null>(null);
  const [pub, setPub] = useState<PublicSettings | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "", contact: "" });
  const [sending, setSending] = useState(false);

  const loadStorage = useCallback(() => {
    const out: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith("tsp-saas.")) out[k] = (localStorage.getItem(k) ?? "").length;
    }
    setStorage(out);
  }, []);

  const loadFeedback = useCallback(() => {
    api.get<{ rows: FeedbackRow[] }>("/feedbacks/my", undefined, 15000)
      .then((r) => setFeedbacks(r.rows)).catch(() => setFeedbacks([]));
  }, []);

  useEffect(() => {
    loadStorage();
    loadFeedback();
    api.get<PublicSettings>("/settings/public", undefined, 10000).then(setPub).catch(() => setPub(null));
    if (hasPerm("menu:system:permission")) {
      api.get<AllPerms>("/system/permissions").then(setAll).catch((e) => toast(messageOf(e), "error"));
    }
    if (hasPerm("menu:system:audit")) {
      api.get<{ rows: AuditRow[] }>("/system/audit-logs", { limit: 30 })
        .then((r) => setLogs(r.rows)).catch((e) => toast(messageOf(e), "error"));
    }
  }, [hasPerm, loadStorage, loadFeedback]);

  const granted = useMemo(() => new Set(permissions), [permissions]);
  const menuCodes = permissions.filter((p) => p.startsWith("menu:"));
  const opCodes = permissions.filter((p) => !p.startsWith("menu:"));

  async function submitFeedback() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (title.length < 2) { toast("标题至少写 2 个字", "warn"); return; }
    if (content.length < 4) { toast("正文至少写 4 个字，方便管理员定位", "warn"); return; }
    setSending(true);
    try {
      await api.post("/feedbacks", { title, content, contact: draft.contact.trim() || null });
      setDraft({ title: "", content: "", contact: "" });
      toast("已提交，回复后会在这里显示", "ok");
      loadFeedback();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSending(false);
    }
  }

  if (!user) return <EmptyState text="没有取到账号信息，请重新登录" />;

  return (
    <div className="space-y-4">
      <Panel title="账号信息" subtitle="登录凭证走 JWT，访问令牌 12 小时、刷新令牌 14 天"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={toggleTheme}>切换{theme === "dark" ? "浅色" : "深色"}</Button>
            <Button size="sm" variant="danger" onClick={() => void logout()}>退出登录</Button>
          </div>
        }>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Info k="用户名" v={user.username} />
          <Info k="显示名" v={user.displayName} />
          <Info k="角色" v={<Chip tone={user.role === "admin" ? "rose" : user.role === "vip" ? "violet" : "slate"}>{user.roleLabel}</Chip>} />
          <Info k="状态" v={<Chip tone={user.status === "active" ? "emerald" : "amber"}>{user.status === "active" ? "正常" : user.status}</Chip>} />
          <Info k="注册时间" v={user.createdAt} />
          <Info k="上次登录" v={`${user.lastLoginAt ?? "—"}（${timeAgo(user.lastLoginAt)}）`} />
          <Info k="会员到期" v={user.memberExpireAt ?? "未设置（本轮未启用配额体系）"} />
          <Info k="权限条数" v={`${permissions.length} 条（菜单 ${menuCodes.length} / 操作 ${opCodes.length}）`} />
          <Info k="用户 ID" v={String(user.id)} />
        </div>
      </Panel>

      <Panel title="订阅方案" subtitle={pub ? (pub.marketing.note || "价格由管理员在通用设置里维护") : "读取中"}>
        {!pub || !pub.marketing.plans.length ? (
          <Skeleton className="h-28" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pub.marketing.plans.map((p) => (
              <div key={p.key}
                className={cn("rounded-xl border p-3",
                  p.recommended
                    ? "border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10"
                    : "border-slate-200 dark:border-slate-700")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{p.label}</span>
                  {p.recommended && <Chip tone="rose">推荐</Chip>}
                </div>
                <p className="nums mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">
                  ¥{num(p.price, 0)}
                  <span className="ml-1 text-xs font-normal text-slate-500">/ {p.period || "期"}</span>
                </p>
                <p className="text-[11px] text-slate-500">有效期 {p.days} 天</p>
                <ul className="mt-2 space-y-0.5">
                  {p.features.map((f) => (
                    <li key={f} className="text-[11px] text-slate-600 dark:text-slate-300">· {f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {pub && (pub.marketing.contact.wechat || pub.marketing.contact.email) && (
          <p className="mt-3 text-[11px] text-slate-500">
            开通方式：
            {pub.marketing.contact.wechat && <span className="ml-1">微信 {pub.marketing.contact.wechat}</span>}
            {pub.marketing.contact.email && <span className="ml-1">/ 邮箱 {pub.marketing.contact.email}</span>}
            {pub.marketing.contact.note && <span className="ml-1">（{pub.marketing.contact.note}）</span>}
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="我的权限" subtitle="三层守卫：路由级 / 菜单级 / 操作级（文档 3.1.3）">
          {all ? (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500">
                系统共 {all.all.length} 条权限码，当前账号有 {permissions.length} 条；灰色为本角色没有的
              </p>
              <div className="flex flex-wrap gap-1.5">
                {all.all.map((code) => (
                  <span key={code} className={cn("nums rounded-md px-1.5 py-0.5 text-[11px]",
                    granted.has(code)
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500")}>
                    {code}
                  </span>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800">
                角色授权：
                {Object.entries(all.roles).map(([role, codes]) => (
                  <p key={role} className="mt-1">
                    <Chip tone="slate">{role}</Chip> {codes.length} 条
                    <span className="ml-2 text-slate-400">（数据库另存 {all.stored.filter((s) => s.role === role).length} 条人工授权）</span>
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {permissions.map((code) => (
                <span key={code} className="nums rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {code}
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="本地存储" subtitle={`localStorage 里 ${Object.keys(storage).length} 个 tsp-saas.* 键（文档第六章）`}>
          <DataTable
            dense
            maxHeight="max-h-64"
            rows={Object.entries(storage).map(([key, size]) => ({ key, size }))}
            rowKey={(r) => r.key}
            empty="还没有写入本地缓存"
            columns={[
              { key: "key", label: "Key", render: (r) => <span className="nums text-xs">{r.key}</span> },
              { key: "size", label: "占用字符", align: "right", value: (r) => r.size,
                render: (r) => <span className="nums text-slate-500">{r.size.toLocaleString("zh-CN")}</span> },
              { key: "desc", label: "说明", render: (r) => <span className="text-[11px] text-slate-500">{describeKey(r.key)}</span> },
            ]}
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={loadStorage}>重新统计</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              for (const k of Object.keys(localStorage)) {
                if (k.startsWith("tsp-saas.") && k !== TOKEN_KEY && k !== THEME_KEY) localStorage.removeItem(k);
              }
              loadStorage();
              toast("已清掉缓存键（登录态和主题保留）", "ok");
            }}>清理缓存</Button>
          </div>
        </Panel>
      </div>

      <Panel title="意见反馈" subtitle="bug、数据源问题、想加的功能都可以写这里；回复后会在消息通知里出现">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            <Field label="标题" hint="一句话说明问题，2-80 字">
              <input className={`${inputClass} w-full`} maxLength={80} value={draft.title}
                placeholder="比如：涨停梯队缺少连板天数"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="详细描述" hint="越具体越好，4-2000 字">
              <textarea rows={5} className={`${inputClass} w-full resize-y`} maxLength={2000} value={draft.content}
                placeholder="哪个页面、什么操作、看到了什么、期望是什么"
                onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            </Field>
            <Field label="联系方式" hint="可留空，留了管理员能私聊你">
              <input className={`${inputClass} w-full`} maxLength={60} value={draft.contact}
                placeholder="微信 / 邮箱" onChange={(e) => setDraft({ ...draft, contact: e.target.value })} />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" loading={sending} onClick={() => void submitFeedback()}>提交反馈</Button>
              <Button size="sm" variant="ghost" onClick={loadFeedback}>刷新列表</Button>
              <span className="text-[11px] text-slate-400">{draft.content.length}/2000</span>
            </div>
          </div>
          {!feedbacks ? (
            <Skeleton className="h-40" />
          ) : feedbacks.length === 0 ? (
            <EmptyState text="还没有提过意见" hint="左侧写一条，管理员在「反馈管理」里处理后这里会更新" />
          ) : (
            <DataTable
              dense
              maxHeight="max-h-80"
              rows={feedbacks}
              rowKey={(r) => r.id}
              columns={[
                { key: "title", label: "标题", render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium" title={r.title}>{r.title}</p>
                    <p className="truncate text-[11px] text-slate-400" title={r.content}>{r.content}</p>
                  </div>
                ) },
                { key: "status", label: "状态", align: "center", render: (r) => (
                  <Chip tone={FEEDBACK_TONE[r.status] ?? "slate"}>{FEEDBACK_LABEL[r.status] ?? r.status}</Chip>
                ) },
                { key: "reply", label: "回复", render: (r) => (
                  <span className="block truncate text-[11px] text-slate-500" title={r.reply ?? ""}>
                    {r.reply ?? "—"}
                  </span>
                ) },
                { key: "createdAt", label: "时间", align: "right", render: (r) => (
                  <span className="nums text-[11px] text-slate-400">{timeAgo(r.createdAt)}</span>
                ) },
              ]}
            />
          )}
        </div>
      </Panel>

      <Panel title="我的操作日志"
        subtitle={hasPerm("menu:system:audit") ? "登录、建快照、改配置都会记一笔" : undefined}>
        {!hasPerm("menu:system:audit") ? (
          <EmptyState text="审计日志只有管理员能看" hint="当前账号没有 menu:system:audit 权限" />
        ) : !logs ? (
          <Skeleton className="h-40" />
        ) : (
          <DataTable
            dense
            maxHeight="max-h-80"
            rows={logs}
            rowKey={(r) => r.id}
            empty="还没有操作记录"
            columns={[
              { key: "created_at", label: "时间", render: (r) => <span className="nums text-xs">{r.created_at}</span> },
              { key: "user_id", label: "用户", align: "right", value: (r) => r.user_id,
                render: (r) => <span className="nums text-slate-500">#{r.user_id ?? "—"}</span> },
              { key: "action", label: "动作", render: (r) => <span className="nums text-xs">{r.action}</span> },
              { key: "target", label: "对象", render: (r) => <span className="text-xs text-slate-500">{r.target ?? "—"}</span> },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

function Info({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{k}</p>
      <p className="mt-0.5 break-all text-sm font-medium text-slate-800 dark:text-slate-100">{v}</p>
    </div>
  );
}

function describeKey(key: string): string {
  if (key.includes("auth.tokens")) return "登录令牌（access/refresh）";
  if (key.includes("ui.theme")) return "深浅色偏好";
  if (key.includes("dashboard.overview")) return "仪表盘离线缓存";
  if (key.includes("stock-analysis.recent")) return "最近搜索的股票（最多 10 条）";
  if (key.includes("nav.")) return "侧边栏折叠状态";
  if (key.includes("router.") || key.includes("route.")) return "路由状态缓存";
  return "其他";
}
