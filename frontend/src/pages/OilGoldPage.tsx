import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, isDemo, messageOf } from "../lib/api";
import type { CommodityResult, GlobalQuote } from "../lib/types";
import { num, price, timeAgo } from "../lib/format";
import { applyCommodityLive, fetchGlobalLive, type GlobalLive } from "../lib/liveGlobal";
import { AshareStrip, QuoteGroupCard, SourceErrors } from "../components/global-quote";
import {
  Button, Chip, EmptyState, Panel, Skeleton, UpDown, cn,
} from "../components/ui";

const WATCH_ORDER = ["hf_CL", "hf_GC", "hf_XAU", "hf_SI", "DINIW", "fx_susdcnh", "hf_CHA50CFD"];

const WATCH_HINT: Record<string, string> = {
  hf_CL: "纽约原油：能源通胀的总开关，涨太快会压制造业利润",
  hf_GC: "纽约黄金：实际利率的反向指标，避险情绪直接写在价格上",
  hf_XAU: "伦敦金现货：与纽约金差值即期现价差，拉大说明交割紧张",
  hf_SI: "纽约白银：既有货币属性又有工业需求，弹性比黄金大",
  DINIW: "美元指数：非美资产的分母，走强通常压黄金与新兴市场",
  fx_susdcnh: "离岸人民币：贬到关键位会放大外资流出的担忧",
  hf_CHA50CFD: "富时A50期货：夜盘走势基本决定次日 A 股开盘方向",
};

/** 与全球指数页同一套演示模式实时方案 */
const LIVE_EVERY_MS = 5_000;
const FLASH_MS = 900;

