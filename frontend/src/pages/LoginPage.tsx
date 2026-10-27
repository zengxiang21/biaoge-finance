import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { PublicSettings } from "../lib/types";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { Button, Chip, Field, Spinner, inputClass } from "../components/ui";

export default function LoginPage() {
  const { login } = useSession();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pub, setPub] = useState<PublicSettings | null>(null);
  const nav = useNavigate();
  const next = (useLocation().state as { next?: string } | null)?.next ?? "/dashboard";

  // 品牌名/副标题在通用设置里可改，登录页要跟着走
  useEffect(() => {
    api.get<PublicSettings>("/settings/public", undefined, 8000).then(setPub).catch(() => setPub(null));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      toast("登录成功", "ok");
      nav(next, { replace: true });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm animate-[slide-up_0.28s_cubic-bezier(0.16,1,0.3,1)]">
        <div className="mb-5 flex items-center gap-3">
          {pub?.brand.logo ? (
            <img src={pub.brand.logo} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-rose-600 text-lg font-bold text-white">
              {(pub?.brand.name ?? "曾").slice(0, 1)}
            </span>
          )}
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              {pub?.brand.name ?? "曾老师"}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pub?.brand.subtitle ?? "股票投研 · 数据一体化 · AI 辅助工具"}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <Field label="用户名 / 邮箱">
            <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" placeholder="admin" />
          </Field>
          <Field label="密码">
            <div className="relative">
              <input
                className={inputClass + " pr-16"}
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="输入登录密码"
              />
              <button type="button" onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                {show ? "隐藏" : "显示"}
              </button>
            </div>
          </Field>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" loading={busy} disabled={!username || !password}>
            {busy ? <Spinner /> : null}登录
          </Button>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <Link to="/register" className="hover:text-slate-800 dark:hover:text-slate-200">注册新账号</Link>
            <Link to="/" className="hover:text-slate-800 dark:hover:text-slate-200">先看介绍</Link>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {pub?.demoNote ? (
            <Chip tone="slate">{pub.demoNote}</Chip>
          ) : (
            <Chip tone="slate">体验账号 demo / Demo@2026（无管理权限）</Chip>
          )}
        </div>
      </div>
    </div>
  );
}
