/** 涨跌色系常量（拆解文档 3.2 前端常量表）—— 红涨绿跌，与美国市场相反 */
export type Dir = "up" | "down" | "flat";

export const TONE: Record<
  Dir,
  { text: string; chip: string; solid: string; stroke: string; fill: string; ring: string }
> = {
  up: {
    text: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    solid: "bg-rose-500",
    stroke: "stroke-rose-500",
    fill: "fill-rose-500/10",
    ring: "ring-rose-500/30",
  },
  down: {
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    solid: "bg-emerald-500",
    stroke: "stroke-emerald-500",
    fill: "fill-emerald-500/10",
    ring: "ring-emerald-500/30",
  },
  flat: {
    text: "text-slate-500 dark:text-slate-400",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    solid: "bg-slate-300 dark:bg-slate-600",
    stroke: "stroke-slate-400",
    fill: "fill-slate-400/10",
    ring: "ring-slate-400/30",
  },
};

export function dirOf(v: number | null | undefined): Dir {
  if (v === null || v === undefined || Number.isNaN(v)) return "flat";
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "flat";
}

/** 情绪分档配色：与后端 emotion_label 的 key 对应 */
export const EMOTION_TONE: Record<string, string> = {
  亢奋: "bg-rose-500",
  活跃: "bg-orange-500",
  温和: "bg-amber-400",
  低迷: "bg-sky-500",
  冰点: "bg-indigo-600",
  待更新: "bg-slate-300 dark:bg-slate-600",
  pending: "bg-slate-300 dark:bg-slate-600",
};