export default function OilGoldPage() {
  const [data, setData] = useState<CommodityResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 演示模式的实时覆盖：美元指数/离岸人民币走东财、A 股对照走腾讯；
  // 商品期货与 A50 暂无验证过的直连源，保持预抓快照
  const [live, setLive] = useState<GlobalLive | null>(null);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const lastPriceRef = useRef<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<CommodityResult>("/global-market/commodity", {}, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isDemo) return;
    let alive = true;
    const run = async () => {
      const got = await fetchGlobalLive();
      if (!alive) return;
      const changed: Record<string, "up" | "down"> = {};
      for (const [key, p] of [...Object.entries(got.quotes), ...Object.entries(got.aShare)]) {
        const prev = lastPriceRef.current[key];
        if (prev !== undefined && p.price !== prev) changed[key] = p.price > prev ? "up" : "down";
        lastPriceRef.current[key] = p.price;
      }
      setLive(got);
      if (Object.keys(changed).length) {
        setFlash(changed);
        window.setTimeout(() => { if (alive) setFlash({}); }, FLASH_MS);
      }
    };
    void run();
    const timer = window.setInterval(run, LIVE_EVERY_MS);
    const clock = window.setInterval(() => setNowMs(Date.now()), 5_000);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const view = useMemo(
    () => (data ? applyCommodityLive(data, isDemo ? live : null) : data), [data, live]);
  const liveOn = isDemo && !!live;
  const clock = new Date(nowMs).toLocaleTimeString("zh-CN", { hour12: false });

  const by = (code: string): GlobalQuote | undefined =>
    [...(view?.rows ?? []), ...(view?.fx ?? [])].find((r) => r.code === code);

  const gold = by("hf_GC");
  const oil = by("hf_CL");
  const ratio = view?.goldOilRatio ?? null;
  const ratioNote = ratio === null ? "拿不到金油比"
    : ratio > 25 ? "金油比高位：避险资金多于工业需求，经济预期偏弱"
      : ratio < 15 ? "金油比低位：工业需求旺盛，通胀与增长预期偏强"
        : "金油比中性区间";

  return (
    <div className="space-y-4">
      <Panel
        title="原油 · 黄金 · 汇率传导"
        subtitle={view
          ? `${liveOn ? `实时报价 ${live!.at}（浏览器直连，5 秒一跳）· 快照抓取于 ${view.generatedAt}`
            : `更新于 ${view.generatedAt}`} · ${view.rows.length} 个商品期货 + ${view.fx.length} 个汇率/期货对照`
          : error ?? "正在读取外围商品行情…"}
        right={<Button size="sm" variant="outline" loading={busy && !!view} onClick={() => void load()}>刷新</Button>}
      >
        {busy && !view ? <Skeleton className="h-28 w-full" /> : (
          <>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {view?.note}
              {liveOn ? "；演示站在这份快照之上，美元指数、离岸人民币与 A 股对照是浏览器直连的实时报价，"
                + "商品期货与富时A50期货暂无可靠直连源，仍取自快照" : ""}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {WATCH_ORDER.map((code) => {
                const q = by(code);
                if (!q) return null;
                const hit = liveOn ? flash[code] : undefined;
                return (
                  <div key={code} title={WATCH_HINT[code]}
                    className={cn("rounded-lg border bg-white/70 p-3 transition-colors duration-300 dark:bg-slate-900/40",
                      hit === "up" ? "border-rose-300 bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/15"
                        : hit === "down" ? "border-emerald-300 bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15"
                          : "border-slate-200/80 dark:border-slate-700/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{q.name}</span>
                      <span className="nums text-[10px] text-slate-400">{q.date ?? "—"}</span>
                    </div>
                    <p className="nums mt-1 text-base font-semibold text-slate-800 dark:text-slate-100">
                      {price(q.price, q.price !== null && q.price < 10 ? 4 : 2)}
                    </p>
                    <p className="mt-0.5 text-xs">
                      <UpDown value={q.change_percent} />
                      <span className="nums ml-1.5 text-slate-400">{num(q.change_price, 2)}</span>
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {WATCH_HINT[code]}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!!view && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">金油比</span>
            <span className="nums text-sm font-semibold text-slate-800 dark:text-slate-100">
              {ratio === null ? "—" : ratio.toFixed(2)}
            </span>
            <Chip tone={ratio === null ? "slate" : ratio > 25 ? "sky" : ratio < 15 ? "amber" : "slate"}>
              {ratioNote}
            </Chip>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              口径：{gold?.name ?? "纽约黄金"} ÷ {oil?.name ?? "纽约原油"}，历史区间大致 10-30
            </span>
          </div>
        )}
        <SourceErrors errors={view?.errors ?? {}} />
        <p className="nums mt-3 text-[11px] text-slate-400">
          现在 {clock} · {liveOn
            ? `可直连的标的价格实时，最近一跳 ${live!.at} · 预抓快照 ${timeAgo(view?.generatedAt)}`
            : `数据 ${timeAgo(view?.generatedAt)}，手点「刷新」重打上游`}
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {busy && !view && [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        {(view?.groups ?? []).map((g) => (
          <QuoteGroupCard key={g.key} group={g} flash={liveOn ? flash : undefined}
            unitHint={(q) => (q.bid || q.ask ? `买 ${price(q.bid)} / 卖 ${price(q.ask)}` : null)} />
        ))}
      </div>

      <Panel title="外围对 A 股的传导" subtitle="商品与汇率只给方向，不给点位；先看自己的开盘环境">
        {view?.aShare?.length ? (
          <>
            <AshareStrip rows={view.aShare} flash={liveOn ? flash : undefined} />
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <li>· 人民币贬值 + 美元指数走强 → 外资流出压力增大，权重股容易拖指数。</li>
              <li>· 原油大涨 → 航空、物流、化工下游成本承压；油气开采与煤炭相对受益。</li>
              <li>· 黄金快速走强 → 避险情绪升温，高估值成长与题材股容易先被减仓。</li>
              <li>· 铜价（伦铜）反映工业需求，与中证 1000 / 制造业景气度同向。</li>
            </ul>
          </>
        ) : <EmptyState text="没有拿到 A 股指数行情" hint="可在仪表盘重试收盘快照重建" />}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link to="/global-index"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            全球指数
          </Link>
          <Link to="/market-env"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            市场环境六维
          </Link>
          <Link to="/info/fund-flow"
            className={cn("rounded-lg border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50",
              "dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800")}>
            资金流向
          </Link>
        </div>
      </Panel>
    </div>
  );
}
