/** 「全球指数」页的实时覆盖：浏览器直连腾讯 + 东财行情，把冻结快照上的价格刷新。
 *
 * 根因：Pages 上的 payload 是 Actions 在 runner 现抓后冻结的 JSON，理论延迟 30 分钟，
 * 实际 GitHub 定时触发经常延迟甚至整槽跳过（2026-10-28 当天盘中每半小时的槽全没响），
 * 页面会停在几小时前。本机服务有真后端所以是实时的；静态站能做的等价物，
 * 就是让浏览器直连公开行情源把「价」这一个事实搬到页面上（同 lib/live.ts 的思路）。
 *
 * 分工（2026-10-28 实测）：
 *  - 腾讯 qt.gtimg.cn：美股三大指数 usDJI/usIXIC/usINX、恒生 hkHSI、A 股指数，回 CORS *，GBK；
 *  - 东财 push2 ulist：补腾讯没有的日经225/英国富时100/美元指数/离岸人民币，也回 CORS *，
 *    数据中心 IP 对它限流很凶，浏览器端通常没问题，失败就保留上一轮或快照值；
 *  - VIX（腾讯给的是 9 月的死数）、富时A50期货、CBOE 序列没有可靠的直连源，保持快照。
 */
import { fetchLiveQuotes, LIVE_INDEXES, type LiveQuote } from "./live";
import type { GlobalIndexResult, GlobalQuote, IndexQuote } from "./types";

/** 后端全球行情的行代码（app/providers/sina.py GLOBAL_INDEXES）→ 腾讯代码 */
const TENCENT_OF: Record<string, string> = {
  "gb_$dji": "usDJI",
  "gb_$ixic": "usIXIC",
  "gb_$inx": "usINX",
  rt_hkHSI: "hkHSI",
  int_hangseng: "hkHSI",
};

/** 腾讯没有的外围标的 → 东财 secid（市场.代码） */
const EM_OF: Record<string, string> = {
  int_nikkei: "100.N225",
  int_ftse: "100.FTSE",
  DINIW: "100.UDI",
  fx_susdcnh: "133.USDCNH",
};

export type LivePatch = {
  price: number;
  change_price: number | null;
  change_percent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  date: string;
  time: string;
};

export type GlobalLive = {
  /** 这一跳的墙钟时间 HH:MM:SS，页面上当「最近一跳」展示 */
  at: string;
  /** 全球行情行代码 → 实时报价 */
  quotes: Record<string, LivePatch>;
  /** A 股对照的 symbol（sh000001…）→ 实时报价 */
  aShare: Record<string, LivePatch>;
};

const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** 东财的空值是 "-"，价格类字段按 f1 的位数缩放 */
function emNum(v: unknown, scale = 1): number | null {
  if (v === undefined || v === null || v === "-") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x / scale : null;
}

function beijingStamp(ts: number): { date: string; time: string } {
  if (!Number.isFinite(ts) || ts <= 0) return { date: "", time: "" };
  const dt = new Date(ts * 1000);
  return {
    date: dt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }).replaceAll("/", "-"),
    time: dt.toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
  };
}

