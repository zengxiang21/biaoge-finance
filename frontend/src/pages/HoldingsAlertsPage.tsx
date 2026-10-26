import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { HoldingNotification, HoldingTrigger, HoldingsScanResult } from "../lib/types";
import {
  Button, Chip, DataTable, EmptyState, Panel, Skeleton, cn, type Column,
} from "../components/ui";
import { toast } from "../store/toast";

type ScanOut = HoldingsScanResult & { scanned?: string };

const CHANNEL_LABEL: Record<string, string> = { inapp: "站内", email: "邮件" };
const STATUS_TONE: Record<string, "emerald" | "amber" | "rose" | "slate"> = {
  success: "emerald", no_channel: "amber", failed: "rose", cooldown: "slate", noise: "slate",
};
const STATUS_LABEL: Record<string, string> = {
  success: "已送达", no_channel: "无渠道", failed: "发送失败",
};

export default function HoldingsAlertsPage() {
  const [triggers, setTriggers] = useState<HoldingTrigger[]>([]);
  const [notes, setNotes] = useState<HoldingNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [suppressed, setSuppressed] = useState(0);
  const [busy, setBusy] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string>("");

  const load = useCallback(async () => {
    const [t, n] = await Promise.all([
      api.get<{ rows: HoldingTrigger[]; total: number; suppressed: number }>("/holdings/triggers", { limit: 200 }, 30_000),
      api.get<{ rows: HoldingNotification[]; total: number; unread: number }>("/holdings/notifications", { limit: 200 }, 30_000),
    ]);
    setTriggers(t.rows);
    setSuppressed(t.suppressed);
    setNotes(n.rows);
    setUnread(n.unread);
  }, []);

  useEffect(() => {
    void load().catch((e) => toast(messageOf(e), "error")).finally(() => setBusy(false));
  }, [load]);

  const markRead = async (id?: number) => {
    try {
      const out = await api.patch<{ marked: number; unread: number }>("/holdings/notifications/read",
        id ? { id } : {}, 20_000);
      toast(id ? `已标记 1 条已读，未读剩 ${out.unread}` : `已清空未读（本次标记 ${out.marked} 条）`, "ok");
      setUnread(out.unread);
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const out = await api.post<ScanOut>("/holdings/scan", {}, 60_000);
      setLastScan(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}：扫描 ${out.checked} 条规则，命中 ${out.hits} 条，发出 ${out.notified} 条提醒`);
      toast(out.hits ? `命中 ${out.hits} 条风控规则` : "全部规则安全", out.hits ? "warn" : "ok");
      void load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setScanning(false);
    }
  };

  const trigCols: Column<HoldingTrigger>[] = [
    { key: "triggered_at", label: "触发时间", width: "w-40", value: (r) => r.triggered_at, render: (r) => (
      <span className="nums whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.triggered_at}</span>) },
    { key: "typeLabel", label: "规则", width: "w-28", value: (r) => r.typeLabel ?? "—", render: (r) => (
      <Chip tone="violet">{r.typeLabel ?? "已删规则"}</Chip>) },
    { key: "account_name", label: "账户", width: "w-24", value: (r) => r.account_name ?? "—", render: (r) => (
      <span className="whitespace-nowrap text-xs">{r.account_name ?? "—"}</span>) },
    { key: "detail", label: "触发依据", value: (r) => r.detail.text ?? "", render: (r) => (
      <span className="whitespace-nowrap text-[12px] text-slate-700 dark:text-slate-200"
        title={r.detail.text ?? JSON.stringify(r.detail)}>
        {r.detail.text ?? JSON.stringify(r.detail)}
      </span>) },
    { key: "suppressed", label: "结果", align: "center", width: "w-24", value: (r) => (r.suppressed ? 1 : 0),
      render: (r) => (r.suppressed
        ? <Chip tone="slate" className="shrink-0">{r.suppress_reason === "noise" ? "降噪抑制" : "冷却抑制"}</Chip>
        : <Chip tone="emerald">已通知</Chip>) },
  ];

  if (busy) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title="风控触发记录"
        subtitle={triggers.length
          ? `最近 ${triggers.length} 次触发，其中 ${suppressed} 次被冷却或降噪拦下 · 降噪口径：同一条规则一天最多提醒 3 次`
          : "还没有触发过风控，说明组合目前都在阈值内"}
        right={(
          <>
            <Link to="/holdings"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              持仓管理
            </Link>
            <Button size="sm" loading={scanning} onClick={() => void scan()}>立即扫描</Button>
          </>
        )}
      >
        {lastScan && (
          <p className="mb-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            {lastScan}
          </p>
        )}
        {triggers.length ? (
          <DataTable columns={trigCols} rows={triggers} rowKey={(r) => r.id} dense maxHeight="520px"
            sortInitial={{ key: "triggered_at", desc: true }} empty="没有触发记录" />
        ) : (
          <EmptyState text="没有触发记录" hint="去「持仓管理 → 风控规则」建规则后用「立即扫描风控」验证" />
        )}
      </Panel>

      <Panel
        title="通知记录"
        subtitle={notes.length
          ? `${notes.length} 条消息（未读 ${unread} 条）· 渠道分站内与邮件，邮件在无 SMTP 时会记「无渠道」`
          : "还没有通知"}
        right={(
          <>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
              <span key={k} className="text-[11px] text-slate-400">{v} {notes.filter((n) => n.channel === k).length}</span>
            ))}
            <Button size="sm" variant="outline" disabled={!unread} onClick={() => void markRead()}>全部已读</Button>
          </>
        )}
      >
        {notes.length ? (
          <ul className="max-h-[520px] space-y-2 overflow-auto pr-1">
            {notes.map((n) => (
              <li key={n.id}
                className={cn("rounded-lg border p-2.5 transition",
                  n.read_at || n.channel !== "inapp"
                    ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    : "border-rose-200 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-500/5")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={n.channel === "email" ? "sky" : "violet"}>{CHANNEL_LABEL[n.channel] ?? n.channel}</Chip>
                  <Chip tone={STATUS_TONE[n.status] ?? "slate"}>{STATUS_LABEL[n.status] ?? n.status}</Chip>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800 dark:text-slate-100"
                    title={n.title}>{n.title}</span>
                  <span className="nums text-[11px] text-slate-400">{n.created_at}</span>
                  {!n.read_at && n.channel === "inapp" && (
                    <Button size="sm" variant="ghost" onClick={() => void markRead(n.id)}>标已读</Button>
                  )}
                </div>
                <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {n.body}
                </p>
                {n.reason && (
                  <p className="mt-1 break-words text-[11px] text-slate-400">通道回执：{n.reason}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="没有通知" hint="规则命中后会自动写站内消息；配置好 SMTP 才会同时发邮件" />
        )}
      </Panel>
    </div>
  );
}
