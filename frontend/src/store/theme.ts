import { create } from "zustand";

export const THEME_KEY = "tsp-saas.ui.theme";
export type Theme = "light" | "dark";

function initial(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(THEME_KEY, theme);
}

const useTheme = create<{ theme: Theme; set: (t: Theme) => void; toggle: () => void }>((set, get) => ({
  theme: initial(),
  set: (theme) => {
    apply(theme);
    set({ theme });
  },
  toggle: () => get().set(get().theme === "dark" ? "light" : "dark"),
}));

apply(useTheme.getState().theme);

export { useTheme };
