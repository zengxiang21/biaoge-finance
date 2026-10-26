import type { ReactNode } from "react";
import { cn } from "./ui";

/**
 * 线性图标：24×24 viewBox、stroke=currentColor，和 Lucide 同一套视觉规则。
 * 引第三方图标库会白加 200KB，这里只画用到的这些。
 */
const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.4" />
      <rect x="14" y="3" width="7" height="7" rx="1.4" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" />
      <rect x="14" y="14" width="7" height="7" rx="1.4" />
    </>
  ),
  star: <path d="M12 3.4l2.63 5.33 5.87.85-4.25 4.14 1 5.86L12 16.8l-5.25 2.78 1-5.86L2.5 9.58l5.87-.85L12 3.4z" />,
  candles: (
    <>
      <path d="M7 3v4M7 17v4M17 3v6M17 15v6" />
      <rect x="4.5" y="7" width="5" height="10" rx="1" />
      <rect x="14.5" y="9" width="5" height="6" rx="1" />
    </>
  ),
  ladder: <path d="M7 21V4M17 21V4M7 8h10M7 13h10M7 18h10" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="7" height="18" rx="1" />
      <rect x="13" y="8" width="7" height="13" rx="1" />
      <path d="M7 7h1M7 11h1M7 15h1M16 12h1M16 16h1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.9 5.7 3.9 9S14.6 18.4 12 21c-2.6-2.6-3.9-5.7-3.9-9S9.4 5.6 12 3z" />
    </>
  ),
  flame: <path d="M12 3s5 4.2 5 8.5a5 5 0 0 1-10 0C7 9 9 8 9.5 6c1.3 1 2.5 1.8 2.5 3.2 0-2.2 0-4.4 0-6.2z" />,
  merge: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7M8.5 6h3.5a4 4 0 0 1 4 4v1.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14h2" />
    </>
  ),
  bell: <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6zM10 19a2 2 0 0 0 4 0" />,
  beaker: <path d="M9 3h6M10 3v6l-5 8.5A2 2 0 0 0 6.7 21h10.6a2 2 0 0 0 1.7-3.5L14 9V3" />,
  news: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h6M7 13h10M7 16h4" />
    </>
  ),
  hot: (
    <>
      <path d="M4 17l5-6 4 3 6-8" />
      <path d="M15 6h5v5" />
    </>
  ),
  flow: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  alert: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  sliders: <path d="M4 7h11M18 7h2M4 17h4M11 17h9M15 4v6M8 14v6" />,
  review: <path d="M4 12a8 8 0 1 1 3 6.2M4 12H2m2 0 .3-2.4M8 12l4-4v8l-4-4z" />,
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5z" />
      <path d="M8 7h7M8 11h7" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="4" width="5" height="16" rx="1" />
      <rect x="10.5" y="4" width="5" height="16" rx="1" />
      <path d="M17.5 6l3 .8-3.4 13.4-3-.8" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 9v11" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 4.8M17.5 20a5.6 5.6 0 0 0-2-4.3" />
    </>
  ),
  spark: <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18 16l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M16 9l-3 3 3 3" />
    </>
  ),
  expand: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M14 9l3 3-3 3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.7-6M20 4v5h-5" />,
  logout: <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 8l4 4-4 4M19 12H9" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  play: <path d="M8 5l11 7-11 7V5z" />,
  save: (
    <>
      <path d="M5 3h11l3 3v15H5V3z" />
      <path d="M8 3v6h7V3M8 15h8" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 13l4 4L19 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </>
  ),
  plug: <path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0V9zM12 18v3" />,
  dot: <circle cx="12" cy="12" r="3" />,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", className)}>
      {PATHS[name] ?? PATHS.dot}
    </svg>
  );
}

/** 导航按 path 取图标，取不到退回分组图标 */
const NAV_ICON: Record<string, string> = {
  "/dashboard": "dashboard",
  "/watchlist": "star",
  "/stock-analysis": "candles",
  "/limit-ladder": "ladder",
  "/concept-analysis": "compass",
  "/industry-analysis": "building",
  "/global-index": "globe",
  "/oil-gold": "flame",
  "/merger-restructuring": "merge",
  "/strategy": "target",
  "/holdings": "wallet",
  "/holdings/alerts": "bell",
  "/simulation/account": "beaker",
  "/simulation/orders": "table",
  "/info/news-flash": "news",
  "/info/hot-search": "hot",
  "/info/fund-flow": "flow",
  "/anomaly": "alert",
  "/anomaly/rules": "sliders",
  "/review": "review",
  "/academy/basics": "book",
  "/academy/books": "library",
  "/data/quotes": "table",
  "/data/fundamentals": "database",
  "/settings/data-sources": "plug",
  "/admin/workbench/monitor": "monitor",
  "/admin/workbench/students": "users",
  "/admin/workbench/feedbacks": "info",
  "/admin/workbench/settings/general": "sliders",
  "/admin/workbench/settings/ai": "spark",
  "/system/permissions": "users",
  "/system/audit-logs": "table",
  "/profile": "user",
};

const GROUP_ICON: Record<string, string> = {
  core: "dashboard", research: "compass", strategy: "target", position: "wallet",
  info: "news", anomaly: "alert", review: "review", academy: "book",
  data: "database", system: "sliders", me: "user",
};

export function navIcon(path: string, groupKey: string): string {
  if (NAV_ICON[path]) return NAV_ICON[path];
  const prefix = Object.keys(NAV_ICON).find((p) => path.startsWith(`${p}/`));
  return prefix ?? GROUP_ICON[groupKey] ?? "dot";
}
