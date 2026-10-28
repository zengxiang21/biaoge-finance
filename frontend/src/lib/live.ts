/** 演示模式下的秒级报价：浏览器直连腾讯行情，不经过我们自己的后端。
 *
 * 选腾讯而不是新浪：新浪 hq.sinajs.cn 校验 Referer，跨域时浏览器不允许伪造那个头；
 * 腾讯 qt.gtimg.cn 实测回 `Access-Control-Allow-Origin: *`，Content-Type 自带
 * charset=GBK，fetch 直接就能解出中文名，报价本身约 3 秒一跳。
 * 这里只搬「价」这一个事实，估值分位、板块梯队这些算法仍然只有 Python 那一份。
 */

export type LiveQuote = {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  /** 上游自己的行情时间 HH:MM:SS */
  at: string;
  /** 上游行情日期 YYYY-MM-DD（与 at 配对，港美指数和 A 股共用一套字段） */
  date: string;
};

/** 大盘全景 / 行情数据页的默认一排：都是指数，代码前缀就是交易所 */
export const LIVE_INDEXES = [
  "sh000001", "sz399001", "sz399006", "sh000300",
  "sh000016", "sh000905", "sh000688", "sh000852",
];

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** A 股回 20261028161400 这种紧凑串，港/美指数回 "2026-10-28 11:54:40"（美东）或
 * "2026/10/28 18:31:23"（港时），统一拆成日期 + 时钟 */
function splitStamp(stamp: string): { date: string; time: string } {
  if (/^\d{14}$/.test(stamp)) {
    return {
      date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
      time: `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}`,
    };
  }
  const [d, t = ""] = stamp.split(" ");
  return { date: d ? d.replaceAll("/", "-") : "", time: t };
}

/** v_sh000001="1~上证指数~000001~3681.47~3648.30~...~20261028161400~33.17~0.91~3684.49~3652.37~..."
 *  v_usDJI ="200~道琼斯~.DJI~52523.36~52377.57~52335.43~...~2026-10-28 11:55:40~145.79~0.28~52562.60~52335.43~..."
 *  两套的字段位一致：3 现价、4 昨收、5 今开、30 报价时间、31/32 涨跌、33/34 最高最低 */
function parseLine(line: string): LiveQuote | null {
  // 变量名三种形态：sh000001 / usDJI / hkHSI（港美代码带大写字母、没有六位数字）
  const m = /^v_([a-z]{2}[A-Z]*\d*)="([^"]*)"/.exec(line.trim());
  if (!m) return null;
  const f = m[2].split("~");
  // 外汇是 310~ 的短格式：3 现价、5 时间、6 昨收、7 今开、8/9 高低、12/13 涨跌
  if (f[0] === "310") return parseWhLine(m[1], f);
  if (f.length < 35) return null;
  const price = num(f[3]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const stamp = f[30] ?? "";
  const { date, time } = splitStamp(stamp);
  return {
    symbol: m[1],
    name: f[1],
    price,
    prevClose: num(f[4]),
    change: num(f[31]),
    changePercent: num(f[32]),
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    at: time || stamp,
    date,
  };
}

/** v_whUSDX="310~美元指数~USDX~102.3500~0~20261029015644~102.3800~102.3800~102.4900~102.2100~~~-0.0300~-0.03~...~2026-10-28" */
function parseWhLine(symbol: string, f: string[]): LiveQuote | null {
  const price = num(f[3]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const { date, time } = splitStamp(f[5] ?? "");
  return {
    symbol,
    name: f[1],
    price,
    prevClose: num(f[6]),
    change: num(f[12]),
    changePercent: num(f[13]),
    open: num(f[7]),
    high: num(f[8]),
    low: num(f[9]),
    at: time,
    date: date || (f[21] ?? ""),
  };
}

export async function fetchLiveQuotes(symbols: string[] = LIVE_INDEXES): Promise<LiveQuote[]> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`https://qt.gtimg.cn/q=${symbols.join(",")}`, {
      signal: ctl.signal, cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // 腾讯回的是 GBK，response.text() 实测按 UTF-8 解，中文名会成乱码，自己解一遍
    const buf = new Uint8Array(await r.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }
    return text.split("\n")
      .map(parseLine)
      .filter((q): q is LiveQuote => !!q && Number.isFinite(q.price));
  } finally {
    window.clearTimeout(timer);
  }
}
