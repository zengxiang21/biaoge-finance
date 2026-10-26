"""权限码目录 + 角色授权 + 导航菜单树（对应拆解文档 3.1.3 / 2.2）"""
from __future__ import annotations

MENU_PERMISSIONS = [
    "menu:dashboard", "menu:watchlist", "menu:stock-analysis", "menu:oil-gold",
    "menu:limit-ladder", "menu:concept-analysis", "menu:industry-analysis",
    "menu:anomaly:realtime", "menu:anomaly:rules", "menu:holdings:positions",
    "menu:holdings:alerts", "menu:simulation:account", "menu:simulation:orders",
    "menu:review", "menu:academy:basics", "menu:academy:books",
    "menu:info:news-flash", "menu:info:hot-search", "menu:info:fund-flow",
    "menu:global-index", "menu:merger", "menu:strategy", "menu:profile",
    "menu:market-data:quotes", "menu:market-data:fundamentals",
    "menu:finance:statements", "menu:finance:indicators",
    "menu:market-env:overview", "menu:market-env:history",
    "menu:index:overview", "menu:index:components",
    "menu:settings:data-source", "menu:workbench:monitor",
    "menu:workbench:students", "menu:workbench:feedbacks",
    "menu:workbench:settings:general", "menu:workbench:settings:ai",
    "menu:system:permission", "menu:system:audit",
]

OPERATION_PERMISSIONS = [
    "watchlist:item_create", "watchlist:item_delete",
    "strategy:create", "strategy:update", "strategy:manage", "strategy:delete", "strategy:run",
    "review:view", "review:generate", "review:delete", "review:schedule",
    "anomaly:view", "holdings:view", "holdings:manage",
    "limit-ladder:view", "info:view", "global-index:view", "merger:view",
    "simulation:view", "simulation:trade", "academy:view",
    "settings:general:update", "settings:ai:update", "settings:ai:test",
    "market-data:view", "dashboard:view", "system:data-source:update",
]

ALL_PERMISSIONS = MENU_PERMISSIONS + OPERATION_PERMISSIONS

# 路由级守卫用：路径 -> 权限码
ROUTE_PERMISSIONS: dict[str, str] = {
    "/dashboard": "menu:dashboard",
    "/profile": "menu:profile",
    "/watchlist": "menu:watchlist",
    "/stock-analysis": "menu:stock-analysis",
    "/concept-analysis": "menu:concept-analysis",
    "/industry-analysis": "menu:industry-analysis",
    "/oil-gold": "menu:oil-gold",
    "/global-index": "menu:global-index",
    "/merger-restructuring": "menu:merger",
    "/limit-ladder": "menu:limit-ladder",
    "/strategy": "menu:strategy",
    "/review": "menu:review",
    "/academy/basics": "menu:academy:basics",
    "/academy/books": "menu:academy:books",
    "/info/news-flash": "menu:info:news-flash",
    "/info/hot-search": "menu:info:hot-search",
    "/info/fund-flow": "menu:info:fund-flow",
    "/anomaly": "menu:anomaly:realtime",
    "/anomaly/rules": "menu:anomaly:rules",
    "/holdings": "menu:holdings:positions",
    "/holdings/alerts": "menu:holdings:alerts",
    "/simulation/account": "menu:simulation:account",
    "/simulation/orders": "menu:simulation:orders",
    "/data/quotes": "menu:market-data:quotes",
    "/data/fundamentals": "menu:market-data:fundamentals",
    "/finance/statements": "menu:finance:statements",
    "/finance/indicators": "menu:finance:indicators",
    "/market-env": "menu:market-env:overview",
    "/market-env/history": "menu:market-env:history",
    "/index": "menu:index:overview",
    "/index/components": "menu:index:components",
    "/settings/data-sources": "menu:settings:data-source",
    "/admin/workbench/monitor": "menu:workbench:monitor",
    "/admin/workbench/students": "menu:workbench:students",
    "/admin/workbench/feedbacks": "menu:workbench:feedbacks",
    "/admin/workbench/settings/general": "menu:workbench:settings:general",
    "/admin/workbench/settings/ai": "menu:workbench:settings:ai",
    "/system/permissions": "menu:system:permission",
    "/system/audit-logs": "menu:system:audit",
}

