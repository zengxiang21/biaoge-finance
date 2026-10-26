import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="max-w-md text-center">
        <p className="text-5xl font-bold text-slate-300 dark:text-slate-700">404</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800 dark:text-slate-100">这个地址没有对应页面</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">可能是路由打错，或该模块还没开发。</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/dashboard"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
            回仪表盘
          </Link>
          <Link to="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
            看介绍
          </Link>
        </div>
      </div>
    </div>
  );
}
