import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { SimAccount, SimOrder, SimPosition, SimSummary } from "../lib/types";
import {
  Button, Chip, DataTable, EmptyState, Field, Panel, Skeleton, UpDown,
  cn, inputClass, type Column,
} from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { num, pct, price } from "../lib/format";

export default function SimulationAccountPage() {
  const { hasPerm } = useSession();
  const nav = useNavigate();
  const canTrade = hasPerm("simulation:trade");

  const [accts, setAccts] = useState<SimAccount[]>([]);
  const [fee, setFee] = useState<{ rate: number; min: number; stamp: number } | null>(null);
  const [aid, setAid] = useState<number | null>(null);
  const [sum, setSum] = useState<SimSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftAcc, setDraftAcc] = useState<{ name: string; capital: number } | null>(null);
  const [order, setOrder] = useState<OrderForm | null>(null);
  const [placed, setPlaced] = useState<SimOrder | null>(null);

  const loadAccounts = useCallback(async () => {
    const out = await api.get<{ rows: SimAccount[]; meta: { fee: { rate: number; min: number; stamp: number } } }>(
      "/simulation/accounts", {}, 45_000);
    setAccts(out.rows);
    setFee(out.meta.fee);
    setAid((cur) => (cur && out.rows.some((r) => r.id === cur) ? cur : out.rows[0]?.id ?? null));
  }, []);

  const loadSummary = useCallback(async (id: number | null) => {
    setLoading(true);
    try {
      setSum(await api.get<SimSummary>("/simulation/summary", id ? { accountId: id } : {}, 45_000));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts().catch((e) => toast(messageOf(e), "error")).finally(() => setBusy(false));
  }, [loadAccounts]);

  useEffect(() => {
    if (!busy) void loadSummary(aid).catch((e) => toast(messageOf(e), "error"));
  }, [aid, busy, loadSummary]);

  const refresh = async () => {
    await loadAccounts();
    await loadSummary(aid);
  };

  const createAccount = async () => {
    if (!draftAcc) return;
    setSaving(true);
    try {
      const out = await api.post<{ row: SimAccount }>("/simulation/accounts",
        { name: draftAcc.name, initialCapital: draftAcc.capital }, 25_000);
      toast(`已开设模拟账户「${out.row.name}」，可用资金 ${num(out.row.cash, 0)} 元`, "ok");
      setDraftAcc(null);
      setAid(out.row.id);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (a: SimAccount) => {
    if (!window.confirm(`删除「${a.name}」？该账户的 ${a.orderCount} 笔订单与持仓会一并清除。`)) return;
    try {
      await api.del(`/simulation/accounts/${a.id}`);
      toast("模拟账户已删除", "ok");
      if (aid === a.id) setAid(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const submitOrder = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const out = await api.post<{ row: SimOrder }>("/simulation/orders", {
        accountId: aid, symbol: order.symbol, side: order.side,
        quantity: order.quantity, price: order.price || undefined,
      }, 45_000);
      setPlaced(out.row);
      toast(`${out.row.side === "buy" ? "买入" : "卖出"} ${out.row.name ?? out.row.symbol}：${out.row.statusLabel ?? out.row.status}`,
        out.row.status === "filled" ? "ok" : out.row.status === "pending" ? "info" : "warn");
      setOrder(null);
      await refresh();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  if (busy) return <Skeleton className="h-80 w-full" />;

  const current = accts.find((a) => a.id === aid) ?? null;
  const positions = sum?.rows ?? [];

  const posCols: Column<SimPosition>[] = [
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <div className="min-w-0">
        <button type="button" className="whitespace-nowrap text-[13px] font-medium text-slate-800 hover:underline dark:text-slate-100"
          onClick={() => nav(`/stock-analysis/${r.symbol}`)}>{r.name}</button>
        <span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
      </div>) },
    { key: "quantity", label: "持仓", align: "right", value: (r) => r.quantity, render: (r) => (
      <span className="nums">{r.quantity.toLocaleString("zh-CN")}</span>) },
    { key: "costPrice", label: "成本", align: "right", value: (r) => r.costPrice, render: (r) => (
      <span className="nums">{price(r.costPrice, 3)}</span>) },
    { key: "price", label: "现价", align: "right", value: (r) => r.price, render: (r) => (
      <span className="nums">{price(r.price)}<UpDown className="ml-1.5 text-[11px]" value={r.changePercent} /></span>) },
    { key: "marketValue", label: "市值", align: "right", value: (r) => r.marketValue, render: (r) => (
      <span className="nums">{num(r.marketValue)}</span>) },
    { key: "unrealized", label: "浮动盈亏", align: "right", value: (r) => r.unrealized, render: (r) => (
      <UpDown value={r.unrealized} suffix="" className="nums" />) },
    { key: "profitRate", label: "收益率", align: "right", value: (r) => r.profitRate, render: (r) => <UpDown value={r.profitRate} /> },
    { key: "weight", label: "占仓位", align: "right", value: (r) => r.weight, render: (r) => (
      <span className="nums text-xs text-slate-500 dark:text-slate-400">{pct(r.weight, 1)}</span>) },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="模拟账户"
        subtitle={accts.length
          ? `${accts.length} 个虚拟资金账户 · 现价即时撮合，佣金万三（最低 ${fee?.min ?? 5} 元）、卖出另收千分之${((fee?.stamp ?? 0.001) * 1000).toFixed(0)}印花税`
          : "还没有模拟账户，先开一个，默认 100 万虚拟资金"}
        right={(
          <>
            <Link to="/simulation/orders"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              模拟订单
            </Link>
            <Button size="sm" variant="outline" disabled={!canTrade}
              onClick={() => setDraftAcc({ name: "", capital: 1_000_000 })}>开新账户</Button>
          </>
        )}
      >
        {draftAcc && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/50">
            <Field label="账户名称">
              <input className={inputClass} value={draftAcc.name} placeholder="比如：打板练习仓"
                onChange={(e) => setDraftAcc({ ...draftAcc, name: e.target.value })} />
            </Field>
            <Field label="初始虚拟资金（元）">
              <input className={cn(inputClass, "nums")} type="number" min={10000} step={100000}
                value={draftAcc.capital}
                onChange={(e) => setDraftAcc({ ...draftAcc, capital: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end justify-end gap-2 lg:col-span-2">
              <Button size="sm" variant="ghost" onClick={() => setDraftAcc(null)}>取消</Button>
              <Button size="sm" loading={saving} onClick={() => void createAccount()}>开户</Button>
            </div>
          </div>
        )}

        {!!accts.length && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {accts.map((a) => (
              <button key={a.id} type="button" onClick={() => setAid(a.id)}
                className={cn("rounded-lg border px-2.5 py-1.5 text-xs transition",
                  a.id === aid
                    ? "border-slate-800 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                {a.name}
                <span className={cn("nums ml-1.5", a.id === aid ? "opacity-70" : "text-slate-400")}>
                  {num(a.totalAssets, 0)}
                </span>
              </button>
            ))}
            {canTrade && current && (
              <button type="button" onClick={() => void removeAccount(current)} title="删除当前账户"
                className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-xs text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10">
                注销「{current.name}」
              </button>
            )}
          </div>
        )}

        {!accts.length ? (
          <EmptyState text="还没有模拟账户" hint="点右上「开新账户」，虚拟资金不会真买票，随便试" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <Stat label="总资产" value={sum?.totalAssets} />
              <Stat label="可用现金" value={sum?.cash} />
              <Stat label="持仓市值" value={sum?.marketValue} />
              <Stat label="浮动盈亏" value={positions.reduce((s, r) => s + r.unrealized, 0)} signed />
              <Stat label="已实现盈亏" value={sum?.realized} signed />
              <Stat label="累计收益率" value={sum?.profitRate} suffix="%" signed />
              <Stat label="订单数" value={sum?.orderCount} suffix=" 笔" />
              <Stat label="卖出胜率" value={sum?.winRate} suffix="%"
                hint={sum?.sellCount ? `${sum.winCount}/${sum.sellCount} 笔盈利` : "还没有卖出成交"} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canTrade && !order && (
                <Button size="sm" onClick={() => setOrder({ symbol: "", side: "buy", quantity: 100, price: 0 })}>下单</Button>
              )}
              {order && (
                <div className="grid w-full gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-5 dark:border-slate-700 dark:bg-slate-900/50">
                  <Field label="股票代码" hint="6 位代码或 sh600519">
                    <input className={cn(inputClass, "nums")} value={order.symbol} placeholder="600519"
                      onChange={(e) => setOrder({ ...order, symbol: e.target.value })} />
                  </Field>
                  <Field label="方向">
                    <select className={inputClass} value={order.side}
                      onChange={(e) => setOrder({ ...order, side: e.target.value as "buy" | "sell" })}>
                      <option value="buy">买入</option>
                      <option value="sell">卖出</option>
                    </select>
                  </Field>
                  <Field label="数量（股）" hint="一手 100 股">
                    <input className={cn(inputClass, "nums")} type="number" step={100} min={100} value={order.quantity}
                      onChange={(e) => setOrder({ ...order, quantity: Number(e.target.value) })} />
                  </Field>
                  <Field label="限价（元，0=市价）" hint="买价低于现价 / 卖价高于现价则挂单">
                    <input className={cn(inputClass, "nums")} type="number" step="0.01" min={0} value={order.price}
                      onChange={(e) => setOrder({ ...order, price: Number(e.target.value) })} />
                  </Field>
                  <div className="flex items-end justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setOrder(null)}>取消</Button>
                    <Button size="sm" loading={saving} onClick={() => void submitOrder()}>提交</Button>
                  </div>
                </div>
              )}
              {placed && (
                <p className="w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  最新委托：{placed.symbol} {placed.side === "buy" ? "买入" : "卖出"} {placed.quantity} 股 →
                  <Chip className="mx-1.5" tone={placed.status === "filled" ? "emerald" : placed.status === "pending" ? "sky" : "amber"}>
                    {placed.statusLabel ?? placed.status}
                  </Chip>
                  {placed.filled_price ? `成交价 ${placed.filled_price}，金额 ${num(placed.amount ?? 0)}，手续费 ${num(placed.fee ?? 0)}` : placed.reason}
                </p>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void refresh()}>刷新</Button>
            </div>

            <div className="mt-3">
              {loading && !sum ? <Skeleton className="h-40 w-full" /> : positions.length ? (
                <DataTable columns={posCols} rows={positions} rowKey={(r) => r.symbol} dense maxHeight="380px"
                  sortInitial={{ key: "marketValue", desc: true }} />
              ) : (
                <EmptyState text="当前空仓" hint="点「下单」按现价买一笔，成交后立刻出现在这里" />
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

type OrderForm = { symbol: string; side: "buy" | "sell"; quantity: number; price: number };

function Stat({ label, value, suffix = "元", signed, hint }: {
  label: string; value: number | null | undefined; suffix?: string; signed?: boolean; hint?: string;
}) {
  const isNum = typeof value === "number" && !Number.isNaN(value);
  const color = !isNum ? "text-slate-400"
    : signed && value > 0 ? "text-rose-500"
      : signed && value < 0 ? "text-emerald-600" : "text-slate-800 dark:text-slate-100";
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60" title={hint}>
      <p className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("nums truncate text-base font-semibold", color)}>
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
