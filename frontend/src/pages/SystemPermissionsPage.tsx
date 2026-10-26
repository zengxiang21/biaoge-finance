import { useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { PermissionMatrixResult } from "../lib/types";
import { toast } from "../store/toast";
import { Button, Chip, DataTable, EmptyState, Panel, Skeleton, type Column } from "../components/ui";

/** 系统权限（拆解文档路由 37）：角色 × 权限码矩阵，只读 */

const ROLE_ORDER = ["admin", "vip", "user"];
const ROLE_TONE: Record<string, "violet" | "sky" | "slate"> = {
  admin: "violet", vip: "sky", user: "slate",
};

type Row = { code: string; kind: string; roles: string[] };

export default function SystemPermissionsPage() {
  const [data, setData] = useState<PermissionMatrixResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<PermissionMatrixResult>("/system/permissions");
        if (alive) setData(d);
      } catch (e) {
        toast(messageOf(e), "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const kindOf = (code: string) => (data.menus.includes(code) ? "菜单" : "操作");
    return Object.entries(data.grantedBy)
      .map(([code, roles]) => ({ code, kind: kindOf(code), roles }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code));
  }, [data]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return rows.filter((r) => (!role || r.roles.includes(role)) &&
      (!q || r.code.toLowerCase().includes(q) || r.kind.includes(q)));
  }, [rows, role, keyword]);

  const cols: Column<Row>[] = [
    { key: "kind", label: "类型", width: "w-16", value: (r) => r.kind,
      render: (r) => <Chip tone={r.kind === "菜单" ? "sky" : "slate"}>{r.kind}</Chip> },
    { key: "code", label: "权限码", value: (r) => r.code, sortable: true,
      render: (r) => <span className="font-mono text-xs" title={r.code}>{r.code}</span> },
    ...ROLE_ORDER.map<Column<Row>>((r) => ({
      key: r, label: `${data?.roleLabels[r] ?? r}（${data?.roleCounts[r] ?? 0} 人）`, align: "center",
      value: (row) => (row.roles.includes(r) ? 1 : 0),
      render: (row) => (row.roles.includes(r)
        ? <span className="text-emerald-600">✓</span>
        : <span className="text-slate-300 dark:text-slate-600">—</span>),
    })),
  ];

  if (loading && !data) return <Skeleton className="h-96 w-full" />;
  if (!data) return <EmptyState text="权限数据取不到" hint="确认后端 8750 已启动" />;

  const storedCount = data.stored.length;
  const grantCount = ROLE_ORDER.reduce((sum, r) => sum + (data.roles[r]?.length ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {ROLE_ORDER.map((r) => (
          <div key={r} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Chip tone={ROLE_TONE[r]}>{data.roleLabels[r] ?? r}</Chip>
              <span className="text-xs text-slate-500 dark:text-slate-400">{data.roleCounts[r] ?? 0} 个账号</span>
            </div>
            <p className="mt-2 text-lg font-semibold tabular-nums">
              {data.roles[r]?.length ?? 0} <span className="text-xs font-normal text-slate-400">/ {data.all.length} 项权限</span>
            </p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              {r === "admin" ? "全量权限，含管理工作台与系统设置"
                : r === "vip" ? "与注册用户同权，额度体系在文档第十二章暂未启用"
                  : "看盘/选股/持仓/复盘全开，不含管理与系统页"}
            </p>
          </div>
        ))}
      </div>

      <Panel title="权限矩阵"
        subtitle={`共 ${data.all.length} 个权限码（菜单 ${data.menus.length}、操作 ${data.operations.length}），角色授权合计 ${grantCount} 条，库内 role_permissions ${storedCount} 条`}
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            {["", ...ROLE_ORDER].map((r) => (
              <Button key={r || "all"} size="sm" variant={role === r ? "primary" : "outline"} onClick={() => setRole(r)}>
                {r ? data.roleLabels[r] : "全部角色"}
              </Button>
            ))}
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜权限码"
              className="h-7 w-36 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
          </span>
        }>
        {filtered.length ? (
          <DataTable columns={cols} rows={filtered} rowKey={(r) => r.code} dense maxHeight="560px" sortInitial={{ key: "code", desc: false }} />
        ) : <EmptyState text="没有匹配的权限码" hint="换个关键字或切回全部角色" />}
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          授权来自后端 permissions.py 的角色表，启动时同步进 role_permissions；本页只读，
          要改角色权限得改代码后重启，避免运行时把管理员锁在门外。
        </p>
      </Panel>

      <Panel title="路由守卫" subtitle={`前端 ${Object.keys(data.routePermissions).length} 条路由绑了权限码，无权限直接跳 403`}>
        <DataTable dense rows={Object.entries(data.routePermissions).map(([path, code]) => ({ path, code }))}
          rowKey={(r) => r.path} sortInitial={{ key: "path", desc: false }} columns={[
            { key: "path", label: "路由", value: (r) => r.path,
              render: (r) => <span className="font-mono text-xs" title={r.path}>{r.path}</span> },
            { key: "code", label: "所需权限", value: (r) => r.code,
              render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.code}</span> },
            { key: "roles", label: "拥有角色", value: (r) => (data.grantedBy[r.code] ?? []).join(","),
              render: (r) => (
                <span className="flex flex-wrap gap-1">
                  {(data.grantedBy[r.code] ?? []).map((x) => (
                    <Chip key={x} tone={ROLE_TONE[x] ?? "slate"}>{data.roleLabels[x] ?? x}</Chip>
                  ))}
                  {!(data.grantedBy[r.code] ?? []).length && <span className="text-[11px] text-amber-600">没有任何角色有它</span>}
                </span>
              ) },
          ] as Column<{ path: string; code: string }>[]} />
      </Panel>
    </div>
  );
}
