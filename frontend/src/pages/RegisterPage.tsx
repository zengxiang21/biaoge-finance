import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { messageOf } from "../lib/api";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { Button, Field, inputClass } from "../components/ui";

export default function RegisterPage() {
  const { register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(username.trim(), password);
      toast("注册成功，已自动登录", "ok");
      nav("/dashboard", { replace: true });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4 dark:bg-slate-950">
      <form onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">注册</h1>
        <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">
          新账号默认「普通用户」角色，只有投研菜单；管理员账号由内置 admin 分配。
        </p>
        <Field label="用户名">
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="至少 3 个字符" autoComplete="username" />
        </Field>
        <Field label="密码" hint="至少 8 位">
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" />
        </Field>
        <Field label="确认密码">
          <input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" />
        </Field>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
        )}
        <Button type="submit" className="w-full" loading={busy}
          disabled={username.trim().length < 3 || password.length < 8}>注册并登录</Button>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          已有账号？<Link to="/login" className="text-slate-700 underline dark:text-slate-200">去登录</Link>
        </p>
      </form>
    </div>
  );
}
