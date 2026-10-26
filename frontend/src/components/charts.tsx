import { useId, useMemo, useState } from "react";
import { cn } from "./ui";

export type Dim = { label: string; score: number | null; weight: number; key: string };

/** 六维情绪雷达：纯 SVG，无第三方图表库 */
export function EmotionRadar({
  dims, score, size = 190,
}: { dims: Dim[]; score: number | null; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const n = dims.length;

  const point = (i: number, radius: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const poly = dims
    .map((d, i) => point(i, (Math.max(0, Math.min(100, d.score ?? 0)) / 100) * r))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <svg width={size} height={size} className="overflow-visible">
      {rings.map((k) => (
        <polygon
          key={k}
          points={dims.map((_, i) => point(i, r * k).map((v) => v.toFixed(1)).join(",")).join(" ")}
          className="fill-none stroke-slate-200 dark:stroke-slate-700"
          strokeWidth={1}
        />
      ))}
      {dims.map((_, i) => {
        const [x, y] = point(i, r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y}
          className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />;
      })}
      {dims.every((d) => d.score === null) ? null : (
        <polygon points={poly} className="fill-rose-500/15 stroke-rose-500" strokeWidth={1.6} />
      )}
      {dims.map((d, i) => {
        const [x, y] = point(i, (Math.max(0, Math.min(100, d.score ?? 0)) / 100) * r);
        if (d.score === null) return null;
        return <circle key={d.key} cx={x} cy={y} r={2.6} className="fill-rose-500" />;
      })}
      {dims.map((d, i) => {
        const [x, y] = point(i, r + 15);
        return (
          <text key={d.key} x={x} y={y} textAnchor={x > cx ? "start" : x < cx ? "end" : "middle"}
            dominantBaseline="middle"
            className="fill-slate-500 text-[10px] dark:fill-slate-400">
            {d.label}
            <tspan className="fill-slate-400 dark:fill-slate-500"> {d.score ?? "—"}</tspan>
          </text>
        );
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-800 text-lg font-semibold dark:fill-slate-100">
        {score === null ? "—" : score.toFixed(1)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400 text-[10px] dark:fill-slate-500">
        综合情绪分
      </text>
    </svg>
  );
}

/** 分时折线（红涨绿跌，以昨收为基线）：可叠加均价线与单分钟量柱 */
export function IntradayLine({
  points, prevClose, height = 150, className, showVolume = true,
}: {
  points: { t: string; price: number; avg?: number | null; volume?: number | null }[];
  prevClose?: number | null;
  height?: number;
  className?: string;
  showVolume?: boolean;
}) {
  const W = 600;
  const H = height;
  const volH = showVolume ? 26 : 0;
  const pad = { l: 4, r: 4, t: 8, b: 16 + volH };

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const prices = points.map((p) => p.price);
    const avgs = points.map((p) => p.avg ?? null);
    const vols = points.map((p) => p.volume ?? 0);
    const base = prevClose ?? prices[0];
    let min = Math.min(...prices, base);
    let max = Math.max(...prices, base);
    if (max === min) {
      max += 1;
      min -= 1;
    }
    const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    const avgD = (() => {
      let started = false;
      return avgs.map((a, i) => {
        if (a === null) return "";
        const cmd = started ? "L" : "M";
        started = true;
        return `${cmd}${x(i).toFixed(1)},${y(a).toFixed(1)}`;
      }).join(" ");
    })();
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
    const last = prices[prices.length - 1];
    const vmax = Math.max(1, ...vols);
    const bars = vols.map((v, i) => ({
      x: x(i) - Math.max(1, (W - pad.l - pad.r) / points.length / 2 - 0.6),
      w: Math.max(1.2, (W - pad.l - pad.r) / points.length - 1.2),
      h: (v / vmax) * volH,
      up: i === 0 ? true : prices[i] >= prices[i - 1],
    }));
    return {
      line, area, avgD: avgD.includes("M") ? avgD : "", baseY: y(base), lastY: y(last), min, max,
      up: last >= base, x0: x(0), x1: x(points.length - 1), bars, volTop: H - pad.b,
    };
  }, [points, prevClose, H, pad.b, volH]);

  if (!geo) {
    return (
      <div className="flex h-[150px] items-center justify-center text-xs text-slate-400">
        暂无分时数据（休市时段用最近交易日收盘数据）
      </div>
    );
  }
  const stroke = geo.up ? "stroke-rose-500" : "stroke-emerald-500";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id="intraday-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={geo.up ? "rgb(244,63,94)" : "rgb(16,185,129)"} stopOpacity="0.20" />
          <stop offset="100%" stopColor={geo.up ? "rgb(244,63,94)" : "rgb(16,185,129)"} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={geo.x0} y1={geo.baseY} x2={geo.x1} y2={geo.baseY}
        className="stroke-slate-300 dark:stroke-slate-600" strokeDasharray="4 3" strokeWidth={1} />
      <path d={geo.area} fill="url(#intraday-fill)" />
      <path d={geo.line} className={stroke} fill="none" strokeWidth={1.6} strokeLinejoin="round" />
      {geo.avgD && (
        <path d={geo.avgD} className="stroke-sky-400" fill="none" strokeWidth={1.2} strokeLinejoin="round" />
      )}
      {showVolume && geo.bars.map((v, i) => (
        <rect key={i} x={v.x} y={geo.volTop - v.h} width={v.w} height={v.h}
          className={v.up ? "fill-rose-400/70" : "fill-emerald-400/70"} />
      ))}
      <circle cx={geo.x1} cy={geo.lastY} r={2.8} className={geo.up ? "fill-rose-500" : "fill-emerald-500"} />
      <text x={4} y={H - 3} className="fill-slate-400 text-[9px]">{points[0].t}</text>
      <text x={W / 2} y={H - 3} textAnchor="middle" className="fill-slate-400 text-[9px]">11:30 / 13:00</text>
      <text x={W - 4} y={H - 3} textAnchor="end" className="fill-slate-400 text-[9px]">
        {points[points.length - 1].t}
      </text>
      <text x={W - 4} y={12} textAnchor="end" className="fill-slate-400 text-[9px]">{geo.max.toFixed(2)}</text>
      <text x={W - 4} y={geo.volTop - 3} textAnchor="end" className="fill-slate-400 text-[9px]">{geo.min.toFixed(2)}</text>
    </svg>
  );
}

/** 涨跌分布条：一根条同时表达 涨/平/跌 */
export function BreadthBar({ up, flat, down }: { up: number; flat: number; down: number }) {
  const total = Math.max(up + flat + down, 1);
  const w = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="bg-rose-500 transition-all" style={{ width: w(up) }} title={`上涨 ${up}`} />
      <div className="bg-slate-300 dark:bg-slate-600 transition-all" style={{ width: w(flat) }} title={`平盘 ${flat}`} />
      <div className="bg-emerald-500 transition-all" style={{ width: w(down) }} title={`下跌 ${down}`} />
    </div>
  );
}

/** 板块热度：横向条，长度=涨跌幅绝对值 */
export function HeatBars({
  rows, onClick,
}: {
  rows: { code?: string; name: string; changePercent: number | null; stockCount?: number | null }[];
  onClick?: (code?: string) => void;
}) {
  const max = Math.max(0.1, ...rows.map((r) => Math.abs(r.changePercent ?? 0)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const up = (r.changePercent ?? 0) >= 0;
        return (
          <li key={`${r.code}-${r.name}`}>
            <button
              type="button"
              onClick={() => onClick?.(r.code)}
              className="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span title={r.name}
                className="w-28 shrink-0 whitespace-normal break-words text-xs leading-tight text-slate-600 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                {r.name}
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <span
                  className={cn("absolute inset-y-0", up ? "left-1/2 bg-rose-500" : "right-1/2 bg-emerald-500")}
                  style={{ width: `${(Math.abs(r.changePercent ?? 0) / max) * 50}%` }}
                />
                <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
              </span>
              <span className={cn("nums w-14 shrink-0 text-right text-xs font-medium",
                r.changePercent === null ? "text-slate-400" : up ? "text-rose-500" : "text-emerald-500")}>
                {r.changePercent === null ? "—" : `${r.changePercent.toFixed(2)}%`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type Bar = { day: string; open: number; close: number; high: number; low: number; volume?: number };

function movingAverage(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) =>
    i + 1 < n ? null : closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
}

function bollSeries(closes: number[], n = 20, k = 2) {
  return closes.map((_, i) => {
    if (i + 1 < n) return null;
    const win = closes.slice(i + 1 - n, i + 1);
    const mid = win.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
    return { mid, upper: mid + k * sd, lower: mid - k * sd };
  });
}

/** 日 K：蜡烛 + 均线 + 可选布林/成交量/支撑压力线 + 十字光标 */
const MA_TONE = ["stroke-amber-500", "stroke-orange-400", "stroke-sky-500", "stroke-violet-500", "stroke-teal-500"];

export function KlineChart({
  bars, height = 240, count = 90, ma = [5, 20], boll = false, withVolume = false, levels = [],
}: {
  bars: Bar[];
  height?: number;
  count?: number;
  ma?: number[];
  boll?: boolean;
  withVolume?: boolean;
  levels?: { price: number; label: string; kind: "压力" | "支撑" | "轴" }[];
}) {
  const W = 600;
  const H = height;
  const pad = { l: 4, r: 46, t: 10, b: 16 };
  const volH = withVolume ? Math.round(H * 0.22) : 0;
  const priceH = H - volH;
  const [hover, setHover] = useState<number | null>(null);
  const view = useMemo(() => bars.slice(-count), [bars, count]);

  const geo = useMemo(() => {
    if (view.length < 2) return null;
    const closes = bars.map((b) => b.close);
    // 均线/布林要拿窗口前的历史算，只在本窗口内算会把开头一段抹掉
    const seriesOf = (n: number) => {
      const full = movingAverage(closes, n);
      return full.slice(full.length - view.length);
    };
    const bands = boll ? bollSeries(closes).slice(closes.length - view.length) : null;
    let min = Math.min(...view.map((b) => b.low));
    let max = Math.max(...view.map((b) => b.high));
    if (bands) {
      // 窗口前 19 根没有布林值，x?.lower 给的是 undefined，只过滤 null 会把 NaN 带进 min/max
      const lows = bands.map((x) => x?.lower).filter((x): x is number => typeof x === "number");
      const ups = bands.map((x) => x?.upper).filter((x): x is number => typeof x === "number");
      if (lows.length) min = Math.min(min, ...lows);
      if (ups.length) max = Math.max(max, ...ups);
    }
    for (const lv of levels) {
      if (lv.price < min) min = lv.price;
      if (lv.price > max) max = lv.price;
    }
    if (max === min) { max += 1; min -= 1; }
    const step = (W - pad.l - pad.r) / view.length;
    const x = (i: number) => pad.l + step * (i + 0.5);
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (priceH - pad.t - pad.b);
    const pathOf = (vals: (number | null)[]) => {
      let started = false;
      return vals.map((v, i) => {
        if (v === null) return "";
        const cmd = started ? "L" : "M";
        started = true;
        return `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      }).join(" ");
    };
    const vols = view.map((b) => (b as { volume?: number }).volume ?? 0);
    const maxVol = Math.max(1, ...vols);
    return {
      min, max, bodyW: Math.max(1.2, step * 0.62), step, x, y,
      candles: view.map((b, i) => ({
        day: b.day,
        up: b.close >= b.open,
        x: x(i),
        wickHigh: y(b.high),
        wickLow: y(b.low),
        bodyY: y(Math.max(b.open, b.close)),
        bodyH: Math.max(0.8, Math.abs(y(b.open) - y(b.close))),
      })),
      maLines: ma.map((n, k) => ({ n, cls: MA_TONE[k % MA_TONE.length], d: pathOf(seriesOf(n)) })),
      bollMid: bands ? pathOf(bands.map((b) => b?.mid ?? null)) : "",
      bollUp: bands ? pathOf(bands.map((b) => b?.upper ?? null)) : "",
      bollLow: bands ? pathOf(bands.map((b) => b?.lower ?? null)) : "",
      bollArea: (() => {
        if (!bands) return "";
        const from = bands.findIndex((b) => b);
        if (from < 0 || bands.length - from < 2) return "";
        const seg = bands.slice(from);
        const top = seg.map((b, i) => `${i === 0 ? "M" : "L"}${x(from + i).toFixed(1)},${y(b!.upper).toFixed(1)}`);
        const bottom = seg.map((b, i) => `L${x(from + seg.length - 1 - i).toFixed(1)},${y(b!.lower).toFixed(1)}`);
        return `${top.join(" ")} ${bottom.join(" ")} Z`;
      })(),
      volBars: view.map((b, i) => ({
        day: b.day, up: b.close >= b.open,
        x: x(i) - Math.max(1.2, step * 0.62) / 2,
        h: (vols[i] / maxVol) * (volH - 10),
        w: Math.max(1.2, step * 0.62),
      })),
      rows: view.map((b, i) => ({
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: (b as { volume?: number }).volume ?? null,
        prevClose: i > 0 ? view[i - 1].close : (bars[bars.length - view.length - 1]?.close ?? b.open),
      })),
      lastY: y(closes[closes.length - 1]),
      lastClose: closes[closes.length - 1],
    };
  }, [view, bars, ma, boll, H, priceH, volH, levels]);

  if (!geo) {
    return (
      <div className="flex h-[150px] items-center justify-center text-xs text-slate-400">
        K线数据不足（换个标的或加大天数）
      </div>
    );
  }
  const hc = hover !== null ? view[hover] : null;
  const hr = hover !== null ? geo.rows[hover] : null;
  const tipLines = hc && hr ? [
    hc.day,
    `开 ${hc.open.toFixed(2)}  高 ${hc.high.toFixed(2)}`,
    `低 ${hc.low.toFixed(2)}  收 ${hc.close.toFixed(2)}`,
    `${hr.prevClose ? `${(((hc.close / hr.prevClose) - 1) * 100).toFixed(2)}%` : ""}`
      + `${hr.volume !== null ? `  量 ${(hr.volume / 1e4).toFixed(1)}万股` : ""}`,
  ].filter((s) => s.trim()) : [];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const vx = ((e.clientX - r.left) / r.width) * W;
        const i = Math.floor((vx - pad.l) / geo.step);
        setHover(i >= 0 && i < view.length ? i : null);
      }}
      onMouseLeave={() => setHover(null)}>
      {[0.25, 0.5, 0.75].map((k) => (
        <line key={k} x1={pad.l} x2={W - pad.r}
          y1={pad.t + k * (priceH - pad.t - pad.b)} y2={pad.t + k * (priceH - pad.t - pad.b)}
          className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
      ))}
      {geo.bollArea && <path d={geo.bollArea} className="fill-slate-400/10" stroke="none" />}
      {geo.bollUp && <path d={geo.bollUp} className="stroke-slate-400" fill="none" strokeWidth={0.8} />}
      {geo.bollLow && <path d={geo.bollLow} className="stroke-slate-400" fill="none" strokeWidth={0.8} />}
      {geo.bollMid && <path d={geo.bollMid} className="stroke-slate-500" fill="none" strokeWidth={0.8} strokeDasharray="2 2" />}
      {levels.map((lv) => (
        <g key={lv.label}>
          <line x1={pad.l} x2={W - pad.r} y1={geo.y(lv.price)} y2={geo.y(lv.price)}
            className={cn(lv.kind === "压力" ? "stroke-rose-400" : lv.kind === "支撑" ? "stroke-emerald-400" : "stroke-sky-400")}
            strokeDasharray="4 3" strokeWidth={0.8} />
          <text x={pad.l + 2} y={geo.y(lv.price) - 2}
            className={cn("text-[8px]", lv.kind === "压力" ? "fill-rose-500"
              : lv.kind === "支撑" ? "fill-emerald-500" : "fill-sky-500")}>
            {lv.label} {lv.price.toFixed(2)}
          </text>
        </g>
      ))}
      {geo.candles.map((c) => (
        <g key={c.day} className={cn(c.up ? "stroke-rose-500 fill-rose-500" : "stroke-emerald-500 fill-emerald-500")}>
          <line x1={c.x} x2={c.x} y1={c.wickHigh} y2={c.wickLow} strokeWidth={0.8} fill="none" />
          <rect x={c.x - geo.bodyW / 2} y={c.bodyY} width={geo.bodyW} height={c.bodyH} strokeWidth={0.6} />
        </g>
      ))}
      {geo.maLines.map((l) => (
        <path key={l.n} d={l.d} className={l.cls} fill="none" strokeWidth={1.1} />
      ))}
      {withVolume && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={priceH + 2} y2={priceH + 2}
            className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={0.8} />
          {geo.volBars.map((v) => (
            <rect key={v.day} x={v.x} y={H - pad.b - v.h} width={v.w} height={v.h}
              className={cn(v.up ? "fill-rose-500/70" : "fill-emerald-500/70")} />
          ))}
          <text x={pad.l + 2} y={priceH + 12} className="fill-slate-400 text-[8px]">成交量</text>
        </g>
      )}
      {hover !== null && hc && (
        <g>
          <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={H - pad.b}
            className="stroke-slate-400" strokeWidth={0.7} />
          <rect x={Math.min(W - 150, geo.x(hover) + 4)} y={pad.t}
            width={146} height={tipLines.length * 12 + 6} rx={4}
            className="fill-slate-900/85" stroke="none" />
          {tipLines.map((t, i) => (
            <text key={i} x={Math.min(W - 150, geo.x(hover) + 8)} y={pad.t + 11 + i * 12}
              className="fill-white text-[8px]">{t}</text>
          ))}
        </g>
      )}
      <line x1={pad.l} x2={W - pad.r} y1={geo.lastY} y2={geo.lastY}
        className="stroke-slate-400" strokeDasharray="3 3" strokeWidth={0.8} />
      <text x={W - pad.r + 2} y={geo.lastY + 3} className="fill-slate-600 text-[9px] dark:fill-slate-300">
        {geo.lastClose.toFixed(2)}
      </text>
      <text x={W - pad.r + 2} y={pad.t + 8} className="fill-slate-400 text-[9px]">{geo.max.toFixed(2)}</text>
      <text x={W - pad.r + 2} y={priceH - pad.b} className="fill-slate-400 text-[9px]">{geo.min.toFixed(2)}</text>
      <text x={pad.l} y={H - 3} className="fill-slate-400 text-[9px]">{view[0]?.day ?? ""}</text>
      <text x={W - pad.r} y={H - 3} textAnchor="end" className="fill-slate-400 text-[9px]">
        {view[view.length - 1]?.day ?? ""}
      </text>
    </svg>
  );
}

/** 主力资金净流入柱：正值红、负值绿，零轴居中偏上按数据自动摆 */
export function FundFlowChart({
  rows, height = 120,
}: { rows: { date: string; mainNet: number; netAmount: number }[]; height?: number }) {
  const W = 600;
  const pad = { l: 4, r: 46, t: 8, b: 12 };
  if (rows.length < 1) {
    return <div className="flex h-[90px] items-center justify-center text-xs text-slate-400">没有资金流历史</div>;
  }
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.mainNet)));
  const zeroY = pad.t + (height - pad.t - pad.b) / 2;
  const step = (W - pad.l - pad.r) / rows.length;
  const h = (v: number) => (Math.abs(v) / peak) * ((height - pad.t - pad.b) / 2);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="none">
      <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY}
        className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={0.8} />
      {rows.map((r, i) => {
        const x = pad.l + step * (i + 0.5);
        const up = r.mainNet >= 0;
        return (
          <g key={r.date}>
            <title>{`${r.date} 主力净流入 ${(r.mainNet / 1e8).toFixed(2)} 亿 · 全日净流入 ${(r.netAmount / 1e8).toFixed(2)} 亿`}</title>
            <rect x={x - step * 0.32} y={up ? zeroY - h(r.mainNet) : zeroY}
              width={Math.max(1.4, step * 0.64)} height={Math.max(0.8, h(r.mainNet))}
              className={cn(up ? "fill-rose-500/80" : "fill-emerald-500/80")} />
          </g>
        );
      })}
      <text x={W - pad.r + 2} y={pad.t + 6} className="fill-slate-400 text-[8px]">
        {(peak / 1e8).toFixed(1)}亿
      </text>
      <text x={W - pad.r + 2} y={height - pad.b} className="fill-slate-400 text-[8px]">
        {(-peak / 1e8).toFixed(1)}亿
      </text>
      <text x={pad.l} y={height - 2} className="fill-slate-400 text-[8px]">{rows[0].date}</text>
      <text x={W - pad.r} y={height - 2} textAnchor="end" className="fill-slate-400 text-[8px]">
        {rows[rows.length - 1].date}
      </text>
    </svg>
  );
}

/** 指数卡片里的迷你走势：只看方向，不标坐标 */
export function SparkLine({
  values, up, width = 120, height = 34, fluid,
}: { values: number[]; up: boolean; width?: number; height?: number; fluid?: boolean }) {
  if (values.length < 2) {
    return <div className="text-[10px] text-slate-400" style={{ height }}>无日线序列</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = up ? "stroke-rose-500" : "stroke-emerald-500";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      className={fluid ? "block h-auto w-full" : "overflow-visible"}
      preserveAspectRatio={fluid ? "none" : undefined}>
      <path d={`${line} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`}
        className={up ? "fill-rose-500/10" : "fill-emerald-500/10"} />
      <path d={line} className={color} fill="none" strokeWidth={1.3} strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.8}
        className={up ? "fill-rose-500" : "fill-emerald-500"} />
    </svg>
  );
}

/** 情绪分/恐慌指数这类「要看趋势也要读数」的折线：坐标轴 + 分档参考线 + 悬浮读数 */
export type TrendPoint = { x: string; y: number | null; label?: string };

const TREND_TONE = {
  rose: { line: "stroke-rose-500", dot: "fill-rose-500", text: "fill-rose-600 dark:fill-rose-400", rgb: "244,63,94" },
  violet: { line: "stroke-violet-500", dot: "fill-violet-500", text: "fill-violet-600 dark:fill-violet-400", rgb: "139,92,246" },
  sky: { line: "stroke-sky-500", dot: "fill-sky-500", text: "fill-sky-600 dark:fill-sky-400", rgb: "14,165,233" },
  emerald: { line: "stroke-emerald-500", dot: "fill-emerald-500", text: "fill-emerald-600 dark:fill-emerald-400", rgb: "16,185,129" },
  amber: { line: "stroke-amber-500", dot: "fill-amber-500", text: "fill-amber-600 dark:fill-amber-400", rgb: "245,158,11" },
};

export function TrendLine({
  points, height = 180, tone = "rose", refLines = [], digits = 1, domain, bands = [],
}: {
  points: TrendPoint[];
  height?: number;
  tone?: keyof typeof TREND_TONE;
  refLines?: { value: number; label: string }[];
  digits?: number;
  domain?: [number, number];
  /** 估值区间带：把历史上「便宜/合理/偏贵」三段值域涂出来，折线穿过哪一段一眼可见 */
  bands?: { from: number; to: number; tone: "low" | "mid" | "high"; label?: string }[];
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const pad = { l: 6, r: 46, t: 12, b: 18 };

  const geo = useMemo(() => {
    const vals = points.map((p) => p.y).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) return null;
    // 参考线要一起进上下界，否则「恐慌线 30」这种刻度会被压出画外看不见
    let min = domain ? domain[0]
      : Math.min(...vals, ...refLines.map((r) => r.value), ...bands.map((b) => b.from));
    let max = domain ? domain[1]
      : Math.max(...vals, ...refLines.map((r) => r.value), ...bands.map((b) => b.to));
    if (max === min) { max += 1; min -= 1; }
    if (!domain) {
      const gap = (max - min) * 0.06;
      min -= gap; max += gap;
    }
    const x = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    let started = false;
    const line = points.map((p, i) => {
      if (p.y === null) return "";
      const cmd = started ? "L" : "M";
      started = true;
      return `${cmd}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`;
    }).join(" ");
    const firstIdx = points.findIndex((p) => p.y !== null);
    const lastIdx = points.map((p) => (p.y === null ? -1 : 1)).lastIndexOf(1);
    const area = `${line} L${x(lastIdx).toFixed(1)},${(height - pad.b).toFixed(1)} `
      + `L${x(firstIdx).toFixed(1)},${(height - pad.b).toFixed(1)} Z`;
    return {
      min, max, x, y, line, area, lastIdx,
      lastValue: points[lastIdx].y as number,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((k) => min + k * (max - min)),
    };
  }, [points, refLines, bands, height, domain]);

  if (!geo) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-slate-50 py-8 text-xs text-slate-400 dark:bg-slate-800/60"
        style={{ height }}>
        序列不足两天，画不出走势（先等收盘快照累积）
      </div>
    );
  }
  const c = TREND_TONE[tone];
  const hp = hover !== null ? points[hover] : null;
  const fmt = (v: number) => v.toFixed(digits);
  const BAND_FILL = { low: "fill-emerald-500/10 dark:fill-emerald-400/10",
                      mid: "fill-amber-400/10 dark:fill-amber-400/10",
                      high: "fill-rose-500/10 dark:fill-rose-400/10" };
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const vx = ((e.clientX - r.left) / r.width) * W;
        const i = Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
        setHover(i >= 0 && i < points.length && points[i].y !== null ? i : null);
      }}
      onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id={`trend-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgb(${c.rgb})`} stopOpacity="0.20" />
          <stop offset="100%" stopColor={`rgb(${c.rgb})`} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {bands.map((b) => {
        const top = Math.max(geo.min, Math.min(geo.max, b.to));
        const bottom = Math.max(geo.min, Math.min(geo.max, b.from));
        const h = geo.y(bottom) - geo.y(top);
        if (h <= 0) return null;
        return (
          <g key={`${b.tone}-${b.from}-${b.to}`}>
            <rect x={pad.l} y={geo.y(top)} width={W - pad.l - pad.r} height={h}
              className={BAND_FILL[b.tone]} stroke="none" />
            {b.label && h >= 13 && (
              <text x={W - pad.r - 4} y={geo.y(top) + h / 2 + 3} textAnchor="end"
                className="fill-slate-400 text-[8px] dark:fill-slate-500">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
      {geo.ticks.map((v) => (
        <g key={v.toFixed(2)}>
          <line x1={pad.l} x2={W - pad.r} y1={geo.y(v)} y2={geo.y(v)}
            className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={0.8} />
          <text x={W - pad.r + 3} y={geo.y(v) + 3} className="fill-slate-400 text-[9px]">{fmt(v)}</text>
        </g>
      ))}
      {refLines.map((r) => (r.value < geo.min || r.value > geo.max ? null : (
        <g key={r.label}>
          <line x1={pad.l} x2={W - pad.r} y1={geo.y(r.value)} y2={geo.y(r.value)}
            className="stroke-slate-400 dark:stroke-slate-500" strokeDasharray="4 3" strokeWidth={0.8} />
          <text x={pad.l + 2} y={geo.y(r.value) - 2} className="fill-slate-400 text-[8px] dark:fill-slate-500">
            {r.label} {r.value}
          </text>
        </g>
      )))}
      <path d={geo.area} fill={`url(#trend-${gid})`} />
      <path d={geo.line} className={c.line} fill="none" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={geo.x(geo.lastIdx)} cy={geo.y(geo.lastValue)} r={3} className={c.dot} />
      <text x={pad.l} y={height - 4} className="fill-slate-400 text-[9px]">{points[0].x}</text>
      <text x={W / 2} y={height - 4} textAnchor="middle" className="fill-slate-400 text-[9px]">
        {points[Math.floor(points.length / 2)].x}
      </text>
      <text x={W - pad.r} y={height - 4} textAnchor="end" className="fill-slate-400 text-[9px]">
        {points[points.length - 1].x}
      </text>
      <text x={W - pad.r + 3} y={geo.y(geo.lastValue) + 3} className={cn("text-[9px] font-semibold", c.text)}>
        {fmt(geo.lastValue)}
      </text>
      {hp && hp.y !== null && hover !== null && (
        <g>
          <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={height - pad.b}
            className="stroke-slate-400" strokeWidth={0.7} />
          <circle cx={geo.x(hover)} cy={geo.y(hp.y)} r={3} className={c.dot} />
          <rect x={Math.min(W - 128, geo.x(hover) + 6)} y={pad.t} width={122} height={30} rx={4}
            className="fill-slate-900/85" stroke="none" />
          <text x={Math.min(W - 128, geo.x(hover) + 6) + 6} y={pad.t + 12} className="fill-white text-[9px]">
            {hp.x}
          </text>
          <text x={Math.min(W - 128, geo.x(hover) + 6) + 6} y={pad.t + 24} className="fill-white text-[9px]">
            {hp.label ?? fmt(hp.y)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** 涨跌分布直方图：13 档，档内柱高=占比，红涨绿跌，中间平盘灰 */export function BucketHistogram({
  buckets, height = 96,
}: {
  buckets: { label: string; count: number; ratio: number; lo: number; hi: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {buckets.map((b) => {
        const tone = b.hi <= 0 ? "bg-emerald-500" : b.lo >= 0 ? "bg-rose-500" : "bg-slate-300 dark:bg-slate-600";
        return (
          <div key={b.label} className="flex flex-1 flex-col items-center justify-end gap-1"
            title={`${b.label}：${b.count} 只（${b.ratio}%）`}>
            <span className="nums text-[9px] text-slate-400">{b.count > 0 ? b.count : ""}</span>
            <span className={cn("w-full rounded-t", tone)}
              style={{ height: `${Math.max(2, (b.count / max) * (height - 30))}px` }} />
            <span className="w-full truncate text-center text-[9px] leading-tight text-slate-500 dark:text-slate-400">
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
