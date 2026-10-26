import { useEffect, useRef, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { SearchHit } from "../lib/types";
import { Spinner, cn, inputClass } from "./ui";

type Props = {
  /** 选定后回调，父组件负责真正取数 */
  onPick: (symbol: string, name: string) => void;
  placeholder?: string;
  /** localStorage 里存最近选择的 key，不同页面分开存 */
  recentKey: string;
  /** 当前已选标的，显示在输入框右侧提示里 */
  current?: { symbol: string; name: string } | null;
  preset?: string;
};

const MAX_RECENT = 8;

export function readRecent(key: string): SearchHit[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((r) => r && r.symbol) : [];
  } catch {
    return [];
  }
}

function writeRecent(key: string, hit: SearchHit) {
  const next = [hit, ...readRecent(key).filter((r) => r.symbol !== hit.symbol)].slice(0, MAX_RECENT);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
}

/** 财务/基础数据类页面共用的股票选择器：搜索命中 + 最近使用 */
export function SymbolSearchBar({ onPick, placeholder = "输入股票名称或代码", recentKey, current, preset }: Props) {
  const [input, setInput] = useState(preset ?? "");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>(() => readRecent(recentKey));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (hit: SearchHit) => {
    writeRecent(recentKey, hit);
    setRecent(readRecent(recentKey));
    setInput(hit.name);
    setOpen(false);
    onPick(hit.symbol, hit.name);
  };

  const search = (kw: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!kw.trim()) { setHits([]); return; }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.get<{ rows: SearchHit[] }>("/research/search", { keyword: kw.trim(), limit: 12 }, 30_000);
        setHits(r.rows ?? []);
        setErr(null);
        setOpen(true);
      } catch (e) { setErr(messageOf(e)); }
      setBusy(false);
    }, 320);
  };

  return (
    <div ref={boxRef} className="relative w-64! shrink-0">
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); search(e.target.value); }}
          onFocus={() => { if (hits.length || recent.length) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) choose(hits[0]); }}
          placeholder={placeholder}
          className={cn(inputClass, "h-8 !py-1 text-xs")}
          aria-label="股票搜索"
        />
        {busy && <Spinner />}
      </div>
      {current && (
        <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          当前：{current.name} <span className="nums">{current.symbol}</span>
        </p>
      )}
      {err && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{err}</p>}

      {open && (hits.length > 0 || recent.length > 0) && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {hits.length > 0 && (
            <>
              <p className="px-3 pt-2 text-[10px] font-semibold text-slate-400">搜索命中</p>
              {hits.map((r) => (
                <button key={r.symbol} type="button" onClick={() => choose(r)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="min-w-0 whitespace-normal text-slate-700 dark:text-slate-200">{r.name}</span>
                  <span className="nums shrink-0 text-[11px] text-slate-400">{r.symbol}</span>
                </button>
              ))}
            </>
          )}
          {recent.length > 0 && (
            <>
              <p className="px-3 pt-2 text-[10px] font-semibold text-slate-400">最近使用</p>
              {recent.map((r) => (
                <button key={r.symbol} type="button" onClick={() => choose(r)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="min-w-0 whitespace-normal text-slate-700 dark:text-slate-200">{r.name}</span>
                  <span className="nums shrink-0 text-[11px] text-slate-400">{r.symbol}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
