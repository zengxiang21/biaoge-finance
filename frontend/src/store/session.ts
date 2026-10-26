import { create } from "zustand";
import {
  ApiError, api, messageOf, readTokens, saveTokens, type TokenPair,
} from "../lib/api";
import type { BrandConfig } from "../lib/types";

export type UserProfile = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "vip" | "user";
  roleLabel: string;
  email: string | null;
  status: string;
  memberExpireAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type NavItem = { path: string; label: string; perm: string; built: boolean; granted: boolean };
export type NavGroup = { key: string; label: string; items: NavItem[] };

type Ctx = {
  user: UserProfile;
  permissions: string[];
  routePermissions: Record<string, string>;
  menuTree: NavGroup[];
  brand?: BrandConfig;
  quota: { aiUnlimited: boolean; note?: string };
};

export type SessionState = {
  status: "idle" | "loading" | "ready" | "anon" | "failed";
  user: UserProfile | null;
  permissions: string[];
  menuTree: NavGroup[];
  routePermissions: Record<string, string>;
  brand: BrandConfig | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (code: string) => boolean;
  refreshBrand: () => Promise<void>;
};

const useSession = create<SessionState>((set, get) => ({
  status: "idle",
  user: null,
  permissions: [],
  menuTree: [],
  routePermissions: {},
  brand: null,
  error: null,

  async bootstrap() {
    if (!readTokens()) {
      set({ status: "anon", user: null, permissions: [], menuTree: [] });
      return;
    }
    set({ status: "loading" });
    try {
      const ctx = await api.get<Ctx>("/auth/context");
      set({
        status: "ready", user: ctx.user, permissions: ctx.permissions,
        menuTree: ctx.menuTree, routePermissions: ctx.routePermissions,
        brand: ctx.brand ?? null, error: null,
      });
    } catch (e) {
      // 只有 4xx 才说明凭证真的失效；后端重启/网络抖动（status 0、5xx）要保留 token 让用户重试
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        saveTokens(null);
        set({ status: "anon", user: null, permissions: [], menuTree: [], error: null });
      } else {
        set({ status: "failed", error: messageOf(e) });
      }
    }
  },

  async login(username, password) {
    set({ error: null });
    const t = await api.post<TokenPair & { user: UserProfile }>("/auth/login", { username, password });
    saveTokens(t);
    set({ user: t.user, status: "loading" });
    const ctx = await api.get<Ctx>("/auth/context");
    set({
      status: "ready", user: ctx.user, permissions: ctx.permissions,
      menuTree: ctx.menuTree, routePermissions: ctx.routePermissions, brand: ctx.brand ?? null,
    });
  },

  async register(username, password) {
    const t = await api.post<TokenPair & { user: UserProfile }>("/auth/register", { username, password });
    saveTokens(t);
    const ctx = await api.get<Ctx>("/auth/context");
    set({
      status: "ready", user: ctx.user, permissions: ctx.permissions,
      menuTree: ctx.menuTree, routePermissions: ctx.routePermissions, brand: ctx.brand ?? null,
    });
  },

  async logout() {
    const t = readTokens();
    try {
      await api.post("/auth/logout", { refreshToken: t?.refreshToken });
    } catch {
      /* 本地清掉就行 */
    }
    saveTokens(null);
    set({ status: "anon", user: null, permissions: [], menuTree: [] });
  },

  hasPerm(code) {
    return get().permissions.includes(code);
  },

  // 通用设置页存完品牌，侧栏和标题立刻跟上
  async refreshBrand() {
    try {
      const p = await api.get<{ brand: BrandConfig }>("/settings/public", undefined, 8000);
      set({ brand: p.brand });
    } catch {
      /* 设置页自己有报错，这里静默 */
    }
  },
}));

export { useSession };
