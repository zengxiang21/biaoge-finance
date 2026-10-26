import { Suspense, lazy, ReactNode, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { Button, Skeleton, Spinner, ToastHost } from "./components/ui";
import { useSession } from "./store/session";
import ForbiddenPage from "./pages/ForbiddenPage";
import NotFoundPage from "./pages/NotFoundPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import WelcomePage from "./pages/WelcomePage";

// 路由级代码分割（文档 10.3）
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
const QuotesPage = lazy(() => import("./pages/QuotesPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const StockAnalysisPage = lazy(() => import("./pages/StockAnalysisPage"));
const LimitLadderPage = lazy(() => import("./pages/LimitLadderPage"));
const StrategyListPage = lazy(() => import("./pages/StrategyListPage"));
const StrategyDetailPage = lazy(() => import("./pages/StrategyDetailPage"));
const DataSourceMatrixPage = lazy(() => import("./pages/DataSourceMatrixPage"));
const AiSettingsPage = lazy(() => import("./pages/AiSettingsPage"));
const InfoNewsFlashPage = lazy(() => import("./pages/InfoNewsFlashPage"));
const InfoHotSearchPage = lazy(() => import("./pages/InfoHotSearchPage"));
const InfoFundFlowPage = lazy(() => import("./pages/InfoFundFlowPage"));
const AnomalyEventsPage = lazy(() => import("./pages/AnomalyEventsPage"));
const AnomalyRulesPage = lazy(() => import("./pages/AnomalyRulesPage"));
const HoldingsPage = lazy(() => import("./pages/HoldingsPage"));
const HoldingsAlertsPage = lazy(() => import("./pages/HoldingsAlertsPage"));
const SimulationAccountPage = lazy(() => import("./pages/SimulationAccountPage"));
const SimulationOrdersPage = lazy(() => import("./pages/SimulationOrdersPage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const MonitorPage = lazy(() => import("./pages/MonitorPage"));
const StudentsPage = lazy(() => import("./pages/StudentsPage"));
const FeedbacksPage = lazy(() => import("./pages/FeedbacksPage"));
const GeneralSettingsPage = lazy(() => import("./pages/GeneralSettingsPage"));
const SystemPermissionsPage = lazy(() => import("./pages/SystemPermissionsPage"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage"));
const ComingSoonPage = lazy(() => import("./pages/ComingSoonPage"));
const GlobalIndexPage = lazy(() => import("./pages/GlobalIndexPage"));
const OilGoldPage = lazy(() => import("./pages/OilGoldPage"));
const BoardAnalysisPage = lazy(() => import("./pages/BoardAnalysisPage"));
const MergerPage = lazy(() => import("./pages/MergerPage"));
const FundamentalsPage = lazy(() => import("./pages/FundamentalsPage"));
const FinanceStatementsPage = lazy(() => import("./pages/FinanceStatementsPage"));
const FinanceIndicatorsPage = lazy(() => import("./pages/FinanceIndicatorsPage"));
const MarketEnvPage = lazy(() => import("./pages/MarketEnvPage"));
const MarketEnvHistoryPage = lazy(() => import("./pages/MarketEnvHistoryPage"));
const IndexOverviewPage = lazy(() => import("./pages/IndexOverviewPage"));
const IndexComponentsPage = lazy(() => import("./pages/IndexComponentsPage"));
const AcademyBasicsPage = lazy(() => import("./pages/AcademyBasicsPage"));
const AcademyBooksPage = lazy(() => import("./pages/AcademyBooksPage"));

const ROUTE_PERM: Record<string, string> = {
  "/dashboard": "menu:dashboard",
  "/watchlist": "menu:watchlist",
  "/data/quotes": "menu:market-data:quotes",
  "/limit-ladder": "menu:limit-ladder",
  "/stock-analysis": "menu:stock-analysis",
  "/strategy": "menu:strategy",
  "/profile": "menu:profile",
  "/settings/data-sources": "menu:settings:data-source",
  "/admin/workbench/settings/ai": "menu:workbench:settings:ai",
  "/info/news-flash": "menu:info:news-flash",
  "/info/hot-search": "menu:info:hot-search",
  "/info/fund-flow": "menu:info:fund-flow",
  "/anomaly": "menu:anomaly:realtime",
  "/anomaly/rules": "menu:anomaly:rules",
  "/holdings": "menu:holdings:positions",
  "/holdings/alerts": "menu:holdings:alerts",
  "/simulation/account": "menu:simulation:account",
  "/simulation/orders": "menu:simulation:orders",
  "/review": "menu:review",
  "/admin/workbench/monitor": "menu:workbench:monitor",
  "/admin/workbench/students": "menu:workbench:students",
  "/admin/workbench/feedbacks": "menu:workbench:feedbacks",
  "/admin/workbench/settings/general": "menu:workbench:settings:general",
  "/system/permissions": "menu:system:permission",
  "/system/audit-logs": "menu:system:audit",
};

function Shell({ path, children }: { path: string; children: ReactNode }) {
  const { status, permissions, routePermissions, error, bootstrap } = useSession();
  const location = useLocation();

  if (status === "idle" || status === "loading") return <BootScreen />;
  if (status === "failed") {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-5 text-sm shadow-sm dark:border-amber-500/30 dark:bg-slate-900">
          <p className="font-semibold">连不上后端</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {error ?? "请求失败了"}—— 后端刚重启或者 8750 没起来时最常见，你的登录状态还在，恢复后直接重试就行。
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void bootstrap()}>重试</Button>
            <Button size="sm" variant="outline" onClick={() => {
              useSession.setState({ status: "anon", error: null });
            }}>去登录页</Button>
          </div>
        </div>
      </div>
    );
  }
  if (status === "anon") {
    return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />;
  }
  const needed = ROUTE_PERM[path] ?? routePermissions[path];
  if (needed && !permissions.includes(needed)) {
    return <Navigate to="/403" replace state={{ needed }} />;
  }
  return <Layout>{children}</Layout>;
}

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950">
      <div className="w-64 space-y-3">
        <div className="flex items-center gap-2">
          <Spinner />
          <span className="text-xs text-slate-500 dark:text-slate-400">正在读取登录状态与菜单…</span>
        </div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function Guarded({ path, children }: { path: string; children: ReactNode }) {
  return <Shell path={path}>{children}</Shell>;
}

export default function App() {
  const bootstrap = useSession((s) => s.bootstrap);
  const status = useSession((s) => s.status);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 后端恢复后不用手点，自动重连
  useEffect(() => {
    if (status !== "failed") return;
    const timer = window.setInterval(() => void bootstrap(), 15_000);
    return () => window.clearInterval(timer);
  }, [status, bootstrap]);

  useEffect(() => {
    const onUnauthorized = () => {
      useSession.setState({ status: "anon", user: null, permissions: [], menuTree: [] });
    };
    window.addEventListener("qoder:unauthorized", onUnauthorized);
    return () => window.removeEventListener("qoder:unauthorized", onUnauthorized);
  }, []);

  return (
    <>
      <Suspense fallback={<BootScreen />}>
        <Routes>
          <Route path="/login" element={status === "ready" ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<WelcomePage />} />
          <Route path="/dashboard" element={<Guarded path="/dashboard"><DashboardPage /></Guarded>} />
          <Route path="/watchlist" element={<Guarded path="/watchlist"><WatchlistPage /></Guarded>} />
          <Route path="/data/quotes" element={<Guarded path="/data/quotes"><QuotesPage /></Guarded>} />
          <Route path="/limit-ladder" element={<Guarded path="/limit-ladder"><LimitLadderPage /></Guarded>} />
          <Route path="/stock-analysis" element={<Guarded path="/stock-analysis"><StockAnalysisPage /></Guarded>} />
          <Route path="/stock-analysis/:symbol" element={<Guarded path="/stock-analysis"><StockAnalysisPage /></Guarded>} />
          <Route path="/strategy" element={<Guarded path="/strategy"><StrategyListPage /></Guarded>} />
          <Route path="/strategy/:sid" element={<Guarded path="/strategy"><StrategyDetailPage /></Guarded>} />
          <Route path="/profile" element={<Guarded path="/profile"><ProfilePage /></Guarded>} />
          <Route path="/settings/data-sources" element={<Guarded path="/settings/data-sources"><DataSourceMatrixPage /></Guarded>} />
          <Route path="/info/news-flash" element={<Guarded path="/info/news-flash"><InfoNewsFlashPage /></Guarded>} />
          <Route path="/info/hot-search" element={<Guarded path="/info/hot-search"><InfoHotSearchPage /></Guarded>} />
          <Route path="/info/fund-flow" element={<Guarded path="/info/fund-flow"><InfoFundFlowPage /></Guarded>} />
          <Route path="/anomaly" element={<Guarded path="/anomaly"><AnomalyEventsPage /></Guarded>} />
          <Route path="/anomaly/rules" element={<Guarded path="/anomaly/rules"><AnomalyRulesPage /></Guarded>} />
          <Route path="/holdings" element={<Guarded path="/holdings"><HoldingsPage /></Guarded>} />
          <Route path="/holdings/alerts" element={<Guarded path="/holdings/alerts"><HoldingsAlertsPage /></Guarded>} />
          <Route path="/simulation/account" element={<Guarded path="/simulation/account"><SimulationAccountPage /></Guarded>} />
          <Route path="/simulation/orders" element={<Guarded path="/simulation/orders"><SimulationOrdersPage /></Guarded>} />
          <Route path="/review" element={<Guarded path="/review"><ReviewPage /></Guarded>} />
          <Route path="/admin/workbench/settings/ai" element={<Guarded path="/admin/workbench/settings/ai"><AiSettingsPage /></Guarded>} />
          <Route path="/admin/workbench/monitor" element={<Guarded path="/admin/workbench/monitor"><MonitorPage /></Guarded>} />
          <Route path="/admin/workbench/students" element={<Guarded path="/admin/workbench/students"><StudentsPage /></Guarded>} />
          <Route path="/admin/workbench/feedbacks" element={<Guarded path="/admin/workbench/feedbacks"><FeedbacksPage /></Guarded>} />
          <Route path="/admin/workbench/settings/general" element={<Guarded path="/admin/workbench/settings/general"><GeneralSettingsPage /></Guarded>} />
          <Route path="/system/permissions" element={<Guarded path="/system/permissions"><SystemPermissionsPage /></Guarded>} />
          <Route path="/system/audit-logs" element={<Guarded path="/system/audit-logs"><AuditLogsPage /></Guarded>} />
          <Route path="/global-index" element={<Guarded path="/global-index"><GlobalIndexPage /></Guarded>} />
          <Route path="/oil-gold" element={<Guarded path="/oil-gold"><OilGoldPage /></Guarded>} />
          <Route path="/concept-analysis" element={<Guarded path="/concept-analysis"><BoardAnalysisPage kind="concept" /></Guarded>} />
          <Route path="/industry-analysis" element={<Guarded path="/industry-analysis"><BoardAnalysisPage kind="industry" /></Guarded>} />
          <Route path="/merger-restructuring" element={<Guarded path="/merger-restructuring"><MergerPage /></Guarded>} />
          <Route path="/data/fundamentals" element={<Guarded path="/data/fundamentals"><FundamentalsPage /></Guarded>} />
          <Route path="/finance/statements" element={<Guarded path="/finance/statements"><FinanceStatementsPage /></Guarded>} />
          <Route path="/finance/indicators" element={<Guarded path="/finance/indicators"><FinanceIndicatorsPage /></Guarded>} />
          <Route path="/market-env" element={<Guarded path="/market-env"><MarketEnvPage /></Guarded>} />
          <Route path="/market-env/history" element={<Guarded path="/market-env/history"><MarketEnvHistoryPage /></Guarded>} />
          <Route path="/index" element={<Guarded path="/index"><IndexOverviewPage /></Guarded>} />
          <Route path="/index/components" element={<Guarded path="/index/components"><IndexComponentsPage /></Guarded>} />
          <Route path="/academy/basics" element={<Guarded path="/academy/basics"><AcademyBasicsPage /></Guarded>} />
          <Route path="/academy/books" element={<Guarded path="/academy/books"><AcademyBooksPage /></Guarded>} />
          <Route path="/development" element={<Guarded path="/development"><ComingSoonPage /></Guarded>} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
