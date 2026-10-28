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
  high: number;
  low: number;
  /** 上游自己的行情时间 HH:MM:SS */
  at: string;
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

/** v_sh000001="1~上证指数~000001~3681.47~3648.30~...~20261028161400~33.17~0.91~3684.49~3652.37~..." */
function parseLine(line: string): LiveQuote | null {
  const m = /^v_([a-z]{2}\d{6})="([^"]*)"/.exec(line.trim());
  if (!m) return null;
  const f = m[2].split("~");
  if (f.length < 35) return null;
  const stamp = f[30] ?? "";
  return {
    symbol: m[1],
    name: f[1],
    price: num(f[3]),
    prevClose: num(f[4]),
    change: num(f[31]),
    changePercent: num(f[32]),
    high: num(f[33]),
    low: num(f[34]),
    at: stamp.length === 14 ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}` : stamp,
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
