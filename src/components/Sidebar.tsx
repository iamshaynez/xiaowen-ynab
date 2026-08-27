import {
  Banknote,
  Car,
  CreditCard,
  Home,
  Landmark,
  ListChecks,
  Package,
  PiggyBank,
  Scale,
  Settings,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { useApp } from "../store";
import { fmtMoney } from "../format";
import type { Account } from "../types";
import type { Lang } from "../i18n";

export function accountIcon(type: string): ComponentType<{ size?: number | string; className?: string }> {
  switch (type) {
    case "checking":
      return Landmark;
    case "savings":
      return PiggyBank;
    case "cash":
      return Banknote;
    case "creditCard":
    case "lineOfCredit":
      return CreditCard;
    case "investment":
      return TrendingUp;
    case "property":
      return Home;
    case "vehicle":
      return Car;
    default:
      return type.includes("Liability") || type.includes("Loan") ? Scale : Package;
  }
}

function AccountRow({ acc }: { acc: Account }) {
  return (
    <a
      href={`#/accounts/${acc.id}`}
      className="group flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/10 text-slate-300 group-hover:text-white">
        {(() => {
          const Icon = accountIcon(acc.type);
          return <Icon size={12} />;
        })()}
      </span>
      <span className="min-w-0 flex-1 truncate">{acc.name}</span>
      <span className={`num text-xs ${acc.balance < 0 ? "text-rose-300" : "text-slate-400"} group-hover:text-slate-200`}>
        {fmtMoney(acc.balance)}
      </span>
    </a>
  );
}

function Section({
  label,
  accounts,
  navigateTo,
  defaultOpen = true,
}: {
  label: string;
  accounts: Account[];
  navigateTo?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!accounts.length) return null;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-2.5">
        {navigateTo ? (
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
          >
            <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
            {label}
          </button>
        ) : (
          <button onClick={() => setOpen(!open)} className="flex items-center gap-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
            <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
            {label}
          </button>
        )}
        {navigateTo && (
          <a href={navigateTo} className="text-[11px] text-slate-500 hover:text-slate-300">
            +
          </a>
        )}
      </div>
      {open && (
        <>
          <div className="mt-1 space-y-px">
            {accounts.map((a) => (
              <AccountRow key={a.id} acc={a} />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] px-2.5 pt-1.5 text-[11px]">
            <span className="text-slate-500">{label.includes("关闭") ? "" : "Total"}</span>
            <span className="num font-medium text-slate-400">{fmtMoney(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar({ route }: { route: string }) {
  const { boot, t, lang, setLang } = useApp();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [symbol, setSymbol] = useState(boot?.settings.currencySymbol ?? "¥");

  const accs = boot?.accounts ?? [];
  const onBudget = accs.filter((a) => !a.closed && a.on_budget);
  const tracking = accs.filter((a) => !a.closed && !a.on_budget);
  const closed = accs.filter((a) => a.closed);

  return (
    <aside className="sidebar-scroll fixed inset-y-0 left-0 z-30 flex w-60 flex-col overflow-y-auto bg-navy-900 pb-4 pt-5 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mb-6 flex items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-600/30">
          <Wallet size={18} className="text-white" />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight text-white">{t("appName")}</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Budget · 记账</div>
        </div>
      </div>

      <nav className="mb-6 space-y-1 px-3">
        {[
          { href: "#/budget", icon: Wallet, label: t("nav_budget"), active: route.startsWith("#/budget") },
          { href: "#/accounts", icon: Landmark, label: t("nav_accounts"), active: route.startsWith("#/accounts") },
          { href: "#/transactions", icon: ListChecks, label: t("nav_transactions"), active: route.startsWith("#/transactions") },
          { href: "#/reports", icon: TrendingUp, label: t("nav_reports"), active: route.startsWith("#/reports") },
          { href: "#/chat", icon: Sparkles, label: t("nav_chat"), active: route.startsWith("#/chat") },
          { href: "#/settings", icon: Settings, label: t("nav_settings"), active: route.startsWith("#/settings") },
        ].map(({ href, icon: Icon, label, active }) => (
          <a
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all ${
              active
                ? "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md shadow-brand-600/25"
                : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            <Icon size={15} />
            {label}
          </a>
        ))}
      </nav>

      <div className="flex-1 px-3">
        <Section label={t("sidebar_onBudget")} accounts={onBudget} navigateTo="#/accounts" />
        <Section label={t("sidebar_tracking")} accounts={tracking} navigateTo="#/accounts" />
        <Section label={t("sidebar_closed")} accounts={closed} defaultOpen={false} />
      </div>

      <div className="mt-auto space-y-3 px-4 pt-4">
        {currencyOpen && (
          <div className="anim-pop flex items-center gap-2 rounded-lg bg-navy-750 p-2">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.slice(0, 3))}
              className="w-14 rounded-md border border-white/10 bg-navy-900 px-2 py-1 text-center text-sm text-white outline-none focus:border-brand-400"
            />
            <button
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500"
              onClick={async () => {
                const { api } = await import("../api");
                await api.saveSettings({ currencySymbol: symbol });
                location.reload();
              }}
            >
              OK
            </button>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
          <div className="flex overflow-hidden rounded-full border border-white/10 p-0.5">
            {(["zh", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  lang === l ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {l === "zh" ? "中文" : "EN"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCurrencyOpen(!currencyOpen)}
            title={t("settings_currency")}
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
          >
            {(boot?.settings.currencySymbol ?? "¥")}
          </button>
        </div>
      </div>
    </aside>
  );
}
