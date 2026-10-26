import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { FeedbackListResult, FeedbackRow } from "../lib/types";
import { timeAgo } from "../lib/format";
import { toast } from "../store/toast";
import { Button, Chip, EmptyState, Field, inputClass, Panel, Skeleton } from "../components/ui";

/** 管理工作台 · 反馈管理（拆解文档 3.17.3） */

const STATUS_LABEL: Record<string, string> = { open: "待回复", replied: "已回复", closed: "已归档" };
const STATUS_TONE: Record<string, "amber" | "emerald" | "slate"> = {
  open: "amber", replied: "emerald", closed: "slate",
};
const TABS = ["", "open", "replied", "closed"] as const;
const TAB_LABEL: Record<string, string> = { "": "全部", open: "待回复", replied: "已回复", closed: "已归档" };

export default function FeedbacksPage() {
  const [data, setData] = useState<FeedbackListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("");
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<FeedbackRow | null>(null);
  const [reply, setReply] = useState("");
  const [closeAfterReply, setCloseAfterReply] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<FeedbackListResult>("/admin/feedbacks", { status: tab, keyword, limit: 100 });
      setData(d);
      setActive((cur) => (cur ? (d.rows.find((r) => r.id === cur.id) ?? cur) : cur));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setLoading(false);
    }
  }, [tab, keyword]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setSaving(true);
    try {
      await fn();
      toast(okText, "ok");
      await load();
      return true;
    } catch (e) {
      toast(messageOf(e), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendReply() {
    if (!active) return;
    if (reply.trim().length < 2) return toast("回复内容太短了", "warn");
    const ok = await run(() => api.post(`/admin/feedbacks/${active.id}/reply`,
      { reply: reply.trim(), status: closeAfterReply ? "closed" : "replied" }),
    closeAfterReply ? "已回复并归档，站内信已送达" : "已回复，站内信已送达");
    if (ok) setReply("");
  }

  const rows = data?.rows ?? [];

  if (loading && !data) {
    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Skeleton className="h-96 w-full" /><Skeleton className="h-60 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="用户反馈与在线留言"
        subtitle={`待回复 ${data?.counts.open ?? 0} · 已回复 ${data?.counts.replied ?? 0} · 已归档 ${data?.counts.closed ?? 0}，共 ${data?.counts.total ?? 0} 条`}
        right={<Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>刷新</Button>}
        loading={loading}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TABS.map((t) => (
              <Button key={t || "all"} size="sm" variant={tab === t ? "primary" : "outline"} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
                {t && data ? `（${data.counts[t as "open" | "replied" | "closed"]}）` : ""}
              </Button>
            ))}
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜标题 / 内容 / 昵称" className={`${inputClass} ml-auto w-full sm:w-56`} />
          </div>

          {rows.length ? (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => { setActive(r); setReply(r.reply ?? ""); }}
                    className={
                      active?.id === r.id
                        ? "w-full rounded-lg border border-rose-300 bg-rose-50/60 p-3 text-left dark:border-rose-500/40 dark:bg-rose-500/10"
                        : "w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    }>
                    <span className="flex flex-wrap items-center gap-2">
                      <Chip tone={STATUS_TONE[r.status] ?? "slate"}>{STATUS_LABEL[r.status] ?? r.status}</Chip>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={r.title}>{r.title}</span>
                      <span className="shrink-0 text-[11px] text-slate-400" title={r.createdAt ?? ""}>
                        {timeAgo(r.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">
                      {r.content.length > 120 ? `${r.content.slice(0, 120)}…` : r.content}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>{r.username || "匿名"}</span>
                      {r.contact && <span title={r.contact}>联系：{r.contact}</span>}
                      {r.repliedAt && <span>回复于 {timeAgo(r.repliedAt)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState text="这个状态下没有留言" hint="切换到「全部」看看，或让用户在个人中心提交反馈" />}
        </div>
      </Panel>

      <div className="space-y-3">
        {active ? (
          <Panel title={`留言 #${active.id}`} subtitle={`${active.username || "匿名"} · ${active.createdAt ?? ""}`}
            right={<Button size="sm" variant="ghost" onClick={() => { setActive(null); setReply(""); }}>关闭</Button>}>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{active.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {active.content}
                </p>
                {active.contact && (
                  <p className="mt-1 text-[11px] text-slate-400">联系方式：{active.contact}</p>
                )}
              </div>
              {active.reply && (
                <div className="rounded-lg bg-emerald-50 p-2.5 text-xs leading-5 dark:bg-emerald-500/10">
                  <p className="mb-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                    上次回复 · {active.repliedAt ?? ""}
                  </p>
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{active.reply}</p>
                </div>
              )}
              <Field label="客服回复" hint="保存后会自动给对方发一条站内信">
                <textarea rows={4} className={`${inputClass} w-full resize-y`} value={reply}
                  onChange={(e) => setReply(e.target.value)} placeholder="说清楚结论和下一步" />
              </Field>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={closeAfterReply} onChange={(e) => setCloseAfterReply(e.target.checked)}
                  className="h-3.5 w-3.5 accent-rose-600" />
                回复完直接归档
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={saving} onClick={() => void sendReply()}>发送回复</Button>
                {active.status !== "closed" ? (
                  <Button size="sm" variant="outline" disabled={saving}
                    onClick={() => void run(() => api.patch(`/admin/feedbacks/${active.id}`, { status: "closed" }), "已归档")}>
                    只归档
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={saving}
                    onClick={() => void run(() => api.patch(`/admin/feedbacks/${active.id}`, { status: "open" }), "已重新打开")}>
                    重新打开
                  </Button>
                )}
                <Button size="sm" variant="danger" disabled={saving}
                  onClick={() => {
                    if (!window.confirm(`删除留言 #${active.id}？删掉就找不回来了。`)) return;
                    void run(() => api.del(`/admin/feedbacks/${active.id}`), "留言已删除").then((ok) => {
                      if (ok) setActive(null);
                    });
                  }}>
                  删除
                </Button>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel title="处理说明" subtitle="左边挑一条留言就能在这里回复">
            <div className="space-y-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              <p>· 用户在「个人中心 → 意见反馈」提交，落库即进这个列表。</p>
              <p>· 回复会同步写一条站内信，用户在持仓提醒页能看到；邮件渠道需在每日复盘里配好 SMTP。</p>
              <p>· 状态只有三档：待回复 / 已回复 / 已归档，列表默认把待回复顶在最前。</p>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
