import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import { makeT, type Lang, type TKey } from "./i18n";
import { setCurrencySymbol } from "./format";
import type { Bootstrap } from "./types";

interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
}

interface AppState {
  boot: Bootstrap | null;
  loading: boolean;
  lang: Lang;
  t: (k: TKey, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => void;
  refreshBoot: () => Promise<void>;
  toast: (text: string, kind?: "ok" | "err") => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);

let toastSeq = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("lang") === "en" ? "en" : "zh"));
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshBoot = useCallback(async () => {
    const b = await api.bootstrap();
    setCurrencySymbol(b.settings.currencySymbol);
    setBoot(b);
  }, []);

  useEffect(() => {
    refreshBoot()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshBoot]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("lang", l);
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en-US";
    setLangState(l);
    api.saveSettings({ language: l }).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-US";
  }, [lang]);

  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = toastSeq++;
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2600);
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);

  const value = useMemo(
    () => ({ boot, loading, lang, t, setLang, refreshBoot, toast }),
    [boot, loading, lang, t, setLang, refreshBoot, toast]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((tt) => (
          <div
            key={tt.id}
            className={`anim-pop pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-pop ${
              tt.kind === "ok" ? "bg-emerald-600" : "bg-rose-600"
            }`}
          >
            {tt.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp() {
  return useContext(Ctx);
}
