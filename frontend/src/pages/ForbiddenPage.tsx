import { Link, useLocation } from "react-router-dom";

export default function ForbiddenPage() {
  const needed = (useLocation().state as { needed?: string } | null)?.needed;
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="max-w-md text-center">
        <p className="text-5xl font-bold text-slate-300 dark:text-slate-700">403</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800 dark:text-slate-100">这个页面你没权限</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {needed ? <>缺少权限码 <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">{needed}</code></> : "路由级守卫拦下了这次访问。"}
        </p>
        <p className="mt-2 text-xs text-slate-400">需要的话用 admin 账号登录，在「系统管理」里给角色加权限。</p>
        <Link to="/dashboard"
          className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
          回仪表盘
        </Link>
      </div>
    </div>
  );
}