# 导航分组（文档 2.2）；built=false 表示本轮 P0 尚未实现，菜单里标记为待开发
NAV_GROUPS: list[dict] = [
    {"key": "core", "label": "看盘核心", "items": [
        {"path": "/dashboard", "label": "仪表盘", "perm": "menu:dashboard", "built": True},
        {"path": "/watchlist", "label": "自选股", "perm": "menu:watchlist", "built": True},
        {"path": "/stock-analysis", "label": "股票分析", "perm": "menu:stock-analysis", "built": True},
        {"path": "/limit-ladder", "label": "涨停梯队", "perm": "menu:limit-ladder", "built": True},
    ]},
    {"key": "research", "label": "投研分析", "items": [
        {"path": "/concept-analysis", "label": "概念分析", "perm": "menu:concept-analysis", "built": True},
        {"path": "/industry-analysis", "label": "行业分析", "perm": "menu:industry-analysis", "built": True},
        {"path": "/global-index", "label": "全球指数", "perm": "menu:global-index", "built": True},
        {"path": "/oil-gold", "label": "原油黄金", "perm": "menu:oil-gold", "built": True},
        {"path": "/merger-restructuring", "label": "并购重组", "perm": "menu:merger", "built": True},
    ]},
    {"key": "strategy", "label": "策略与选股", "items": [
        {"path": "/strategy", "label": "策略列表", "perm": "menu:strategy", "built": True},
    ]},
    {"key": "position", "label": "持仓与模拟", "items": [
        {"path": "/holdings", "label": "持仓管理", "perm": "menu:holdings:positions", "built": True},
        {"path": "/holdings/alerts", "label": "持仓提醒", "perm": "menu:holdings:alerts", "built": True},
        {"path": "/simulation/account", "label": "模拟账户", "perm": "menu:simulation:account", "built": True},
        {"path": "/simulation/orders", "label": "模拟订单", "perm": "menu:simulation:orders", "built": True},
    ]},
    {"key": "info", "label": "资讯中心", "items": [
        {"path": "/info/news-flash", "label": "快讯", "perm": "menu:info:news-flash", "built": True},
        {"path": "/info/hot-search", "label": "热搜", "perm": "menu:info:hot-search", "built": True},
        {"path": "/info/fund-flow", "label": "资金流", "perm": "menu:info:fund-flow", "built": True},
    ]},
    {"key": "anomaly", "label": "异常监控", "items": [
        {"path": "/anomaly", "label": "实时异常", "perm": "menu:anomaly:realtime", "built": True},
        {"path": "/anomaly/rules", "label": "异常规则", "perm": "menu:anomaly:rules", "built": True},
    ]},
    {"key": "review", "label": "复盘", "items": [
        {"path": "/review", "label": "每日复盘", "perm": "menu:review", "built": True},
    ]},
    {"key": "academy", "label": "投资学堂", "items": [
        {"path": "/academy/basics", "label": "看盘基础", "perm": "menu:academy:basics", "built": True},
        {"path": "/academy/books", "label": "推荐书籍", "perm": "menu:academy:books", "built": True},
    ]},
    {"key": "data", "label": "市场数据", "items": [
        {"path": "/data/quotes", "label": "行情数据", "perm": "menu:market-data:quotes", "built": True},
        {"path": "/data/fundamentals", "label": "基础数据", "perm": "menu:market-data:fundamentals", "built": True},
        {"path": "/finance/statements", "label": "财务报表", "perm": "menu:finance:statements", "built": True},
        {"path": "/finance/indicators", "label": "财务指标", "perm": "menu:finance:indicators", "built": True},
    ]},
    {"key": "market", "label": "市场与指数", "items": [
        {"path": "/market-env", "label": "市场环境", "perm": "menu:market-env:overview", "built": True},
        {"path": "/market-env/history", "label": "环境历史", "perm": "menu:market-env:history", "built": True},
        {"path": "/index", "label": "指数概览", "perm": "menu:index:overview", "built": True},
        {"path": "/index/components", "label": "指数成分", "perm": "menu:index:components", "built": True},
    ]},
    {"key": "system", "label": "系统管理", "items": [
        {"path": "/settings/data-sources", "label": "数据源矩阵", "perm": "menu:settings:data-source", "built": True},
        {"path": "/admin/workbench/monitor", "label": "全局监控", "perm": "menu:workbench:monitor", "built": True},
        {"path": "/admin/workbench/students", "label": "学员管理", "perm": "menu:workbench:students", "built": True},
        {"path": "/admin/workbench/feedbacks", "label": "反馈管理", "perm": "menu:workbench:feedbacks", "built": True},
        {"path": "/admin/workbench/settings/general", "label": "通用设置", "perm": "menu:workbench:settings:general", "built": True},
        {"path": "/admin/workbench/settings/ai", "label": "AI 设置", "perm": "menu:workbench:settings:ai", "built": True},
        {"path": "/system/permissions", "label": "角色权限", "perm": "menu:system:permission", "built": True},
        {"path": "/system/audit-logs", "label": "审计日志", "perm": "menu:system:audit", "built": True},
    ]},
    {"key": "me", "label": "个人中心", "items": [
        {"path": "/profile", "label": "个人资料", "perm": "menu:profile", "built": True},
    ]},
]

