import { useLocation, Link } from "react-router-dom";
import { Chip } from "../components/ui";

/** 侧边栏里 built=false 的入口统一落到这里，避免点了没反应 */
export default function ComingSoonPage() {
  const to = new URLSearchParams(useLocation().search).get("to") ?? "";
  const label = {
    "/stock-analysis": "股票分析（K线 + 技术面 + AI 诊断）",
    "/limit-ladder": "涨停梯队",
    "/concept-analysis": "概念分析",
    "/industry-analysis": "行业分析",
    "/global-index": "全球指数",
    "/oil-gold": "原油黄金",
    "/merger-restructuring": "并购重组",
    "/strategy": "策略引擎",
    "/holdings": "持仓管理",
    "/holdings/alerts": "持仓提醒",
    "/simulation/account": "模拟账户",
    "/simulation/orders": "模拟订单",
    "/info/news-flash": "资讯-快讯",
    "/info/hot-search": "资讯-热搜",
    "/info/fund-flow": "资讯-资金流",
    "/anomaly": "异常监控",
    "/anomaly/rules": "异常规则",
    "/review": "每日复盘",
    "/academy/basics": "学院-看盘基础",
    "/academy/books": "学院-推荐书籍",
    "/data/fundamentals": "基础数据",
    "/admin/workbench/monitor": "管理工作台-全局监控",
    "/admin/workbench/students": "学员管理",
  }[to] ?? (to.replace(/^\//, "") || "该模块");

  return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      <p className="text-4xl">🚧</p>
      <h1 className="mt-3 text-lg font-semibold">{label}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        本轮按拆解文档只做 P0 核心底座（认证 / 仪表盘 / 自选股 / 行情数据 / 数据源框架）。
        这个模块的路由和权限码已经建好，页面还没实现。
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Chip tone="slate">目标路由 {to || "未指定"}</Chip>
        <Chip tone="sky">权限码已在后端登记</Chip>
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <Link to="/dashboard" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-900">
          回仪表盘
        </Link>
        <Link to="/profile" className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">
          看已实现范围
        </Link>
      </div>
    </div>
  );
}