async function fetchEastmoney(secids: string[]): Promise<Record<string, LivePatch>> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids.join(",")}`
        + `&fields=f1,f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124&_=${Date.now()}`,
      { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as { data?: { diff?: Record<string, unknown>[] } };
    const diff = j?.data?.diff;
    if (!Array.isArray(diff)) return {};
    const out: Record<string, LivePatch> = {};
    for (const d of diff) {
      const digits = Number(d.f1);
      const price = emNum(d.f2, 10 ** digits);
      if (digits < 0 || price === null || price <= 0) continue;
      const { date, time } = beijingStamp(Number(d.f124));
      out[`${String(d.f13)}.${String(d.f12)}`] = {
        price,
        change_price: emNum(d.f4, 10 ** digits),
        change_percent: emNum(d.f3, 100),
        open: emNum(d.f17, 10 ** digits),
        high: emNum(d.f15, 10 ** digits),
        low: emNum(d.f16, 10 ** digits),
        prev_close: emNum(d.f18, 10 ** digits),
        date, time,
      };
    }
    return out;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 东财这一源限流风险高、标的是慢变量（日经/富时/汇率），30 秒一轮足够；
 *  拉失败沿用上一轮，不把整页清空 */
let emCache: Record<string, LivePatch> = {};
let emFetchedAt = 0;
const EM_TTL_MS = 30_000;

function patchOf(q: LiveQuote): LivePatch {
  return {
    price: q.price,
    change_price: fin(q.change),
    change_percent: fin(q.changePercent),
    open: fin(q.open),
    high: fin(q.high),
    low: fin(q.low),
    prev_close: fin(q.prevClose),
    date: q.date,
    time: q.at,
  };
}

export async function fetchGlobalLive(aShareSymbols: string[] = LIVE_INDEXES): Promise<GlobalLive> {
  const symbols = [...new Set([...Object.values(TENCENT_OF), ...aShareSymbols])];
  const wantEm = Date.now() - emFetchedAt >= EM_TTL_MS;
  const [tencent, em] = await Promise.allSettled([
    fetchLiveQuotes(symbols),
    wantEm ? fetchEastmoney(Object.values(EM_OF)) : Promise.resolve(null),
  ]);
  if (wantEm && em.status === "fulfilled" && em.value) {
    emCache = em.value;
    emFetchedAt = Date.now();
  }

  const quotes: Record<string, LivePatch> = {};
  const aShare: Record<string, LivePatch> = {};
  if (tencent.status === "fulfilled") {
    const bySym = new Map(tencent.value.map((q) => [q.symbol, q]));
    for (const [code, sym] of Object.entries(TENCENT_OF)) {
      const q = bySym.get(sym);
      if (q) quotes[code] = patchOf(q);
    }
    for (const sym of aShareSymbols) {
      const q = bySym.get(sym);
      if (q) aShare[sym] = patchOf(q);
    }
  }
  for (const [code, secid] of Object.entries(EM_OF)) {
    const p = emCache[secid];
    if (p) quotes[code] = p;
  }
  return { at: new Date().toTimeString().slice(0, 8), quotes, aShare };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** 把实时报价盖到 payload 上：rows / groups / aShare / riskOn 跟着刷新，
 *  fear、emotion、errors、note 保持快照口径。纯函数，方便按状态推导渲染。 */
export function applyLive(data: GlobalIndexResult, live: GlobalLive | null): GlobalIndexResult {
  if (!live) return data;
  const patchQuote = <T extends GlobalQuote>(r: T): T => {
    const p = live.quotes[r.code];
    return p ? { ...r, ...p } : r;
  };
  const groups = data.groups.map((g) => {
    const rows = g.rows.map(patchQuote);
    rows.sort((a, b) => ((a.change_percent === null) !== (b.change_percent === null)
      ? (a.change_percent === null ? 1 : -1)
      : (b.change_percent ?? 0) - (a.change_percent ?? 0)));
    const vals = rows.map((r) => r.change_percent).filter((v): v is number => v !== null);
    return { ...g, rows, avgChange: vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null };
  });
  const aShare = data.aShare.map((q): IndexQuote => {
    const p = live.aShare[q.symbol];
    // IndexQuote 的数值字段不可空，腾讯这跳字段不全就整行保留快照
    if (!p || p.change_price === null || p.change_percent === null
      || p.open === null || p.high === null || p.low === null || p.prev_close === null) return q;
    return { ...q, price: p.price, change_price: p.change_price, change_percent: p.change_percent,
      open: p.open, high: p.high, low: p.low, prev_close: p.prev_close,
      date: p.date || q.date, time: p.time || q.time };
  });
  const vals = groups.flatMap((g) => g.rows.map((r) => r.change_percent))
    .filter((v): v is number => v !== null);
  return {
    ...data,
    groups,
    rows: data.rows.map(patchQuote),
    aShare,
    riskOn: vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : data.riskOn,
  };
}
