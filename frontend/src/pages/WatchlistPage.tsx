import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { SearchHit, WatchItem } from "../lib/types";
import { money, num, price, timeAgo } from "../lib/format";
import {
  Button, Chip, DataTable, EmptyState, Field, Panel, Skeleton, UpDown, cn, inputClass, type Column,
} from "../components/ui";
import { toast } from "../store/toast";
import { useSession } from "../store/session";

const RECENT_KEY = "tsp-saas.stock-analysis.recent";

type QuotesResp = { items: WatchItem[]; asOf: string; source: string; errors?: string[] };

export default function WatchlistPage() {
  const [rows, setRows] = useState<WatchItem[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [recent, setRecent] = useState<SearchHit[]>(() => readRecent());
  const searchTimer = useRef<number | null>(null);
  const hasPerm = useSession((s) => s.hasPerm);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get<QuotesResp>("/watchlists/default/quotes");
      setRows(r.items);
      setAsOf(r.asOf);
      setDegraded(r.source === "degraded" ? (r.errors ?? []).join("；") : null);
    } catch (e) {
      toast(messageOf(e), "error");
      setRows((old) => old ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // 输入防抖搜索（文档 3.4：先查本地快照，再回落新浪联想）
  useEffect(() => {
    const kw = keyword.trim();
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!kw) { setHits([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ rows: SearchHit[] }>("/market-data/securities/search", { keyword: kw });
        setHits(r.rows);
      } catch (e) {
        toast(messageOf(e), "error");
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [keyword]);

  const add = async (hit: SearchHit) => {
    setAdding(hit.symbol);
    try {
      await api.post("/watchlists/items", { keyword: hit.symbol, note });
      toast(`已加入自选：${hit.name}`, "ok");
      pushRecent(hit);
      setRecent(readRecent());
      setKeyword("");
      setHits([]);
      setNote("");
      await load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setAdding(null);
    }
  };

  const remove = async (row: WatchItem) => {
    try {
      await api.del(`/watchlists/items/${row.id}`);
      toast(`已删除 ${row.name}`, "info");
      setRows((old) => (old ?? []).filter((i) => i.id !== row.id));
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const stats = useMemo(() => {
    const list = rows ?? [];
    const ups = list.filter((r) => (r.change_percent ?? 0) > 0).length;
    const downs = list.filter((r) => (r.change_percent ?? 0) < 0).length;
    const avg = list.length
      ? list.reduce((a, r) => a + (r.change_percent ?? 0), 0) / list.length
      : null;
    return { ups, downs, avg, amount: list.reduce((a, r) => a + (r.amount ?? 0), 0) };
  }, [rows]);

  const columns: Column<WatchItem>[] = [
    { key: "name", label: "名称/代码", render: (r) => (
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{r.name}</span>
        <span className="nums text-[11px] text-slate-400">{r.symbol}</span>
        {r.stale && <Chip tone="amber">快照</Chip>}
      </span>) },
    { key: "price", label: "现价", align: "right", value: (r) => r.price ?? null,
      render: (r) => <span className="nums">{price(r.price)}</span> },
    { key: "change_percent", label: "涨跌幅", align: "right", value: (r) => r.change_percent ?? null,
      render: (r) => <UpDown value={r.change_percent ?? null} /> },
    { key: "change_price", label: "涨跌额", align: "right", value: (r) => r.change_price ?? null,
      render: (r) => <span className={cn("nums", (r.change_price ?? 0) > 0 ? "text-rose-500"
        : (r.change_price ?? 0) < 0 ? "text-emerald-500" : "text-slate-400")}>
        {price(r.change_price)}</span> },
    { key: "amount", label: "成交额", align: "right", value: (r) => r.amount ?? null,
      render: (r) => <span className="nums text-slate-500">{money(r.amount)}</span> },
    { key: "turnover_ratio", label: "换手率", align: "right", value: (r) => r.turnover_ratio ?? null,
      render: (r) => <span className="nums text-slate-500">{num(r.turnover_ratio, 2, "%")}</span> },
    { key: "range", label: "当日区间", align: "right", render: (r) => (
      <span className="nums text-[11px] text-slate-400">
        {price(r.low)} – {price(r.high)}
        {r.prev_close !== null && r.prev_close !== undefined &&
          <span className="opacity-70">（昨收 {price(r.prev_close)}）</span>}
      </span>) },
    { key: "note", label: "备注", render: (r) => <span className="text-xs text-slate-500">{r.note || "—"}</span> },
    { key: "ops", label: "操作", align: "right", render: (r) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => navigate(`/data/quotes?symbol=${r.symbol}`)}>看行情</Button>
        {hasPerm("watchlist:item_delete") && (
          <Button size="sm" variant="danger" onClick={() => void remove(r)}>删除</Button>
        )}
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="自选股"
        subtitle={rows === null
          ? "正在拉取实时行情…"
          : `${rows.length} 只 · 涨 ${stats.ups} 跌 ${stats.downs} · 平均 ${stats.avg === null ? "—" : `${stats.avg.toFixed(2)}%`} · 合计成交 ${money(stats.amount)} · 行情时间 ${timeAgo(asOf)}`}
        right={<Button size="sm" variant="outline" loading={busy} onClick={() => void load()}>刷新行情</Button>}
      >
        {degraded && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            实时源不可用（{degraded}），下面是最近一次收盘快照，字段带「快照」标记
          </p>
        )}
        {rows === null ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty="还没有自选股，用下面的搜索框加一只"
            sortInitial={{ key: "change_percent", desc: true }}
            onRowClick={(r) => navigate(`/data/quotes?symbol=${r.symbol}`)}
          />
        )}
      </Panel>

      <Panel title="添加自选" subtitle="按名称/代码/拼音搜索全市场，点「加入」写进自选列表">
        {!hasPerm("watchlist:item_create") ? (
          <EmptyState text="当前账号没有添加自选的权限" hint="联系管理员开通 watchlist:item_create" />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="搜索股票">
                <input className={inputClass} value={keyword} placeholder="比如 贵州茅台 / 600519 / sh600519"
                  onChange={(e) => setKeyword(e.target.value)} />
              </Field>
              <Field label="备注（可选）">
                <input className={inputClass} value={note} placeholder="成本价/逻辑" maxLength={40}
                  onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>

            {searching && <p className="text-xs text-slate-400">搜索中…</p>}

            {!keyword.trim() && recent.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] text-slate-500">最近搜索</p>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r) => (
                    <button key={r.symbol} type="button" onClick={() => setKeyword(r.name)}
                      className="nums rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800">
                      {r.name} {r.symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!!keyword.trim() && (
              hits.length === 0 ? (
                <EmptyState text={searching ? "搜索中…" : "没匹配到股票，试试股票代码"}
                  hint="搜索先查本地全市场快照，快照没建好时只能按代码猜" />
              ) : (
                <DataTable
                  dense
                  maxHeight="max-h-64"
                  rows={hits}
                  rowKey={(r) => r.symbol}
                  sortInitial={{ key: "change_percent", desc: true }}
                  columns={[
                    { key: "name", label: "名称", render: (r) => (
                      <span>{r.name}<span className="ml-1.5 nums text-[10px] text-slate-400">{r.symbol}</span>
                        {r.matched === "code-guess" && <Chip className="ml-1.5" tone="sky">按代码推断</Chip>}</span>) },
                    { key: "price", label: "现价", align: "right", value: (r) => r.price,
                      render: (r) => <span className="nums">{r.price === null ? "—" : r.price.toFixed(2)}</span> },
                    { key: "change_percent", label: "涨跌幅", align: "right", value: (r) => r.change_percent,
                      render: (r) => <UpDown value={r.change_percent} /> },
                    { key: "ops", label: "", align: "right", render: (r) => (
                      <Button size="sm" loading={adding === r.symbol} onClick={() => void add(r)}>加入</Button>) },
                  ]}
                />
              )
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function readRecent(): SearchHit[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as SearchHit[]).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function pushRecent(hit: SearchHit) {
  const next = [hit, ...readRecent().filter((r) => r.symbol !== hit.symbol)].slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
