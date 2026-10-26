import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type {
  ReviewGenerated, ReviewPayload, ReviewReportRow, ReviewSchedule, SectorFlowRow,
} from "../lib/types";
import {
  Button, Chip, EmptyState, Field, Markdown, Panel, Skeleton, UpDown,
  cn, inputClass,
} from "../components/ui";
import { BreadthBar, EmotionRadar, HeatBars, type Dim } from "../components/charts";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { num, pct, price } from "../lib/format";

const AI_TIMEOUT = 240_000;

export default function ReviewPage() {
  const { hasPerm } = useSession();
  const nav = useNavigate();
  const canGen = hasPerm("review:generate");
  const canSched = hasPerm("review:schedule");
  const canDel = hasPerm("review:delete");

  const [reports, setReports] = useState<ReviewReportRow[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [sched, setSched] = useState<ReviewSchedule | null>(null);
  const [report, setReport] = useState<ReviewGenerated | null>(null);
  const [busy, setBusy] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [showMd, setShowMd] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [smtp, setSmtp] = useState<SmtpForm | null>(null);

  const loadList = useCallback(async () => {
    const out = await api.get<{ rows: ReviewReportRow[]; sections: string[] }>("/reviews", {}, 30_000);
    setReports(out.rows);
    setSections(out.sections ?? []);
    return out.rows;
  }, []);

  const loadSched = useCallback(async () => {
    const s = await api.get<ReviewSchedule>("/reviews/schedule", {}, 20_000);
    setSched(s);
    setEmailDraft((s.email_to ?? []).join("; "));
    setSmtp(s.smtp ? { ...s.smtp, password: "" } : null);
    return s;
  }, []);

  const openReport = useCallback(async (id: number) => {
    const r = await api.get<{ id: number; trade_date: string; markdown: string; score: number | null; payload: ReviewPayload }>(
      `/reviews/${id}`, {}, 30_000);
    setReport({ id: r.id, date: r.trade_date, markdown: r.markdown, score: r.score, payload: r.payload });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [rows] = await Promise.all([loadList(), loadSched()]);
        if (rows.length) await openReport(rows[0].id);
      } catch (e) {
        toast(messageOf(e), "error");
      } finally {
        setBusy(false);
      }
    })();
  }, [loadList, loadSched, openReport]);

  const generate = async () => {
    setGenerating(true);
    try {
      const out = await api.post<ReviewGenerated>(
        `/reviews/generate${date ? `?date=${encodeURIComponent(date)}` : ""}`, {}, AI_TIMEOUT);
      setReport(out);
      setShowMd(false);
      toast(`${out.date} 复盘已生成${out.aiError ? `（AI 段落走了兜底：${out.aiError}）` : ""}`,
        out.aiError ? "warn" : "ok");
      await loadList();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setGenerating(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const out = await api.post<{ ok: boolean; status: string; reason: string; recipients: string[] }>(
        `/reviews/schedule/send-now${date ? `?date=${encodeURIComponent(date)}` : ""}`, {}, AI_TIMEOUT);
      toast(out.ok ? `已发送到 ${out.recipients.length || 1} 个邮箱` : `未发送（${out.status}）：${out.reason}`,
        out.ok ? "ok" : "warn");
      await loadList();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSending(false);
    }
  };

  const testEmail = async () => {
    try {
      const out = await api.post<{ ok: boolean; status: string; reason: string }>("/reviews/schedule/test-email",
        { email_to: emailDraft.split(/[;；,]/).map((x) => x.trim()).filter(Boolean) }, 60_000);
      toast(out.ok ? "测试邮件已发出" : `发送未成功（${out.status}）：${out.reason}`, out.ok ? "ok" : "warn");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const saveSched = async () => {
    if (!sched) return;
    setSaving(true);
    try {
      const out = await api.put<ReviewSchedule>("/reviews/schedule", {
        enabled: sched.enabled, autoAi: sched.autoAi, time: sched.time,
        weekday_only: sched.weekday_only,
        email_to: emailDraft.split(/[;；,]/).map((x) => x.trim()).filter(Boolean),
        smtp: smtp ? { host: smtp.host, port: smtp.port, use_ssl: smtp.use_ssl,
          user: smtp.user, from_mail: smtp.from_mail, password: smtp.password } : undefined,
      });
      setSched(out);
      setEmailDraft((out.email_to ?? []).join("; "));
      setSmtp(out.smtp ? { ...out.smtp, password: "" } : null);
      toast("定时复盘配置已保存，调度器同步生效", "ok");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: ReviewReportRow) => {
    if (!window.confirm(`删除 ${r.trade_date} 的复盘报告？`)) return;
    try {
      await api.del(`/reviews/${r.id}`);
      toast("报告已删除", "ok");
      if (report?.id === r.id) setReport(null);
      await loadList();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label}已复制到剪贴板`, "ok");
      return;
    } catch {
      // 页面失去焦点时异步 Clipboard API 会被拒，退回同步选区复制
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      toast(ok ? `${label}已复制到剪贴板` : "浏览器不让复制，展开全文后手动 Ctrl+C", ok ? "ok" : "warn");
    }
  };

  if (busy) return <Skeleton className="h-80 w-full" />;

  const p = report?.payload;
  const b = p?.breadth ?? {};
  const ff = p?.fundFlow ?? {};

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Panel
          title="每日复盘"
          subtitle={report
            ? `${report.date} · 情绪分 ${report.score ?? "—"} · ${report.markdown.length} 字 · AI 模型 ${p?.aiModel ?? "兜底文案"}`
            : "收盘后把指数、广度、情绪、板块、自选、策略与快讯汇总成一份结构化报告"}
          right={(
            <>
              <input className={cn(inputClass, "nums h-8 w-32 py-1 text-xs")} type="date" value={date}
                onChange={(e) => setDate(e.target.value)} title="留空即最新交易日" />
              <Button size="sm" variant="outline" disabled={!canGen} loading={generating}
                onClick={() => void generate()}>生成复盘</Button>
              <Button size="sm" loading={sending} disabled={!canSched || !report}
                onClick={() => void sendNow()}>立即发送</Button>
            </>
          )}
        >
          {!report ? (
            <EmptyState text="还没有复盘报告" hint="点右上「生成复盘」，或从右侧历史列表打开已有报告" />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <Block title="指数快照" hint={p?.date}>
                  {p?.indexes.length ? (
                    <table className="w-full text-sm">
                      <tbody>
                        {p.indexes.map((r) => (
                          <tr key={r.symbol} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                            <td className="whitespace-nowrap py-1 text-[13px] text-slate-700 dark:text-slate-200">{r.name ?? r.symbol}</td>
                            <td className="nums whitespace-nowrap py-1 text-right">{price(r.close)}</td>
                            <td className="w-20 py-1 text-right"><UpDown value={r.changePercent} /></td>
                            <td className="nums w-24 py-1 text-right text-[11px] text-slate-400">{r.amount ? `${r.amount}亿` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <Hint text="当日指数行情没取到" />}
                </Block>

                <Block title="涨跌统计 · 情绪评分" hint={p?.sentiment.label}>
                  <div className="flex flex-wrap items-center gap-3">
                    <EmotionRadar dims={dimsOf(p)} score={p?.sentiment.score ?? null} size={170} />
                    <div className="min-w-[180px] flex-1 space-y-2">
                      <BreadthBar up={num0(b.up)} flat={num0(b.flat)} down={num0(b.down)} />
                      <dl className="grid grid-cols-2 gap-x-3 text-xs">
                        <Kv k="涨停" v={txt(b.limit_up)} tone="up" />
                        <Kv k="跌停" v={txt(b.limit_down)} tone="down" />
                        <Kv k="炸板" v={txt(b.blown)} tone="flat" />
                        <Kv k="成交总额" v={b.amount ? `${b.amount} 亿` : "—"} tone="flat" />
                        <Kv k="较上一日" v={b.amount_vs_prev === null || b.amount_vs_prev === undefined
                          ? "—" : pct(Number(b.amount_vs_prev))} tone={signOf(Number(b.amount_vs_prev))} />
                        <Kv k="MA20 上方" v={b.ma20_above_ratio === null || b.ma20_above_ratio === undefined
                          ? "—" : `${(Number(b.ma20_above_ratio) * 100).toFixed(1)}%`} tone="flat" />
                      </dl>
                    </div>
                  </div>
                </Block>

                <Block title="行业板块" hint={p?.sectors.error ? `资金流异常：${p.sectors.error}` : "领涨 / 领跌（平均涨幅）"}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] text-rose-500">领涨</p>
                      <HeatBars rows={sectorRows(p?.sectors.leading ?? [])} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-emerald-600">领跌</p>
                      <HeatBars rows={sectorRows(p?.sectors.lagging ?? [])} />
                    </div>
                  </div>
                </Block>

                <Block title="自选股专项" hint={`${p?.watchlist.length ?? 0} 只`}>
                  {p?.watchlist.length ? (
                    <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                      {p.watchlist.map((w) => (
                        <li key={w.symbol} className="flex items-center justify-between gap-2 text-xs">
                          <button type="button" onClick={() => nav(`/stock-analysis/${w.symbol}`)}
                            className="min-w-0 flex-1 truncate text-left text-slate-700 hover:underline dark:text-slate-200"
                            title={`${w.name} ${w.symbol}`}>{w.name}</button>
                          <span className="nums shrink-0 text-slate-500 dark:text-slate-400">{price(w.price)}</span>
                          <span className="w-14 shrink-0 text-right"><UpDown value={w.changePercent} /></span>
                        </li>
                      ))}
                    </ul>
                  ) : <Hint text="自选股是空的，去「自选股」页加几只再看复盘" />}
                </Block>

                <Block title="策略命中" hint="当日跑过信号的策略">
                  {p?.strategies.length ? (
                    <ul className="space-y-1">
                      {p.strategies.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                          <button type="button" onClick={() => nav(`/strategy/${s.id}`)}
                            className="whitespace-nowrap font-medium text-slate-700 hover:underline dark:text-slate-200">
                            {s.name}
                          </button>
                          <Chip tone={s.pick_count ? "rose" : "slate"}>命中 {s.pick_count}</Chip>
                          <Chip tone="slate">{s.status}</Chip>
                          <span className="nums text-[11px] text-slate-400" title={s.finished_at ?? ""}>
                            {s.recentOnly ? "非当日，最近一次结果" : s.finished_at?.slice(5, 16) ?? "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <Hint text="当日没有策略运行记录，去「策略列表」跑一次再来复盘" />}
                </Block>

                <Block title="异动与资金" hint={`近 24 小时 ${p?.anomaly.total ?? 0} 条异动，涉及 ${p?.anomaly.symbols ?? 0} 只`}>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {(p?.anomaly.byType ?? []).map((t) => (
                      <Chip key={t.key} tone={t.count ? (t.tone as "rose") : "slate"}>{t.label} {t.count}</Chip>
                    ))}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 text-xs">
                    <Kv k="主力净流入" v={ff.industryNet === null || ff.industryNet === undefined
                      ? "—" : `${ff.industryNet} 亿`} tone={signOf(Number(ff.industryNet))} />
                    <Kv k="北向" v={txt(ff.northToday, " 亿")} tone={signOf(Number(ff.northToday))} />
                    <Kv k="流入总额" v={ff.inAmount ? `${ff.inAmount} 亿` : "—"} tone="flat" />
                    <Kv k="流出总额" v={ff.outAmount ? `${ff.outAmount} 亿` : "—"} tone="flat" />
                  </dl>
                  {typeof ff.northNote === "string" && ff.northNote && (
                    <p className="mt-1 text-[11px] text-slate-400">{ff.northNote}</p>
                  )}
                </Block>

                <Block title="今日核心观点" hint={p?.aiModel ? `AI：${p.aiModel}` : "规则兜底"}>
                  {p?.coreView ? <Markdown text={p.coreView} /> : <Hint text="AI 段落未生成" />}
                </Block>

                <Block title="作战计划" hint="看多 / 看空方向">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-rose-50/70 p-2.5 dark:bg-rose-500/10">
                      <p className="mb-1 text-[11px] font-medium text-rose-600 dark:text-rose-300">看多方向</p>
                      <p className="break-words text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                        {p?.plan?.long || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-emerald-50/70 p-2.5 dark:bg-emerald-500/10">
                      <p className="mb-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">看空方向</p>
                      <p className="break-words text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                        {p?.plan?.short || "—"}
                      </p>
                    </div>
                  </div>
                </Block>

                <Block title="市场快讯" hint={`${p?.news.length ?? 0} 条`}>
                  <ul className="max-h-52 space-y-1 overflow-auto pr-1">
                    {(p?.news ?? []).map((n, i) => (
                      <li key={`${n.time}-${i}`} className="flex items-start gap-2 text-xs">
                        <span className="nums shrink-0 text-[11px] text-slate-400">{n.time?.slice(11, 16) ?? n.time}</span>
                        <span className="min-w-0 flex-1 break-words text-slate-700 dark:text-slate-200">{n.title}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{n.source}</span>
                      </li>
                    ))}
                  </ul>
                </Block>

                <Block title="明日操作指南" hint={p?.aiModel ? `AI：${p.aiModel}` : "规则兜底"}>
                  {p?.tomorrow ? <Markdown text={p.tomorrow} /> : <Hint text="AI 段落未生成" />}
                </Block>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowMd((v) => !v)}>
                  {showMd ? "收起全文" : "展开 Markdown 全文"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copy(report.markdown, "Markdown 全文")}>
                  复制 Markdown
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => void copy(report.markdown.replace(/[#*`>-]/g, ""), "纯文本")}>
                  复制纯文本
                </Button>
                <span className="ml-auto text-[11px] text-slate-400">
                  板块顺序：{sections.join(" → ")}
                </span>
              </div>

              {showMd && (
                <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                  <Markdown text={report.markdown} />
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="定时复盘" subtitle={sched ? (sched.enabled
          ? `每个${sched.weekday_only ? "交易日" : "自然日"} ${sched.time} 自动生成${sched.autoAi ? "并写 AI 段落" : "（不含 AI）"}`
          : "定时任务未启用") : "读取配置…"}>
          {sched && (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">启用定时复盘</span>
                <input type="checkbox" disabled={!canSched} checked={sched.enabled}
                  onChange={(e) => setSched({ ...sched, enabled: e.target.checked })} />
              </label>
              <Field label="推送时间" hint="建议 15:45 之后，等当日收盘快照落库">
                <input className={cn(inputClass, "nums")} type="time" disabled={!canSched} value={sched.time}
                  onChange={(e) => setSched({ ...sched, time: e.target.value })} />
              </Field>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">只在交易日跑</span>
                <input type="checkbox" disabled={!canSched} checked={sched.weekday_only}
                  onChange={(e) => setSched({ ...sched, weekday_only: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">自动生成 AI 观点</span>
                <input type="checkbox" disabled={!canSched} checked={sched.autoAi}
                  onChange={(e) => setSched({ ...sched, autoAi: e.target.checked })} />
              </label>
              <Field label="收件邮箱" hint="多个用分号隔开">
                <input className={inputClass} value={emailDraft} disabled={!canSched} placeholder="a@qq.com; b@163.com"
                  onChange={(e) => setEmailDraft(e.target.value)} />
              </Field>

              {smtp && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                    SMTP 发件配置
                    <Chip tone={sched.emailReady ? "emerald" : "amber"}>{sched.emailReady ? "可用" : "未配全"}</Chip>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="服务器">
                      <input className={inputClass} value={smtp.host} disabled={!canSched}
                        onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
                    </Field>
                    <Field label="端口">
                      <input className={cn(inputClass, "nums")} type="number" value={smtp.port} disabled={!canSched}
                        onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />
                    </Field>
                    <Field label="发件邮箱">
                      <input className={inputClass} value={smtp.user} disabled={!canSched} placeholder="xxx@qq.com"
                        onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />
                    </Field>
                    <Field label="显示名邮箱">
                      <input className={inputClass} value={smtp.from_mail} disabled={!canSched}
                        onChange={(e) => setSmtp({ ...smtp, from_mail: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="授权码" hint={smtp.hasPassword ? "已保存，留空即不改；这里填的是邮箱授权码不是登录密码" : "QQ/163 需先在邮箱设置里生成授权码"}>
                    <input className={inputClass} type="password" value={smtp.password} disabled={!canSched}
                      placeholder={smtp.hasPassword ? "••••••（保持不变）" : "授权码"}
                      onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} />
                  </Field>
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">使用 SSL（465）</span>
                    <input type="checkbox" disabled={!canSched} checked={smtp.use_ssl}
                      onChange={(e) => setSmtp({ ...smtp, use_ssl: e.target.checked })} />
                  </label>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={saving} disabled={!canSched} onClick={() => void saveSched()}>保存配置</Button>
                <Button size="sm" variant="outline" disabled={!canSched} onClick={() => void testEmail()}>测试邮件</Button>
              </div>
              {!sched.emailReady && (
                <p className="text-[11px] text-amber-600">
                  没配 SMTP 也能用：定时任务照样生成并归档报告，邮件那条记「无渠道」，站内提醒照常。
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="历史报告" subtitle={`${reports.length} 份归档`}>
          {reports.length ? (
            <ul className="max-h-[420px] space-y-1.5 overflow-auto pr-1">
              {reports.map((r) => (
                <li key={r.id}>
                  <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition",
                    report?.id === r.id
                      ? "border-slate-800 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800")}>
                    <button type="button" onClick={() => void openReport(r.id)}
                      className="min-w-0 flex-1 text-left">
                      <span className="nums whitespace-nowrap text-xs font-medium">{r.trade_date}</span>
                      <span className={cn("nums ml-2 text-[11px]",
                        report?.id === r.id ? "opacity-70" : "text-slate-400")}>
                        {r.score === null ? "无情绪分" : `情绪 ${r.score}`} · {num(r.len, 0, " 字")}
                        {r.emailed ? " · 已发" : ""}
                      </span>
                    </button>
                    {canDel && (
                      <button type="button" title="删除该报告" onClick={() => void remove(r)}
                        className={cn("shrink-0 text-[11px]",
                          report?.id === r.id ? "text-white/70 hover:text-white dark:text-slate-500" : "text-slate-400 hover:text-rose-500")}>
                        删
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState text="还没有归档" hint="生成一次复盘就会存进这里" />}
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 小组件 */

function Block({ title, hint, children }: { title: string; hint?: string | null; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <header className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {hint && <span className="nums min-w-0 flex-1 truncate text-[11px] text-slate-400" title={String(hint)}>{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function Hint({ text }: { text: string }) {
  return <p className="text-xs text-slate-400">{text}</p>;
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" | "flat" }) {
  const color = tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-600" : "text-slate-700 dark:text-slate-200";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className={cn("nums truncate font-medium", color)}>{v}</dd>
    </div>
  );
}

type SmtpForm = {
  host: string; port: number; use_ssl: boolean; user: string; from_mail: string;
  hasPassword: boolean; password: string;
};

function num0(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

function txt(v: unknown, suffix = ""): string {
  if (v === null || v === undefined || v === "") return "—";
  return `${v}${suffix}`;
}

function signOf(v: number): "up" | "down" | "flat" {
  if (Number.isNaN(v)) return "flat";
  return v > 0 ? "up" : v < 0 ? "down" : "flat";
}

function sectorRows(rows: SectorFlowRow[]) {
  return rows.map((r) => ({ code: r.code, name: r.name, changePercent: r.avgChangePercent }));
}

function dimsOf(p: ReviewPayload | null | undefined): Dim[] {
  const dims = p?.sentiment.dims ?? {};
  const labels = p?.sentiment.labels ?? {};
  return Object.entries(dims).map(([key, value]) => ({
    key, label: labels[key] ?? key, score: typeof value === "number" ? value : null, weight: 0,
  }));
}
