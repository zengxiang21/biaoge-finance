import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { AuditLogResult, AuditLogRow } from "../lib/types";
import { timeAgo } from "../lib/format";
import { toast } from "../store/toast";
import { Button, Chip, DataTable, EmptyState, Panel, Skeleton, type Column } from "../components/ui";

/** 审计日志（拆解文档路由 38）：谁在什么时候动了什么 */

const ACTION_LABEL: Record<string, string> = {
  "auth:login": "登录", "auth:logout": "登出", "auth:register": "注册",
  "watchlist:create": "加自选", "watchlist:delete": "删自选",
  "strategy:create": "建策略", "strategy:update": "改策略", "strategy:delete": "删策略",
  "strategy:run": "跑策略", "strategy:ai-create": "AI 建策略",
  "review:generate": "生成复盘", "review:delete": "删复盘", "review:schedule": "复盘定时",
  "anomaly:rule:create": "建异动规则", "anomaly:rule:delete": "删异动规则", "anomaly:scan": "异动扫描",
  "holdings:account:create": "开持仓账户", "holdings:trade": "记交易", "holdings:rule:create": "建风控规则",
  "holdings:rule:delete": "删风控规则", "holdings:scan": "持仓体检",
  "simulation:account:create": "开模拟账户", "simulation:order": "模拟下单", "simulation:cancel": "模拟撤单",
  "system:data-source:update": "改数据源", "system:data-sources:probe": "探测数据源",
  "settings:ai:update": "改 AI 配置", "settings:ai:test": "测 AI 连接",
  "settings:general:update": "改通用设置", "settings:marketing:update": "改营销配置",
  "settings:logo": "传 Logo", "settings:qrcode": "传收款码",
  "admin:student-create": "建学员", "admin:student-update": "改学员", "admin:student-close": "注销学员",
  "admin:student-quota": "调配额", "admin:student-quota-batch": "批量调配额",
  "feedback:create": "提交反馈", "feedback:reply": "回复反馈", "feedback:status": "改反馈状态",
  "feedback:delete": "删反馈",
};

const PAGE_SIZE = 50;

function label(action: string) {
  return ACTION_LABEL[action] ?? action;
}

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<AuditLogResult>("/system/audit-logs", {
        limit: PAGE_SIZE, offset,
        user_id: userId || undefined, action: action || undefined, keyword: keyword || undefined,
      });
      setData(d);
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setLoading(false);
    }
  }, [offset, userId, action, keyword]);

  useEffect(() => { void load(); }, [load]);

  const cols: Column<AuditLogRow>[] = [
    { key: "created_at", label: "时间", width: "w-40", value: (r) => r.created_at ?? "",
      render: (r) => (
        <span className="whitespace-nowrap" title={r.created_at ?? ""}>
          <span className="tabular-nums">{r.created_at?.slice(5, 16) ?? "—"}</span>
          <span className="ml-1 text-[11px] text-slate-400">{timeAgo(r.created_at)}</span>
        </span>
      ) },
    { key: "user", label: "操作人", value: (r) => r.display_name ?? r.username ?? "系统",
      render: (r) => (r.user_id
        ? <span className="truncate">{r.display_name || r.username}
            <span className="text-[11px] text-slate-400">@{r.username}</span>
          </span>
        : <Chip tone="slate">系统</Chip>) },
    { key: "action", label: "动作", value: (r) => r.action, sortable: true,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <Chip tone={r.action.startsWith("auth:") ? "sky" : r.action.includes("delete") ? "rose" : "slate"}>
            {label(r.action)}
          </Chip>
          <span className="hidden truncate font-mono text-[10px] text-slate-400 xl:inline" title={r.action}>{r.action}</span>
        </span>
      ) },
    { key: "target", label: "对象 / 详情", value: (r) => r.target ?? "",
      render: (r) => <span className="block max-w-[520px] truncate text-xs text-slate-600 dark:text-slate-300"
        title={r.target ?? ""}>{r.target || "—"}</span> },
  ];

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading && !data) return <Skeleton className="h-96 w-full" />;

  return (
    <Panel title="审计日志"
      subtitle={`库里共 ${total} 条，按 50 条一页翻；登录、改配置、下单、删数据都会留痕`}
      right={
        <span className="flex items-center gap-1.5">
          <select value={userId} onChange={(e) => { setUserId(e.target.value); setOffset(0); }}
            className="h-7 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <option value="">全部操作人</option>
            {(data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}
            className="h-7 max-w-[180px] rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <option value="">全部动作</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a.action} value={a.action}>{label(a.action)}（{a.count}）</option>
            ))}
          </select>
          <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setOffset(0); }}
            placeholder="搜对象/动作" className="h-7 w-32 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
          <Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>刷新</Button>
        </span>
      }>
      <div className="space-y-3">
        {data?.rows.length ? (
          <DataTable columns={cols} rows={data.rows} rowKey={(r) => r.id} dense maxHeight="620px" />
        ) : <EmptyState text="这个条件下没有日志" hint="清掉筛选条件再看，日志只记不做查询的历史" />}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
          <span className="text-slate-500 dark:text-slate-400">第 {page} / {pages} 页，本页 {data?.rows.length ?? 0} 条</span>
          <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
          <Link to="/system/permissions" className="ml-auto text-xs text-rose-600 hover:underline">看角色权限矩阵</Link>
        </div>
        <p className="text-[11px] leading-4 text-slate-400">
          口径说明：日志写在 audit_logs，只记「谁、动了什么、动了哪条」，不记改前改后的值；
          后台调度任务的执行记录在监控页的任务表里，两者不混。
        </p>
      </div>
    </Panel>
  );
}
