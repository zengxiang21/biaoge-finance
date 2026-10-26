import { useEffect, useRef, useState } from "react";
import { api, messageOf } from "../lib/api";
import type { GeneralSettingsResult, MarketingPlan } from "../lib/types";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { Button, Chip, Field, inputClass, Panel, Skeleton } from "../components/ui";

/** 管理设置 · 通用设置（拆解文档 3.18.1） */

type BrandForm = { name: string; subtitle: string; logo: string; icp: string; footerNote: string };

export default function GeneralSettingsPage() {
  const refreshBrand = useSession((s) => s.refreshBrand);
  const [data, setData] = useState<GeneralSettingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brand, setBrand] = useState<BrandForm | null>(null);
  const [contact, setContact] = useState({ wechat: "", email: "", note: "" });
  const [plans, setPlans] = useState<MarketingPlan[]>([]);
  const [note, setNote] = useState("");
  const [qr, setQr] = useState({ wechat: "", alipay: "" });
  const logoInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<{ wechat: HTMLInputElement | null; alipay: HTMLInputElement | null }>({ wechat: null, alipay: null });

  async function load() {
    setLoading(true);
    try {
      const d = await api.get<GeneralSettingsResult>("/settings/general", undefined, 20000);
      setData(d);
      setBrand({ name: d.brand.name, subtitle: d.brand.subtitle, logo: d.brand.logo,
        icp: d.brand.icp, footerNote: d.brand.footer_note });
      setContact(d.marketing.contact);
      setPlans(d.marketing.plans);
      setNote(d.marketing.note);
      setQr(d.marketing.qr);
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setSaving(true);
    try {
      await fn();
      toast(okText, "ok");
      await refreshBrand();
      return true;
    } catch (e) {
      toast(messageOf(e), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveBrand() {
    if (!brand) return;
    if (!brand.name.trim()) return toast("平台名称不能空着", "warn");
    await run(() => api.put("/settings/general", {
      brand: { name: brand.name.trim(), subtitle: brand.subtitle.trim(), icp: brand.icp.trim(),
        footerNote: brand.footerNote.trim() },
      contact,
    }), "品牌信息已保存");
    await load();
  }

  async function saveMarketing() {
    for (const p of plans) {
      if (!p.label.trim()) return toast("方案名称不能空着", "warn");
      if (p.days < 1) return toast(`${p.label || "方案"} 的天数至少 1 天`, "warn");
      if (p.price < 0) return toast(`${p.label || "方案"} 的价格不能是负数`, "warn");
    }
    const ok = await run(() => api.put("/admin/settings/marketing", { plans, note, contact,
      qrWechat: qr.wechat, qrAlipay: qr.alipay }), "营销配置已保存");
    if (ok) await load();
  }

  async function upload(file: File, kind: "logo" | "wechat" | "alipay") {
    if (file.size > 2 * 1024 * 1024) return toast("图片超过 2MB，换张小一点的", "warn");
    const fd = new FormData();
    fd.append("file", file);
    setSaving(true);
    try {
      if (kind === "logo") {
        const r = await api.post<{ logo: string }>("/settings/general/logo", fd, 30000);
        setBrand((cur) => (cur ? { ...cur, logo: r.logo } : cur));
        toast("Logo 已上传", "ok");
      } else {
        const r = await api.post<{ qr: { wechat: string; alipay: string } }>(
          `/settings/general/qrcode?kind=${kind}`, fd, 30000);
        setQr(r.qr);
        toast("收款码已上传", "ok");
      }
      await refreshBrand();
      await load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
      if (logoInput.current) logoInput.current.value = "";
      for (const el of Object.values(qrInput.current)) if (el) el.value = "";
    }
  }

  async function clearImage(target: "brand.logo" | "qr.wechat" | "qr.alipay") {
    setSaving(true);
    try {
      await api.del(`/settings/general/image?target=${encodeURIComponent(target)}`);
      toast("图片已清除", "ok");
      await refreshBrand();
      await load();
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setSaving(false);
    }
  }

  function patchPlan(i: number, patch: Partial<MarketingPlan>) {
    setPlans((cur) => cur.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }

  if ((loading && !data) || !brand) {
    return (
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="平台基本信息" subtitle="名称、副标题、Logo 与页脚免责，改完侧栏和标题立刻生效"
        right={<Button size="sm" disabled={saving} onClick={() => void saveBrand()}>保存</Button>}>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {brand.logo ? (
              <img src={brand.logo} alt="当前 Logo" className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-800" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-rose-600 text-xl font-bold text-white">
                {brand.name.slice(0, 1) || "彪"}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" title={brand.name}>{brand.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={brand.subtitle}>{brand.subtitle}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, "logo"); }} />
                <Button size="sm" variant="outline" disabled={saving} onClick={() => logoInput.current?.click()}>
                  上传 Logo
                </Button>
                {brand.logo && (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void clearImage("brand.logo")}>
                    清除 Logo
                  </Button>
                )}
                <Chip tone="slate">支持 png/jpg/webp/gif，≤2MB</Chip>
              </div>
            </div>
          </div>
          <Field label="平台名称"><input className={inputClass} value={brand.name}
            onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></Field>
          <Field label="副标题"><input className={inputClass} value={brand.subtitle}
            onChange={(e) => setBrand({ ...brand, subtitle: e.target.value })} /></Field>
          <Field label="ICP 备案号" hint="没有就留空">
            <input className={inputClass} value={brand.icp} onChange={(e) => setBrand({ ...brand, icp: e.target.value })} /></Field>
          <Field label="页脚说明">
            <textarea rows={2} className={`${inputClass} w-full resize-y`} value={brand.footerNote}
              onChange={(e) => setBrand({ ...brand, footerNote: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="客服微信"><input className={inputClass} value={contact.wechat}
              onChange={(e) => setContact({ ...contact, wechat: e.target.value })} /></Field>
            <Field label="客服邮箱"><input className={inputClass} value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
          </div>
          <Field label="联系方式说明">
            <input className={inputClass} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} />
          </Field>
        </div>
      </Panel>

      <div className="space-y-3">
        <Panel title="订阅方案与价格" subtitle="月/季/年方案展示在个人中心，改完记得保存"
          right={<Button size="sm" disabled={saving} onClick={() => void saveMarketing()}>保存营销</Button>}>
          <div className="space-y-2.5">
            {plans.map((p, i) => (
              <div key={`${p.key}-${i}`} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${inputClass} w-24! shrink-0`} value={p.label} aria-label="方案名"
                    onChange={(e) => patchPlan(i, { label: e.target.value })} />
                  <span className="text-[11px] text-slate-400">价格</span>
                  <input type="number" min={0} step={1} className={`${inputClass} w-24! shrink-0`} value={p.price} aria-label="价格"
                    onChange={(e) => patchPlan(i, { price: Number(e.target.value) })} />
                  <span className="text-[11px] text-slate-400">元 /</span>
                  <input className={`${inputClass} w-16! shrink-0`} value={p.period} aria-label="周期名"
                    onChange={(e) => patchPlan(i, { period: e.target.value })} />
                  <span className="text-[11px] text-slate-400">有效</span>
                  <input type="number" min={1} step={1} className={`${inputClass} w-20! shrink-0`} value={p.days} aria-label="天数"
                    onChange={(e) => patchPlan(i, { days: Number(e.target.value) })} />
                  <span className="text-[11px] text-slate-400">天</span>
                  <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={p.recommended} className="h-3.5 w-3.5 accent-rose-600"
                      onChange={(e) => patchPlan(i, { recommended: e.target.checked })} />推荐
                  </label>
                  <Button size="sm" variant="ghost" disabled={saving}
                    onClick={() => setPlans((cur) => cur.filter((_, k) => k !== i))}>删掉</Button>
                </div>
                <input className={`${inputClass} mt-2 w-full`} value={p.features.join("，")} aria-label="权益"
                  placeholder="权益用中文逗号隔开"
                  onChange={(e) => patchPlan(i, { features: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean) })} />
              </div>
            ))}
            <Button size="sm" variant="outline" disabled={saving}
              onClick={() => setPlans((cur) => [...cur, {
                key: `plan${cur.length + 1}`, label: "新方案", price: 0, days: 30, period: "月",
                features: [], recommended: false,
              }])}>加一个方案</Button>
            <Field label="营销备注"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Panel>

        <Panel title="收款码" subtitle="微信 / 支付宝个人收款码，早期人工开通会员用">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["wechat", "alipay"] as const).map((kind) => (
              <div key={kind} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <p className="text-xs font-medium">{kind === "wechat" ? "微信收款码" : "支付宝收款码"}</p>
                {qr[kind] ? (
                  <img src={qr[kind]} alt="" className="mt-2 h-28 w-full rounded-lg border border-slate-200 object-contain dark:border-slate-800" />
                ) : (
                  <p className="mt-2 grid h-28 place-items-center rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-400 dark:border-slate-700">
                    还没上传
                  </p>
                )}
                <input ref={(el) => { qrInput.current[kind] = el; }} type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, kind); }} />
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => qrInput.current[kind]?.click()}>
                    上传
                  </Button>
                  {qr[kind] && (
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => void clearImage(`qr.${kind}`)}>
                      清除
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            上传的文件放在 <span className="font-mono">{data?.storage?.uploadDir ?? "backend/data/uploads"}</span>，
            收款码本身不含密钥，仍建议只放对外可见的图。
          </p>
        </Panel>
      </div>
    </div>
  );
}
