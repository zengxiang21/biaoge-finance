import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../store/session";
import { useTheme } from "../store/theme";
import { toast } from "../store/toast";
import { api } from "../lib/api";
import { tradeDate } from "../lib/format";
import { cn, Chip } from "./ui";
import { Icon, navIcon } from "./icons";
import type { NavGroup } from "../store/session";

const COLLAPSE_KEY = "tsp-saas.nav.collapsed";
const PIN_KEY = "tsp-saas.nav.pinned";

type Health = {
  snapshotDate?: string | null;
  phase?: { label?: string; trading?: boolean } | null;
  time?: string;
};

export default function Layout({ children }: { children: ReactNode }) {
  const { menuTree, user, logout, permissions, brand } = useSession();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(localStorage.getItem(COLLAPSE_KEY) === "1");
  const [pinned, setPinned] = useState(localStorage.getItem(PIN_KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const location = useLocation();
  const nav = useNavigate();

  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"), [collapsed]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (brand?.name) document.title = brand.subtitle ? `${brand.name} · ${brand.subtitle}` : brand.name;
  }, [brand]);

  // 侧栏 hover 时临时展开，比每次都点折叠按钮顺手
  const navCollapsed = collapsed && !mobileOpen && !pinned;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await api.get<Health>("/health");
        if (!alive) return;
        setHealth(d);
        setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };
    void load();
    // 隐藏标签页浏览器自己会把定时器压到 1 分钟一次，这里不再额外跳过，
    // 否则内置浏览器里看着像「卡住不刷新」
    const timer = window.setInterval(() => { void load(); }, 120_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const groups: NavGroup[] = menuTree;
  const trading = !!health?.phase?.trading;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        onMouseEnter={() => collapsed && setPinned(true)}
        onMouseLeave={() => setPinned(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-slate-900",
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          navCollapsed ? "w-[58px]" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3 dark:border-slate-800">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2">
            {brand?.logo ? (
              <img src={brand.logo} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-600 text-sm font-bold text-white">
                {(brand?.name || "彪").slice(0, 1)}
              </span>
            )}
            {!navCollapsed && (
              <span className="min-w-0" title={`${brand?.name || "彪哥财经"} ${brand?.subtitle || ""}`}>
                <span className="block truncate text-sm font-semibold leading-tight">{brand?.name || "彪哥财经"}</span>
                <span className="block truncate text-[10px] text-slate-400">{brand?.subtitle || "之英雄本色"}</span>
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
          {groups.map((g) => (
            <div key={g.key} className="mb-2.5">
              {!navCollapsed ? (
                <p className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <Icon name={navIcon("", g.key)} className="h-3 w-3" />
                  {g.label}
                </p>
              ) : (
                <p className="mx-2 mb-1 border-t border-slate-100 pt-2 dark:border-slate-800" />
              )}
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const to = item.built ? item.path : `/development?to=${encodeURIComponent(item.path)}`;
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={to}
                        title={item.label}
                        className={({ isActive }) => cn(
                          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition",
                          isActive
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                        )}
                      >
                        <Icon name={navIcon(item.path, g.key)}
                          className={cn("h-4 w-4", navCollapsed && "mx-auto h-[18px] w-[18px]")} />
                        {!navCollapsed && (
                          <span className="flex min-w-0 flex-1 items-center gap-1">
                            <span className="truncate">{item.label}</span>
                            {!item.built && <span className="shrink-0 text-[9px] text-slate-400">·待开发</span>}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-2 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              title={theme === "dark" ? "切到浅色" : "切到深色"}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Icon name={theme === "dark" ? "moon" : "sun"} />
            </button>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="hidden h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:grid"
              title={collapsed ? "展开菜单" : "收起菜单"}
            >
              <Icon name={collapsed ? "expand" : "collapse"} />
            </button>
            {!navCollapsed && (
              <span className="ml-auto pr-1 text-[10px] text-slate-400">{permissions.length} 项权限</span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{pageTitle(location.pathname)}</p>
            <p className="truncate text-[11px] text-slate-400">股票投研 · 数据一体化 · AI 辅助工具</p>
          </div>
          <Chip tone={offline ? "rose" : trading ? "emerald" : "slate"}>
            <span className={cn("h-1.5 w-1.5 rounded-full",
              offline ? "bg-rose-500" : trading ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
            {offline ? "后端未启动" : health?.phase?.label ?? "连接中"}
          </Chip>
          <Chip tone="slate" className="hidden md:inline-flex">
            {health?.snapshotDate ? `快照 ${tradeDate(health.snapshotDate)}` : "未建快照"}
          </Chip>
          <div className="relative hidden items-center gap-2 sm:flex">
            <span className="text-xs text-slate-500 dark:text-slate-400">{user?.displayName}</span>
            <Chip tone={user?.role === "admin" ? "violet" : "sky"}>{user?.roleLabel}</Chip>
            <button
              onClick={async () => {
                await logout();
                toast("已退出登录", "ok");
                nav("/login", { replace: true });
              }}
              title="退出登录"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 animate-[fade-in_0.24s_ease-out] p-4">
          {children}
        </main>
      </div>
    </div>
  );
}

const PAGE_TITLES: [string, string][] = [
  ["/dashboard", "仪表盘 · 大盘全景"],
  ["/watchlist", "自选股"],
  ["/stock-analysis", "股票分析"],
  ["/limit-ladder", "涨停梯队"],
  ["/strategy", "策略列表"],
  ["/holdings/alerts", "持仓提醒"],
  ["/holdings", "持仓管理"],
  ["/simulation/account", "模拟账户"],
  ["/simulation/orders", "模拟订单"],
  ["/info/news-flash", "快讯中心"],
  ["/info/hot-search", "热搜榜"],
  ["/info/fund-flow", "资金流向"],
  ["/anomaly/rules", "异常检测规则"],
  ["/anomaly", "实时异常监控"],
  ["/review", "每日复盘"],
  ["/data/quotes", "行情数据"],
  ["/settings/data-sources", "数据源矩阵"],
  ["/admin/workbench/monitor", "全局监控"],
  ["/admin/workbench/students", "学员管理"],
  ["/admin/workbench/feedbacks", "反馈管理"],
  ["/admin/workbench/settings/general", "通用设置"],
  ["/admin/workbench/settings/ai", "AI 引擎设置"],
  ["/system/permissions", "角色权限矩阵"],
  ["/system/audit-logs", "审计日志"],
  ["/profile", "个人中心"],
  ["/global-index", "全球指数"],
  ["/oil-gold", "原油黄金"],
  ["/concept-analysis", "概念分析"],
  ["/industry-analysis", "行业分析"],
  ["/merger-restructuring", "并购重组"],
  ["/data/fundamentals", "基础数据"],
  ["/finance/statements", "财务报表"],
  ["/finance/indicators", "财务指标"],
  ["/market-env/history", "市场环境历史"],
  ["/market-env", "市场环境"],
  ["/index/components", "指数成分"],
  ["/index", "指数概览"],
  ["/academy/basics", "看盘基础"],
  ["/academy/books", "推荐书籍"],
  ["/development", "功能待开发"],
  ["/403", "没有访问权限"],
];

// 精确匹配优先，再退到前缀，/strategy/51 这种详情页也能拿到分组名
function pageTitle(path: string): string {
  const exact = PAGE_TITLES.find(([p]) => p === path);
  if (exact) return exact[1];
  const hit = PAGE_TITLES.find(([p]) => p !== "/" && path.startsWith(p + "/"));
  if (hit) return hit[1];
  if (path.startsWith("/stock-analysis/")) return "个股诊断";
  return "彪哥财经之英雄本色";
}
