import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { CommodityResult, GlobalQuote } from "../lib/types";
import { num, price } from "../lib/format";
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

export default function OilGoldPage() {
  const [data, setData] = useState<CommodityResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get<CommodityResult>("/global-market/commodity", {}, 60_000));
      setError(null);
    } catch (e) { setError(messageOf(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const by = (code: string): GlobalQuote | undefined =>
    [...(data?.rows ?? []), ...(data?.fx ?? [])].find((r) => r.code === code);

  const gold = by("hf_GC");
  const oil = by("hf_CL");
  const ratio = data?.goldOilRatio ?? null;
  const ratioNote = ratio === null ? "拿不到金油比"
    : ratio > 25 ? "金油比高位：避险资金多于工业需求，经济预期偏弱"
      : ratio < 15 ? "金油比低位：工业需求旺盛，通胀与增长预期偏强"
        : "金油比中性区间";

  return (
    <div className="space-y-4">
      <Panel
        title="原油 · 黄金 · 汇率传导"
        subtitle={data
          ? `更新于 ${data.generatedAt} · ${data.rows.length} 个商品期货 + ${data.fx.length} 个汇率/期货对照`
          : error ?? "正在读取外围商品行情…"}
        right={<Button size="sm" variant="outline" loading={busy && !!data} onClick={() => void load()}>刷新</Button>}
      >
        {busy && !data ? <Skeleton className="h-28 w-full" /> : (
          <>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{data?.note}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {WATCH_ORDER.map((code) => {
                const q = by(code);
                if (!q) return null;
                return (
                  <div key={code} title={WATCH_HINT[code]}
                    className="rounded-lg border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
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

        {!!data && (
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
        <SourceErrors errors={data?.errors ?? {}} />
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {busy && !data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        {(data?.groups ?? []).map((g) => (
          <QuoteGroupCard key={g.key} group={g}
            unitHint={(q) => (q.bid || q.ask ? `买 ${price(q.bid)} / 卖 ${price(q.ask)}` : null)} />
        ))}
      </div>

      <Panel title="外围对 A 股的传导" subtitle="商品与汇率只给方向，不给点位；先看自己的开盘环境">
        {data?.aShare?.length ? (
          <>
            <AshareStrip rows={data.aShare} />
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
