import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type {
  HoldingAccount, HoldingRule, HoldingRuleType, HoldingsScanResult, HoldingSummary, HoldingTrade,
} from "../lib/types";
import {
  Button, Chip, DataTable, EmptyState, Field, Panel, Skeleton, UpDown,
  cn, inputClass, type Column,
} from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { num, price } from "../lib/format";

type Tab = "positions" | "trades" | "rules";

export default function HoldingsPage() {
  const { hasPerm } = useSession();
  const nav = useNavigate();
  const canManage = hasPerm("holdings:manage");

  const [accts, setAccts] = useState<HoldingAccount[]>([]);
  const [types, setTypes] = useState<HoldingRuleType[]>([]);
  const [aid, setAid] = useState<number | null>(null);
  const [sum, setSum] = useState<HoldingSummary | null>(null);
  const [trades, setTrades] = useState<HoldingTrade[]>([]);
  const [rules, setRules] = useState<HoldingRule[]>([]);
  const [tab, setTab] = useState<Tab>("positions");
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scan, setScan] = useState<HoldingsScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testOut, setTestOut] = useState<Record<string, string>>({});
  const [draftAcc, setDraftAcc] = useState<{ name: string; broker: string; capital: number } | null>(null);
  const [draftTrade, setDraftTrade] = useState<TradeForm | null>(null);
  const [draftRule, setDraftRule] = useState<RuleForm | null>(null);

  const loadAccounts = useCallback(async () => {
    const out = await api.get<{ rows: HoldingAccount[]; meta: { ruleTypes: HoldingRuleType[] } }>(
      "/holdings/accounts", {}, 45_000);
    setAccts(out.rows);
    setTypes(out.meta.ruleTypes ?? []);
    setAid((cur) => (cur && out.rows.some((r) => r.id === cur) ? cur : out.rows[0]?.id ?? null));
  }, []);

  const loadDetail = useCallback(async (id: number | null) => {
    setLoading(true);
    const q = id ? { accountId: id } : {};
    try {
      const [s, t, r] = await Promise.all([
        api.get<HoldingSummary>("/holdings/summary", q, 45_000),
        api.get<{ rows: HoldingTrade[] }>("/holdings/trades", q, 25_000),
        api.get<{ rows: HoldingRule[] }>("/holdings/rules", {}, 25_000),
      ]);
      setSum(s);
      setTrades(t.rows);
      setRules(r.rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts()
      .catch((e) => toast(messageOf(e), "error"))
      .finally(() => setBusy(false));
  }, [loadAccounts]);

  useEffect(() => {
    if (busy) return;
    void loadDetail(aid).catch((e) => toast(messageOf(e), "error"));
  }, [aid, busy, loadDetail]);

  const refresh = async () => {
    try {
      await loadAccounts();
      await loadDetail(aid);
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const createAccount = async () => {
    if (!draftAcc) return;
    setSaving(true);
    try {
      await api.post("/holdings/accounts",
        { name: draftAcc.name, broker: draftAcc.broker, initialCapital: draftAcc.capital }, 25_000);
      toast(`已创建账户「${draftAcc.name || "未命名"}」`, "ok");
      setDraftAcc(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (a: HoldingAccount) => {
    if (!window.confirm(`删除账户「${a.name}」？它的 ${a.positions} 条持仓、交易流水与风控规则会一起清掉。`)) return;
    try {
      await api.del(`/holdings/accounts/${a.id}`);
      toast("账户已删除", "ok");
      if (aid === a.id) setAid(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const addTrade = async () => {
    if (!draftTrade) return;
    setSaving(true);
    try {
      await api.post("/holdings/trades", { ...draftTrade, accountId: aid }, 25_000);
      toast(`已记一笔${draftTrade.side === "buy" ? "买入" : "卖出"}`, "ok");
      setDraftTrade(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const removeTrade = async (t: HoldingTrade) => {
    if (!window.confirm(`删除这笔 ${t.side === "buy" ? "买入" : "卖出"} ${t.name}？持仓与盈亏会重算。`)) return;
    try {
      await api.del(`/holdings/trades/${t.id}`);
      toast("交易记录已删除", "ok");
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const createRule = async () => {
    if (!draftRule) return;
    setSaving(true);
    try {
      await api.post("/holdings/rules", {
        accountId: draftRule.accountId, ruleType: draftRule.ruleType,
        threshold: draftRule.threshold, cooldownMin: draftRule.cooldownMin,
        enabled: draftRule.enabled,
      }, 25_000);
      toast("风控规则已创建", "ok");
      setDraftRule(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const patchRule = async (r: HoldingRule, body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(`/holdings/rules/${r.id}`, body, 25_000);
      toast(msg, "ok");
      await loadDetail(aid);
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const removeRule = async (r: HoldingRule) => {
    if (!window.confirm(`删除规则「${r.typeLabel}」？`)) return;
    try {
      await api.del(`/holdings/rules/${r.id}`);
      toast("规则已删除", "ok");
      await loadDetail(aid);
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const testRule = async (r: HoldingRule) => {
    setTestOut((o) => ({ ...o, [r.id]: "试算中…" }));
    try {
      const out = await api.post<{ hit: boolean; detail: { text?: string; note?: string } }>(
        `/holdings/rules/${r.id}/test`, {}, 45_000);
      setTestOut((o) => ({ ...o, [r.id]: `${out.hit ? "会触发" : "不触发"}：${out.detail.text ?? out.detail.note ?? ""}` }));
    } catch (e) {
      setTestOut((o) => ({ ...o, [r.id]: messageOf(e) }));
    }
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const out = await api.post<HoldingsScanResult>("/holdings/scan", {}, 60_000);
      setScan(out);
      toast(out.hits ? `扫描 ${out.checked} 条规则，命中 ${out.hits} 条` : `扫描 ${out.checked} 条规则，全部安全`,
        out.hits ? "warn" : "ok");
      void loadDetail(aid);
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setScanning(false);
    }
  };

  if (busy) return <Skeleton className="h-80 w-full" />;

  const positions = sum?.rows ?? [];
  const current = accts.find((a) => a.id === aid) ?? null;

  return (
    <div className="space-y-4">
      <Panel
        title="持仓管理"
        subtitle={accts.length
          ? `${accts.length} 个持仓账户 · 当前看「${current?.name ?? ""}」，成本按摊薄法结转，行情取实时价`
          : "还没有持仓账户，先建一个并录入第一笔买入"}
        right={(
          <>
            <Link to="/holdings/alerts"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              持仓提醒
            </Link>
            <Button size="sm" variant="outline" onClick={() => setDraftAcc({ name: "", broker: "", capital: 200000 })}
              disabled={!canManage}>新建账户</Button>
          </>
        )}
      >
        {draftAcc && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 lg:grid-cols-4">
            <Field label="账户名称">
              <input className={inputClass} value={draftAcc.name} placeholder="比如：主账户"
                onChange={(e) => setDraftAcc({ ...draftAcc, name: e.target.value })} />
            </Field>
            <Field label="券商（可空）">
              <input className={inputClass} value={draftAcc.broker} placeholder="华泰 / 同花顺"
                onChange={(e) => setDraftAcc({ ...draftAcc, broker: e.target.value })} />
            </Field>
            <Field label="投入本金（元）" hint="现金 = 本金 − 净买入，必填">
              <input className={cn(inputClass, "nums")} type="number" min={1} step={1000}
                value={draftAcc.capital}
                onChange={(e) => setDraftAcc({ ...draftAcc, capital: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraftAcc(null)}>取消</Button>
              <Button size="sm" loading={saving} onClick={() => void createAccount()}>创建</Button>
            </div>
          </div>
        )}

        {!!accts.length && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {accts.map((a) => (
              <button key={a.id} type="button" onClick={() => setAid(a.id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs transition",
                  a.id === aid
                    ? "border-slate-800 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800",
                )}>
                {a.name}
                <span className={cn("nums ml-1.5", a.id === aid ? "opacity-70" : "text-slate-400")}>
                  {num(a.marketValue, 0)}
                </span>
              </button>
            ))}
            {canManage && current && (
              <button type="button" onClick={() => void removeAccount(current)} title="删除当前账户"
                className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-xs text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10">
                删除「{current.name}」
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="持仓市值" value={sum?.marketValue} signed={false} />
          <Stat label="持仓成本" value={sum?.totalCost} signed={false} />
          <Stat label="浮动盈亏" value={sum?.unrealized} />
          <Stat label="已实现盈亏" value={sum?.realized} />
          <Stat label="净利润" value={sum?.netProfit} />
          <Stat label="收益率" value={sum?.profitRate} suffix="%" />
          <Stat label="可用现金" value={sum?.cash ?? current?.cash} signed={false} />
          <Stat label="峰值回撤" value={sum?.drawdown} suffix="%" tone="down" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["positions", "trades", "rules"] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition",
                tab === t ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}>
              {t === "positions" ? `持仓明细（${positions.length}）`
                : t === "trades" ? `交易记录（${trades.length}）`
                  : `风控规则（${rules.length}）`}
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" loading={scanning}
            onClick={() => void runScan()} title="按当前账户的启用规则算一遍并写提醒">立即扫描风控</Button>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>刷新</Button>
        </div>

        {scan && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              本次扫描 {scan.checked} 条规则：命中 <b className="text-rose-500">{scan.hits}</b> ·
              已发提醒 <b className="text-emerald-600">{scan.notified}</b> ·
              冷却或降噪抑制 <b className="text-amber-600">{scan.suppressed}</b>
              （详情与通知记录在「持仓提醒」页）
            </p>
            {scan.results.length > 0 && (
              <ul className="mt-2 space-y-1">
                {scan.results.map((r) => (
                  <li key={r.ruleId} className="flex items-start gap-2 text-xs">
                    <Chip tone={r.hit ? "rose" : "slate"}>{r.hit ? (r.suppressed ? "已抑制" : "命中") : "安全"}</Chip>
                    <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                      {r.error ? `数据源异常：${r.error}` : r.detail.text ?? String(r.detail.note ?? "无依据")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3">
          {loading && !sum ? <Skeleton className="h-56 w-full" /> : null}
          {!loading && tab === "positions" && (
            positions.length ? (
              <DataTable columns={positionColumns(nav)} rows={positions}
                rowKey={(r) => r.symbol} dense maxHeight="420px"
                sortInitial={{ key: "marketValue", desc: true }}
                onRowClick={(r) => nav(`/stock-analysis/${r.symbol}`)}
                empty="这个账户还没持仓" />
            ) : (
              <EmptyState text="还没有持仓" hint="切到「交易记录」录入第一笔买入，市值与盈亏就会出来" />
            )
          )}
          {!loading && tab === "trades" && (
            <>
              {canManage && (
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  {!draftTrade ? (
                    <Button size="sm" variant="outline"
                      onClick={() => setDraftTrade({ symbol: "", side: "buy", price: 0, quantity: 100, fee: 5, tradeDate: today(), note: "" })}>
                      添加交易
                    </Button>
                  ) : (
                    <div className="grid w-full gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/50">
                      <Field label="股票代码" hint="支持 600519 / sh600519 / 00700.HK">
                        <input className={cn(inputClass, "nums")} value={draftTrade.symbol} placeholder="300750"
                          onChange={(e) => setDraftTrade({ ...draftTrade, symbol: e.target.value })} />
                      </Field>
                      <Field label="方向">
                        <select className={inputClass} value={draftTrade.side}
                          onChange={(e) => setDraftTrade({ ...draftTrade, side: e.target.value as "buy" | "sell" })}>
                          <option value="buy">买入</option>
                          <option value="sell">卖出</option>
                        </select>
                      </Field>
                      <Field label="成交价（元）">
                        <input className={cn(inputClass, "nums")} type="number" step="0.01" min={0}
                          value={draftTrade.price}
                          onChange={(e) => setDraftTrade({ ...draftTrade, price: Number(e.target.value) })} />
                      </Field>
                      <Field label="数量（股）" hint="A 股须为 100 的整数倍">
                        <input className={cn(inputClass, "nums")} type="number" step={100} min={0}
                          value={draftTrade.quantity}
                          onChange={(e) => setDraftTrade({ ...draftTrade, quantity: Number(e.target.value) })} />
                      </Field>
                      <Field label="手续费（元）">
                        <input className={cn(inputClass, "nums")} type="number" step="0.01" min={0}
                          value={draftTrade.fee}
                          onChange={(e) => setDraftTrade({ ...draftTrade, fee: Number(e.target.value) })} />
                      </Field>
                      <Field label="成交日期">
                        <input className={cn(inputClass, "nums")} type="date" value={draftTrade.tradeDate}
                          onChange={(e) => setDraftTrade({ ...draftTrade, tradeDate: e.target.value })} />
                      </Field>
                      <Field label="备注（可空）">
                        <input className={inputClass} value={draftTrade.note} placeholder="加仓逻辑、止损位"
                          onChange={(e) => setDraftTrade({ ...draftTrade, note: e.target.value })} />
                      </Field>
                      <div className="flex items-end justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDraftTrade(null)}>取消</Button>
                        <Button size="sm" loading={saving} onClick={() => void addTrade()}>保存</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <DataTable columns={tradeColumns(canManage, removeTrade)} rows={trades}
                rowKey={(r) => r.id} dense maxHeight="420px"
                sortInitial={{ key: "trade_date", desc: true }} empty="还没有交易记录" />
            </>
          )}
          {!loading && tab === "rules" && (
            <>
              {canManage && !draftRule && !!accts.length && (
                <Button size="sm" variant="outline" className="mb-3"
                  onClick={() => setDraftRule({ accountId: aid ?? accts[0].id, ruleType: types[0]?.key ?? "",
                    threshold: types[0]?.params[0]?.default ?? 8, cooldownMin: 30, enabled: true })}>
                  新建规则
                </Button>
              )}
              {draftRule && (
                <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <Field label="账户">
                    <select className={inputClass} value={draftRule.accountId}
                      onChange={(e) => setDraftRule({ ...draftRule, accountId: Number(e.target.value) })}>
                      {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  <Field label="规则类型" hint={types.find((t) => t.key === draftRule.ruleType)?.desc}>
                    <select className={inputClass} value={draftRule.ruleType}
                      onChange={(e) => {
                        const t = types.find((x) => x.key === e.target.value)!;
                        setDraftRule({ ...draftRule, ruleType: t.key, threshold: t.params[0]?.default ?? 8 });
                      }}>
                      {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </Field>
                  <Field label={types.find((t) => t.key === draftRule.ruleType)?.params[0]?.label ?? "阈值（%）"}>
                    <input className={cn(inputClass, "nums")} type="number" step="0.1" value={draftRule.threshold}
                      onChange={(e) => setDraftRule({ ...draftRule, threshold: Number(e.target.value) })} />
                  </Field>
                  <Field label="冷却（分钟）" hint="同一规则冷却期内只提醒一次">
                    <input className={cn(inputClass, "nums")} type="number" min={1} max={1440}
                      value={draftRule.cooldownMin}
                      onChange={(e) => setDraftRule({ ...draftRule, cooldownMin: Number(e.target.value) })} />
                  </Field>
                  <div className="flex items-end justify-end gap-2 lg:col-span-4">
                    <label className="mr-auto flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={draftRule.enabled}
                        onChange={(e) => setDraftRule({ ...draftRule, enabled: e.target.checked })} />
                      创建后立即启用
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => setDraftRule(null)}>取消</Button>
                    <Button size="sm" loading={saving} onClick={() => void createRule()}>创建规则</Button>
                  </div>
                </div>
              )}
              {rules.length ? (
                <DataTable columns={ruleColumns(canManage, testOut, patchRule, removeRule, testRule)}
                  rows={rules} rowKey={(r) => r.id} dense maxHeight="420px"
                  empty="还没有风控规则" />
              ) : (
                <EmptyState text="还没有风控规则"
                  hint="建议先加「组合止损」和「组合集中度」两条，阈值默认 8% / 30%" />
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- 子组件 */

function Stat({ label, value, suffix = "元", signed = true, tone }: {
  label: string; value: number | null | undefined; suffix?: string; signed?: boolean;
  tone?: "up" | "down";
}) {
  const isNum = typeof value === "number" && !Number.isNaN(value);
  const color = !isNum ? "text-slate-400"
    : tone === "down" ? "text-amber-600"
      : value! > 0 ? (signed ? "text-rose-500" : "text-slate-800 dark:text-slate-100")
        : value! < 0 ? "text-emerald-600" : "text-slate-500";
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
      <p className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums truncate text-base font-semibold", color)} title={isNum ? String(value) : undefined}>
        {isNum ? `${signed && value > 0 ? "+" : ""}${fmt(value, suffix)}${suffix}` : "—"}
      </p>
    </div>
  );
}

/** 百分比保留两位，否则 -0.0018% 会被显示成「-0」 */
function fmt(v: number, suffix: string) {
  if (suffix === "%") return v.toFixed(2);
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

type Position = NonNullable<HoldingSummary["rows"]>[number];

function positionColumns(nav: (path: string) => void): Column<Position>[] {
  return [
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <span className="whitespace-nowrap text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
        <button type="button" className="ml-1.5 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
          onClick={(e) => { e.stopPropagation(); nav(`/stock-analysis/${r.symbol}`); }}>分析</button>
      </div>) },
    { key: "quantity", label: "持仓", align: "right", value: (r) => r.quantity, render: (r) => (
      <span className="nums">{r.quantity.toLocaleString("zh-CN")}</span>) },
    { key: "costPrice", label: "成本", align: "right", value: (r) => r.costPrice,
      render: (r) => <span className="nums">{price(r.costPrice, 3)}</span> },
    { key: "price", label: "现价", align: "right", value: (r) => r.price, render: (r) => (
      <span className="nums">{price(r.price)}<UpDown className="ml-1.5 text-[11px]" value={r.changePercent} /></span>) },
    { key: "marketValue", label: "市值", align: "right", value: (r) => r.marketValue, render: (r) => (
      <span className="nums">{num(r.marketValue)}</span>) },
    { key: "unrealized", label: "浮动盈亏", align: "right", value: (r) => r.unrealized, render: (r) => (
      <UpDown value={r.unrealized} suffix="" digits={2} className="nums" />) },
    { key: "profitRate", label: "收益率", align: "right", value: (r) => r.profitRate,
      render: (r) => <UpDown value={r.profitRate} /> },
    { key: "realized", label: "已实现", align: "right", value: (r) => r.realized, render: (r) => (
      <UpDown value={r.realized} suffix="" digits={2} className="nums" />) },
    { key: "weight", label: "占比", align: "right", value: (r) => r.weight, render: (r) => (
      <div className="flex items-center justify-end gap-1.5">
        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, r.weight)}%` }} />
        </span>
        <span className="nums text-[11px] text-slate-500 dark:text-slate-400">{r.weight}%</span>
      </div>) },
    { key: "quote", label: "行情时间", align: "right", width: "w-24", value: (r) => r.quoteTime ?? "",
      render: (r) => <span className="nums text-[11px] text-slate-400">{r.quoteTime || "收盘快照"}</span> },
  ];
}

function tradeColumns(canManage: boolean, onDel: (t: HoldingTrade) => void): Column<HoldingTrade>[] {
  return [
    { key: "trade_date", label: "日期", width: "w-24", value: (r) => r.trade_date, render: (r) => (
      <span className="nums whitespace-nowrap text-xs">{r.trade_date}</span>) },
    { key: "side", label: "方向", align: "center", width: "w-16", value: (r) => r.side, render: (r) => (
      <Chip tone={r.side === "buy" ? "rose" : "emerald"}>{r.side === "buy" ? "买入" : "卖出"}</Chip>) },
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <span className="whitespace-nowrap text-[13px]">{r.name}
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span></span>) },
    { key: "price", label: "价格", align: "right", value: (r) => r.price,
      render: (r) => <span className="nums">{price(r.price, 3)}</span> },
    { key: "quantity", label: "数量", align: "right", value: (r) => r.quantity, render: (r) => (
      <span className="nums">{r.quantity.toLocaleString("zh-CN")}</span>) },
    { key: "amount", label: "金额", align: "right", value: (r) => r.price * r.quantity, render: (r) => (
      <span className="nums">{num(r.price * r.quantity)}</span>) },
    { key: "fee", label: "手续费", align: "right", value: (r) => r.fee, render: (r) => (
      <span className="nums text-slate-500 dark:text-slate-400">{num(r.fee)}</span>) },
    { key: "note", label: "备注", value: (r) => r.note, render: (r) => (
      <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400" title={r.note}>
        {r.note || "—"}
      </span>) },
    ...(canManage ? [{ key: "ops", label: "操作", align: "right" as const, width: "w-16", render: (r: HoldingTrade) => (
      <Button size="sm" variant="danger" onClick={() => void onDel(r)}>删</Button>) }] : []),
  ];
}

function ruleColumns(
  canManage: boolean,
  testOut: Record<string, string>,
  onPatch: (r: HoldingRule, body: Record<string, unknown>, msg: string) => void,
  onDel: (r: HoldingRule) => void,
  onTest: (r: HoldingRule) => void,
): Column<HoldingRule>[] {
  return [
    { key: "typeLabel", label: "规则", value: (r) => r.typeLabel, render: (r) => (
      <div className="min-w-0">
        <Chip tone={r.tone as "rose"}>{r.typeLabel}</Chip>
        <span className="ml-1.5 whitespace-nowrap text-[11px] text-slate-400" title={r.desc}>{r.desc}</span>
      </div>) },
    { key: "accountName", label: "账户", width: "w-24", value: (r) => r.accountName, render: (r) => (
      <span className="whitespace-nowrap text-xs">{r.accountName}</span>) },
    { key: "threshold", label: "阈值", align: "right", value: (r) => r.threshold, render: (r) => (
      <span className="nums whitespace-nowrap text-xs">{r.threshold}{r.rule_type === "portfolio_price_stale" ? " 分钟" : "%"}</span>) },
    { key: "cooldown_min", label: "冷却", align: "right", value: (r) => r.cooldown_min, render: (r) => (
      <span className="nums text-xs text-slate-500 dark:text-slate-400">{r.cooldown_min} 分</span>) },
    { key: "enabled", label: "状态", align: "center", width: "w-16", value: (r) => (r.enabled ? "启用" : "停用"),
      render: (r) => <Chip tone={r.enabled ? "emerald" : "slate"}>{r.enabled ? "启用" : "停用"}</Chip> },
    { key: "test", label: "最近试算", value: (r) => testOut[String(r.id)] ?? "", render: (r) => (
      <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400"
        title={testOut[String(r.id)]}>
        {testOut[String(r.id)] ?? "点「试算」看当前是否触发"}
      </span>) },
    { key: "ops", label: "操作", align: "right", width: "w-40", render: (r) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => void onTest(r)}>试算</Button>
        <Button size="sm" variant="outline" disabled={!canManage}
          onClick={() => void onPatch(r, { enabled: !r.enabled }, r.enabled ? "规则已停用" : "规则已启用")}>
          {r.enabled ? "停用" : "启用"}
        </Button>
        <Button size="sm" variant="danger" disabled={!canManage} onClick={() => void onDel(r)}>删</Button>
      </div>) },
  ];
}

type TradeForm = {
  symbol: string; side: "buy" | "sell"; price: number; quantity: number;
  fee: number; tradeDate: string; note: string;
};

type RuleForm = {
  accountId: number; ruleType: string; threshold: number; cooldownMin: number; enabled: boolean;
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
