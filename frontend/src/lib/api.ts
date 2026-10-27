import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { toast } from "../store/toast";

/** Token 存 localStorage（文档 3.1.1 / 六章存储 key） */
export const TOKEN_KEY = "tsp-saas.auth.tokens";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
};

export function readTokens(): TokenPair | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TokenPair;
    return t?.accessToken ? t : null;
  } catch {
    return null;
  }
}

export function saveTokens(t: TokenPair | null) {
  if (!t) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

const http = axios.create({
  baseURL: "/api",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const t = readTokens();
  if (t?.accessToken) config.headers.set("Authorization", `Bearer ${t.accessToken}`);
  return config;
});

/** 业务错误码 -> 文案（文档 10.7 错误码体系） */
const CODE_TEXT: Record<string, string> = {
  UNAUTHORIZED: "请先登录",
  TOKEN_EXPIRED: "登录已过期，正在自动续期",
  TOKEN_INVALID: "凭证无效，请重新登录",
  TOKEN_REVOKED: "凭证已失效，请重新登录",
  CREDENTIAL_INVALID: "用户名或密码不对",
  ACCOUNT_DISABLED: "账号已停用，联系管理员",
  ACCOUNT_EXPIRED: "会员已过期",
  PERMISSION_DENIED: "没有该操作的权限",
  USERNAME_TAKEN: "这个用户名已经被用了",
  WEAK_PASSWORD: "密码太短",
  BAD_SYMBOL: "股票代码/名称没法识别",
  RATE_LIMITED: "请求太频繁，稍后再试",
  AI_UNREACHABLE: "AI 引擎连不上，检查 Ollama 是否启动",
  AI_FAILED: "AI 调用失败",
  UPSTREAM_ERROR: "上游数据源异常",
  INTERNAL: "服务内部错误",
  NOT_FOUND: "记录不存在",
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let refreshing: Promise<boolean> | null = null;

/** GitHub Pages 演示站：纯静态，没有 FastAPI 可打 */
export const isDemo = import.meta.env.VITE_DEMO === "1";

type DemoEntry = { key: string; file: string; bytes?: number };
type DemoIndex = {
  generatedAt: string;
  live: boolean;
  ingestFailures?: string[];
  entries: DemoEntry[];
};

let demoIndex: Promise<DemoIndex | null> | null = null;

function loadDemoIndex(): Promise<DemoIndex | null> {
  if (!demoIndex) {
    demoIndex = fetch(`${import.meta.env.BASE_URL}demo-api/_index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<DemoIndex>) : null))
      .catch(() => null);
  }
  return demoIndex;
}

/** 和 scripts/export_demo_api.py 的 canon() 严格同规则：空值丢掉、布尔写 true/false、按键排序 */
function demoValue(v: unknown): string {
  if (v === true) return "true";
  if (v === false) return "false";
  return String(v);
}

function demoKey(url: string, params?: Record<string, unknown>): string {
  const [rawPath, rawQuery] = url.split("?");
  const merged: Record<string, string> = {};
  for (const chunk of (rawQuery ?? "").split("&")) {
    const i = chunk.indexOf("=");
    if (i > 0 && chunk.slice(i + 1)) merged[chunk.slice(0, i)] = chunk.slice(i + 1);
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    merged[k] = demoValue(v);
  }
  const path = rawPath.replace(/^\//, "");
  const qs = Object.keys(merged).sort().map((k) => `${k}=${merged[k]}`).join("&");
  return qs ? `${path}?${qs}` : path;
}

async function demoGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const key = demoKey(url, params);
  const idx = await loadDemoIndex();
  // 页面上的「刷新」只是让后端重打上游，静态站没有这个动作，去掉它再认一次
  const hit = idx?.entries.find((e) => e.key === key)
    ?? idx?.entries.find((e) => e.key === demoKey(url.split("?")[0],
      { ...params, refresh: undefined }));
  if (!hit) {
    const samePath = idx?.entries.some((e) => e.key.split("?")[0] === key.split("?")[0]);
    throw new ApiError(
      samePath
        ? "演示站只预抓取了默认参数的这一组，换参数要连本机后端"
        : "演示站没有抓这个模块的数据，要连本机后端才有",
      "DEMO_MISSING", 0);
  }
  const r = await fetch(`${import.meta.env.BASE_URL}demo-api/${hit.file}`);
  if (!r.ok) throw new ApiError(`演示站没预生成 ${hit.file}`, "DEMO_MISSING", r.status);
  return await r.json() as T;
}

/** 演示站顶部横幅要告诉访客这批数据是什么时候抓的、有没有环节空手而归 */
export async function demoSnapshot(): Promise<{ at: string; missed: number }> {
  const idx = await loadDemoIndex();
  return { at: idx?.generatedAt ?? "", missed: idx?.ingestFailures?.length ?? 0 };
}


function demoWrite(): never {
  throw new ApiError("演示站是只读的，写操作要连本机后端", "DEMO_READONLY", 0);
}

async function doRefresh(): Promise<boolean> {
  const t = readTokens();
  if (!t?.refreshToken) return false;
  try {
    const r = await axios.post("/api/auth/refresh", { refreshToken: t.refreshToken }, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    saveTokens(r.data);
    return true;
  } catch {
    saveTokens(null);
    return false;
  }
}

/** 无感续期：并发请求只触发一次刷新（文档 10.7 Token 刷新机制） */
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function toApiError(e: AxiosError): ApiError {
  const detail = (e.response?.data as { detail?: unknown })?.detail;
  const obj = (typeof detail === "object" && detail ? detail : null) as
    | { code?: string; message?: string }
    | null;
  const code = obj?.code ?? (typeof detail === "string" && detail ? "INTERNAL" : "NETWORK");
  const message = obj?.message ?? (typeof detail === "string" ? detail : "") ?? CODE_TEXT[code] ?? e.message;
  return new ApiError(message, code, e.response?.status ?? 0);
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const apiErr = toApiError(error);
    const cfg = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (apiErr.status === 401 && cfg && !cfg._retried && readTokens()?.refreshToken) {
      cfg._retried = true;
      const ok = await refreshOnce();
      if (ok) {
        cfg.headers = { ...cfg.headers, Authorization: `Bearer ${readTokens()!.accessToken}` };
        return http.request(cfg);
      }
      window.dispatchEvent(new CustomEvent("qoder:unauthorized"));
    }
    if (apiErr.status === 403 && apiErr.code === "PERMISSION_DENIED") {
      toast(apiErr.message, "error");
    }
    return Promise.reject(apiErr);
  },
);

export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message || CODE_TEXT[e.code] || "请求失败";
  if (e instanceof TypeError) return "连不上后端，确认 8750 端口已启动";
  if (e instanceof Error) return e.message;
  return String(e);
}

export const api = {
  get: async <T>(url: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> => {
    if (isDemo) return demoGet<T>(url, params);
    return (await http.get<T>(url, { params, timeout: timeoutMs })).data;
  },
  // AI 诊断跑本地 14B，一次几十秒，20s 默认超时会误报「连不上后端」
  post: async <T>(url: string, body?: unknown, timeoutMs?: number): Promise<T> =>
    isDemo ? demoWrite() : (await http.post<T>(url, body, { timeout: timeoutMs })).data,
  put: async <T>(url: string, body?: unknown): Promise<T> =>
    isDemo ? demoWrite() : (await http.put<T>(url, body)).data,
  patch: async <T>(url: string, body?: unknown, timeoutMs?: number): Promise<T> =>
    isDemo ? demoWrite() : (await http.patch<T>(url, body, { timeout: timeoutMs })).data,
  del: async <T>(url: string): Promise<T> =>
    isDemo ? demoWrite() : (await http.delete<T>(url)).data,
};

export default http;
