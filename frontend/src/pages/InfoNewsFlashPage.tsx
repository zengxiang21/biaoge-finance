import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { NewsFlashResult, NewsItem, RadarConfig, RadarResult } from "../lib/types";
import { clock } from "../lib/format";
import { Button, Chip, EmptyState, Field, Panel, Skeleton, cn, inputClass } from "../components/ui";
import { toast } from "../store/toast";

const SOURCES = [
  { key: "", label: "全部来源" },
  { key: "7x24", label: "东财 7x24" },
  { key: "滚动", label: "新浪滚动" },
];

export default function InfoNewsFlashPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<NewsFlashResult | null>(null);
  const [radar, setRadar] = useState<RadarConfig | null>(null);
  const [cached24h, setCached24h] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [onlyRadar, setOnlyRadar] = useState(false);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<NewsFlashResult>("/info/news-flash", {
        size: 80, ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(source ? { source } : {}), ...(onlyRadar ? { only_radar: true } : {}),
      }, 40_000);
      setData(r);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [keyword, source, onlyRadar]);

  const loadRadar = useCallback(async () => {
    try {
      const r = await api.get<RadarResult>("/info/news-radar");
      setRadar(r.config);
      setCached24h(r.cachedNews24h);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void loadRadar();
  }, [loadRadar]);

  // 关键词输入防抖，自动刷新按雷达配置的间隔走
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), keyword ? 350 : 60);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [load, keyword]);

  const intervalMin = Number(radar?.interval_min ?? 5) || 5;
  useEffect(() => {
    if (!auto) return;
    const ms = Math.max(1, intervalMin) * 60_000;
    const id = window.setInterval(() => void load(), ms);
    return () => window.clearInterval(id);
  }, [auto, intervalMin, load]);

  const saveRadar = async () => {
    if (!radar) return;
    setSaving(true);
    try {
      await api.put("/info/news-radar", radar);
      toast("雷达配置已保存", "ok");
      setShowRadar(false);
      void load();
      void loadRadar();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const items = data?.items ?? [];
  const radarHits = useMemo(() => items.filter((i) => i.radar).length, [items]);

  return (
    <div className="space-y-4">
      <Panel
        title="快讯 · 新闻雷达"
        subtitle={data
          ? `${data.generatedAt} · 本次 ${items.length} 条（命中雷达 ${radarHits} 条）· 近 24 小时已缓存 ${cached24h} 条 · 服务端 ${data.cachedSeconds} 秒短缓存`
          : error ?? "正在抓取 7x24 快讯…"}
        right={(
          <>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              自动刷新 {intervalMin} 分
            </label>
            <Button size="sm" variant="outline" onClick={() => setShowRadar((v) => !v)}>
              {showRadar ? "收起雷达" : "雷达设置"}
            </Button>
            <Button size="sm" variant="outline" loading={busy && !!data} onClick={() => { void load(); void loadRadar(); }}>刷新</Button>
          </>
        )}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <Field label="关键词过滤">
              <input className={inputClass} value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder="例如 回购、业绩、涨停" />
            </Field>
          </div>
          <Field label="来源">
            <select className={cn(inputClass, "w-36")} value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <label className="mb-2 flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={onlyRadar} onChange={(e) => setOnlyRadar(e.target.checked)} />
            只看雷达命中
          </label>
        </div>

        {showRadar && radar && (
          <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 lg:grid-cols-3">
            <Field label="启用雷达">
              <div className="flex items-center gap-3 pt-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={radar.enabled}
                    onChange={(e) => setRadar({ ...radar, enabled: e.target.checked })} />
                  {radar.enabled ? "已启用" : "已停用"}
                </label>
                <span className="text-xs text-slate-400">命中关键词的快讯会置顶</span>
              </div>
            </Field>
            <Field label="刷新间隔（分钟）" hint="同时控制本页自动刷新频率">
              <input className={inputClass} type="number" min={1} max={60} value={radar.interval_min}
                onChange={(e) => setRadar({ ...radar, interval_min: Number(e.target.value) })} />
            </Field>
            <Field label="最低重要度" hint="标题命中计 2 分，正文命中计 1 分">
              <input className={inputClass} type="number" min={1} max={6} value={radar.min_importance}
                onChange={(e) => setRadar({ ...radar, min_importance: Number(e.target.value) })} />
            </Field>
            <div className="lg:col-span-2">
              <Field label="关键词（逗号或空格分隔）">
                <textarea className={cn(inputClass, "h-20 resize-y font-mono text-xs")}
                  value={radar.keywords.join("，")}
                  onChange={(e) => setRadar({ ...radar, keywords: splitList(e.target.value) })} />
              </Field>
            </div>
            <Field label="排除词">
              <textarea className={cn(inputClass, "h-20 resize-y font-mono text-xs")}
                value={radar.exclude.join("，")}
                onChange={(e) => setRadar({ ...radar, exclude: splitList(e.target.value) })} />
            </Field>
            <div className="lg:col-span-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                当前 {radar.keywords.length} 个关键词、{radar.exclude.length} 个排除词
              </span>
              <Button size="sm" loading={saving} onClick={() => void saveRadar()}>保存雷达配置</Button>
            </div>
          </div>
        )}

        {busy && !data ? (
          <div className="mt-4 space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState text="没有符合条件的快讯" hint="换个关键词，或关掉「只看雷达命中」" />
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((n) => <NewsRow key={n.id} n={n} onStock={(s) => navigate(`/stock-analysis/${s}`)} />)}
          </ul>
        )}

        {!!data && Object.keys(data.errors).length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            部分来源取数失败：{Object.entries(data.errors).map(([k, v]) => `${k}：${v}`).join("；")}
          </p>
        )}
      </Panel>
    </div>
  );
}

function splitList(v: string): string[] {
  return Array.from(new Set(v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)));
}

function NewsRow({ n, onStock }: { n: NewsItem; onStock: (symbol: string) => void }) {
  return (
    <li className="flex gap-3 py-2.5">
      <div className="nums w-11 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-slate-400">
        {clock(n.time)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {n.radar && <Chip tone="amber">雷达 {n.importance}</Chip>}
          {n.keywords.slice(0, 4).map((k) => <Chip key={k} tone="sky">{k}</Chip>)}
          <span className="text-[10px] text-slate-400">{n.source}{n.channel ? ` · ${n.channel}` : ""}</span>
        </div>
        {n.url ? (
          <a href={n.url} target="_blank" rel="noreferrer"
            className="mt-0.5 block text-[13px] font-medium leading-snug text-slate-800 underline-offset-2 hover:underline dark:text-slate-100">
            {n.title}
          </a>
        ) : (
          <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-800 dark:text-slate-100">{n.title}</p>
        )}
        {n.summary && n.summary !== n.title && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
            title={n.summary}>{n.summary}</p>
        )}
        {n.stockNames.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {n.stockNames.map((s) => (
              <button key={s.symbol} type="button" onClick={() => onStock(s.symbol)}
                className="nums rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white">
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
