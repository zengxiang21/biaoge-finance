import type { StrategyRow } from "./types";

/** 文档 3.5.17：策略列表用本地缓存展示上次命中数量 */
export const RUN_STATS_KEY = "tsp-saas.strategy.run-stats";

export function readRunStats(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RUN_STATS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj as Record<string, number> : {};
  } catch {
    return {};
  }
}

export function writeRunStats(stats: Record<string, number>) {
  try {
    localStorage.setItem(RUN_STATS_KEY, JSON.stringify(stats));
  } catch {
    /* 隐私模式下写不进去，不影响功能 */
  }
}

/** 类型芯片已经说清了身份就不再挂族芯片：自定义代码两者同名，叠加组合的「叠加」+「叠加组合」是一回事 */
export function familyChip(row: Pick<StrategyRow, "typeLabel" | "familyLabel">): string | null {
  if (row.familyLabel === row.typeLabel) return null;
  if (row.typeLabel === "叠加" && row.familyLabel === "叠加组合") return null;
  return row.familyLabel;
}

/** 文档 3.5.12：以上海时间判断交易时段，周末与 11:30-13:00 休市 */
export function shanghaiNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { weekday, minutes };
}

export function isTradingTime(date = new Date()) {
  const { weekday, minutes } = shanghaiNow(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return (minutes >= 565 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

export const BOARD_LABEL: Record<string, string> = {
  sh_main: "沪主板", sz_main: "深主板", chinext: "创业板", star: "科创板", bse: "北交所",
};

/** 运行前提示，和后端 _schedule_block 同一套口径，避免点了才报错 */
export function scheduleWarning(row: StrategyRow): string | null {
  const { weekday } = shanghaiNow();
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (row.run_time_type === "any") return null;
  if (weekend) return "周末休市，该策略需要交易时段数据，现在运行会被拦下";
  if (row.run_time_type === "intraday" && !isTradingTime()) {
    return "该策略依赖盘中数据，当前非交易时段无法运行，请于交易时段内尝试";
  }
  if (row.run_time_type === "after_hours" && isTradingTime()) {
    return "该策略为盘后分析策略，请于 15:00 后运行";
  }
  return null;
}

/** 文档 3.5.10 的进度文案 */
export function progressText(elapsedS: number) {
  if (elapsedS < 20) return "正在深度扫描全市场...";
  if (elapsedS < 40) return "数据量较大，正在极速计算中...";
  return "即将完成，请稍候...";
}

export function stars(n: number | null | undefined) {
  return n ? "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) : "";
}
