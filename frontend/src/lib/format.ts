/** 数字与日期本地化格式化（拆解文档 附录B / 10.11） */

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

/** 成交额/市值：元 -> 万/亿 */
export function money(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return `—${unit}`;
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}亿${unit}`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}万${unit}`;
  return `${v.toFixed(0)}${unit}`;
}

/** 已经是「亿」为单位的数值 */
export function yi(v: number | null | undefined, unit = "亿"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)}${unit}`;
}

export function price(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function clock(v: string | null | undefined): string {
  if (!v) return "—";
  const s = String(v).trim();
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  if (/^\d{4}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return s.slice(11, 16);
  return s;
}

/** 20261023 -> 2026-10-23 */
export function tradeDate(v: string | null | undefined): string {
  if (!v) return "—";
  const s = String(v).replace(/-/g, "");
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return String(v);
}

export function timeAgo(v: string | null | undefined): string {
  if (!v) return "从未";
  const t = new Date(v.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return v;
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}
