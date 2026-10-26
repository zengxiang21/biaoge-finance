import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { SimAccount, SimOrder, SimSummary } from "../lib/types";
import {
  Button, Chip, DataTable, Field, Panel, Skeleton, cn, inputClass, type Column,
} from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { num, price } from "../lib/format";

const TONE: Record<string, "emerald" | "sky" | "slate" | "amber"> = {
  filled: "emerald", pending: "sky", cancelled: "slate", rejected: "amber",
};

export default function SimulationOrdersPage() {
  const { hasPerm } = useSession();
  const nav = useNavigate();
  const canTrade = hasPerm("simulation:trade");

  const [accts, setAccts] = useState<SimAccount[]>([]);
  const [aid, setAid] = useState<number | null>(null);
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [sum, setSum] = useState<SimSummary | null>(null);
  const [status, setStatus] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<OrderForm | null>(null);

  const loadOrders = useCallback(async (id: number | null, st: string) => {
    const q: Record<string, string | number> = { limit: 300 };
    if (id) q.accountId = id;
    if (st) q.status = st;
    const out = await api.get<{ rows: SimOrder[]; statusLabels: Record<string, string>; cash?: number }>(
      "/simulation/orders", q, 45_000);
    setOrders(out.rows);
    setLabels(out.statusLabels ?? {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [a, s] = await Promise.all([
          api.get<{ rows: SimAccount[] }>("/simulation/accounts", {}, 45_000),
          api.get<SimSummary>("/simulation/summary", {}, 45_000),
        ]);
        setAccts(a.rows);
        setAid(a.rows[0]?.id ?? null);
        setSum(s);
        await loadOrders(a.rows[0]?.id ?? null, "");
      } catch (e) {
        toast(messageOf(e), "error");
      } finally {
        setBusy(false);
      }
    })();
  }, [loadOrders]);

  useEffect(() => {
    if (!busy) void loadOrders(aid, status).catch((e) => toast(messageOf(e), "error"));
  }, [aid, status, busy, loadOrders]);

  const cancel = async (o: SimOrder) => {
    if (!window.confirm(`撤销这笔委托？${o.symbol} ${o.side === "buy" ? "买入" : "卖出"} ${o.quantity} 股 @ ${o.price}`)) return;
    try {
      await api.post(`/simulation/orders/${o.id}/cancel`, {}, 25_000);
      toast("委托已撤销", "ok");
      await loadOrders(aid, status);
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const submit = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const out = await api.post<{ row: SimOrder }>("/simulation/orders", {
        accountId: aid, symbol: order.symbol, side: order.side,
        quantity: order.quantity, price: order.price || undefined,
      }, 45_000);
      const r = out.row;
      toast(`${r.side === "buy" ? "买入" : "卖出"} ${r.name ?? r.symbol} → ${r.statusLabel ?? r.status}`
        + (r.status === "rejected" ? `：${r.reason}` : ""),
      r.status === "filled" ? "ok" : r.status === "pending" ? "info" : "warn");
      setOrder(null);
      await loadOrders(aid, status);
      setSum(await api.get<SimSummary>("/simulation/summary", aid ? { accountId: aid } : {}, 45_000));
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const cols: Column<SimOrder>[] = [
    { key: "created_at", label: "委托时间", width: "w-40", value: (r) => r.created_at, render: (r) => (
      <span className="nums whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">{r.created_at}</span>) },
    { key: "name", label: "名称/代码", value: (r) => r.name, render: (r) => (
      <button type="button" className="whitespace-nowrap text-[13px] font-medium text-slate-800 hover:underline dark:text-slate-100"
        onClick={() => nav(`/stock-analysis/${r.symbol}`)}>
        {r.name || r.symbol}<span className="nums ml-1.5 text-[11px] text-slate-400">{r.symbol}</span>
      </button>) },
    { key: "side", label: "方向", align: "center", width: "w-16", value: (r) => r.side, render: (r) => (
      <Chip tone={r.side === "buy" ? "rose" : "emerald"}>{r.side === "buy" ? "买入" : "卖出"}</Chip>) },
    { key: "price", label: "委托价", align: "right", value: (r) => r.price, render: (r) => (
      <span className="nums">{price(r.price, 2)}</span>) },
    { key: "quantity", label: "数量", align: "right", value: (r) => r.quantity, render: (r) => (
      <span className="nums">{r.quantity.toLocaleString("zh-CN")}</span>) },
    { key: "filled_price", label: "成交价", align: "right", value: (r) => r.filled_price ?? -1, render: (r) => (
      <span className="nums text-slate-600 dark:text-slate-300">{r.filled_price ? price(r.filled_price, 2) : "—"}</span>) },
    { key: "amount", label: "成交金额", align: "right", value: (r) => r.amount ?? -1, render: (r) => (
      <span className="nums">{r.amount ? num(r.amount) : "—"}</span>) },
    { key: "fee", label: "手续费", align: "right", value: (r) => r.fee ?? -1, render: (r) => (
      <span className="nums text-slate-500 dark:text-slate-400">{r.fee ? num(r.fee) : "—"}</span>) },
    { key: "status", label: "状态", align: "center", width: "w-20", value: (r) => r.status, render: (r) => (
      <Chip tone={TONE[r.status] ?? "slate"}>{r.statusLabel ?? labels[r.status] ?? r.status}</Chip>) },
    { key: "reason", label: "说明", value: (r) => r.reason, render: (r) => (
      <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400" title={r.reason}>
        {r.reason || "—"}
      </span>) },
    { key: "ops", label: "操作", align: "right", width: "w-20", render: (r) => (
      r.status === "pending" && canTrade
        ? <Button size="sm" variant="danger" onClick={() => void cancel(r)}>撤单</Button>
        : <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>) },
  ];

  if (busy) return <Skeleton className="h-72 w-full" />;

  const pending = orders.filter((o) => o.status === "pending").length;

  return (
    <div className="space-y-4">
      <Panel
        title="模拟订单"
        subtitle={accts.length
          ? `账户「${sum?.accountName ?? ""}」可用现金 ${num(sum?.cash ?? 0, 0)} 元 · 共 ${orders.length} 笔委托，待成交 ${pending} 笔；限价单在现价触及时自动成交`
          : "还没有模拟账户，先去「模拟账户」页开一个"}
        right={(
          <>
            <Link to="/simulation/account"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              模拟账户
            </Link>
            {!!accts.length && canTrade && !order && (
              <Button size="sm" onClick={() => setOrder({ symbol: "", side: "buy", quantity: 100, price: 0 })}>下单</Button>
            )}
          </>
        )}
      >
        {order && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-5 dark:border-slate-700 dark:bg-slate-900/50">
            <Field label="股票代码">
              <input className={cn(inputClass, "nums")} value={order.symbol} placeholder="000001"
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
            <Field label="限价（元，0=市价）" hint="买价低于现价、卖价高于现价才挂单">
              <input className={cn(inputClass, "nums")} type="number" step="0.01" min={0} value={order.price}
                onChange={(e) => setOrder({ ...order, price: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOrder(null)}>取消</Button>
              <Button size="sm" loading={saving} onClick={() => void submit()}>提交委托</Button>
            </div>
          </div>
        )}

        {!!accts.length && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {accts.length > 1 && accts.map((a) => (
              <button key={a.id} type="button" onClick={() => setAid(a.id)}
                className={cn("rounded-lg border px-2.5 py-1 text-xs transition",
                  a.id === aid
                    ? "border-slate-800 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800")}>
                {a.name}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
            {[["", "全部"], ["pending", "待成交"], ["filled", "已成交"], ["cancelled", "已撤单"], ["rejected", "废单"]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setStatus(k)}
                className={cn("rounded-lg px-2.5 py-1 text-xs transition",
                  status === k
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}>
                {label}
              </button>
            ))}
          </div>
        )}

        <DataTable columns={cols} rows={orders} rowKey={(r) => r.id} dense maxHeight="520px"
          sortInitial={{ key: "created_at", desc: true }} empty="还没有委托" />
        <p className="mt-2 text-[11px] text-slate-400">
          撮合口径：市价单按下单时的实时价立即成交；限价买价须不高于现价、限价卖价须不低于现价，否则挂「待成交」，
          之后每次打开订单/持仓页时按最新现价重新撮合。资金不足或可卖不足会直接记为废单并写明原因。
        </p>
      </Panel>
    </div>
  );
}

type OrderForm = { symbol: string; side: "buy" | "sell"; quantity: number; price: number };
