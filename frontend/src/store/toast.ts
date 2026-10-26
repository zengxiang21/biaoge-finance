import { create } from "zustand";

export type ToastKind = "info" | "ok" | "error" | "warn";
export type ToastItem = { id: number; text: string; kind: ToastKind };

type ToastStore = {
  items: ToastItem[];
  push: (text: string, kind?: ToastKind) => void;
  drop: (id: number) => void;
};

let seq = 1;

const useToast = create<ToastStore>((set) => ({
  items: [],
  push: (text, kind = "info") => {
    const id = seq++;
    set((s) => ({ items: [...s.items, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 4200);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** 供非组件代码（拦截器）直接调用 */
export function toast(text: string, kind: ToastKind = "info") {
  useToast.getState().push(text, kind);
}

export { useToast };