USER_PERMS = [
    "menu:dashboard", "menu:watchlist", "menu:profile", "menu:market-data:quotes",
    "menu:stock-analysis", "menu:limit-ladder", "menu:concept-analysis",
    "menu:industry-analysis", "menu:global-index", "menu:oil-gold", "menu:merger",
    "menu:strategy", "menu:review", "menu:academy:basics", "menu:academy:books",
    "menu:info:news-flash", "menu:info:hot-search", "menu:info:fund-flow",
    "menu:anomaly:realtime", "menu:anomaly:rules",
    "menu:holdings:positions", "menu:holdings:alerts",
    "menu:simulation:account", "menu:simulation:orders",
    "menu:market-data:fundamentals", "menu:finance:statements", "menu:finance:indicators",
    "menu:market-env:overview", "menu:market-env:history",
    "menu:index:overview", "menu:index:components",
    "watchlist:item_create", "watchlist:item_delete", "market-data:view",
    "dashboard:view", "limit-ladder:view", "info:view", "global-index:view", "merger:view",
    "strategy:create", "strategy:update", "strategy:delete", "strategy:run",
    "review:view", "review:generate",
    "anomaly:view", "holdings:view", "holdings:manage", "simulation:view", "simulation:trade",
    "academy:view",
]

ADMIN_PERMS = ALL_PERMISSIONS

ROLE_GRANTS: dict[str, list[str]] = {
    "user": USER_PERMS,
    "vip": USER_PERMS,          # 付费会员当前与普通用户同权（额度体系在第十二章，暂不实施）
    "admin": ADMIN_PERMS,
}

ROLE_LABELS = {"admin": "管理员", "vip": "付费会员", "user": "普通用户"}

EMOTION_BANDS = [
    (75, 101, "亢奋", "情绪过热，警惕高位股分歧与切换"),
    (60, 75, "活跃", "赚钱效应尚可，可跟随强势主线"),
    (45, 60, "温和", "结构性行情，控制仓位精选个股"),
    (30, 45, "低迷", "赚钱效应偏弱，等待情绪修复"),
    (0, 30, "冰点", "极致缩量或恐慌，留意超跌反弹"),
]


def emotion_label(score: float | None) -> dict:
    if score is None:
        return {"label": "待更新", "meaning": "等待收盘快照", "key": "pending"}
    # 区间左闭右开：0.1 分的精度差也不该掉进两档之间的缝隙
    v = min(100.0, max(0.0, float(score)))
    for lo, hi, label, meaning in EMOTION_BANDS:
        if lo <= v < hi:
            return {"label": label, "meaning": meaning, "key": label}
    return {"label": "亢奋", "meaning": EMOTION_BANDS[0][3], "key": "亢奋"}
