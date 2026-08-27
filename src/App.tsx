import { useEffect, useState } from "react";
import { Menu, Wallet } from "lucide-react";
import { AppProvider, useApp } from "./store";
import { Sidebar } from "./components/Sidebar";
import { BudgetPage } from "./pages/BudgetPage";
import { AccountsPage } from "./pages/AccountsPage";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { Spinner } from "./components/ui";

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash || "#/budget");
  useEffect(() => {
    const h = () => setRoute(window.location.hash || "#/budget");
    window.addEventListener("hashchange", h);
    if (!window.location.hash) window.location.hash = "#/budget";
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}

function Shell() {
  const route = useHashRoute();
  const { loading, authEnabled, authenticated } = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 移动端点击任意导航后自动收起抽屉
  useEffect(() => setMobileNavOpen(false), [route]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  let page;
  const detail = route.match(/^#\/accounts\/([\w-]+)$/);
  if (detail) page = <AccountDetailPage id={detail[1]} />;
  else if (route.startsWith("#/accounts")) page = <AccountsPage />;
  else if (route.startsWith("#/transactions")) page = <TransactionsPage />;
  else if (route.startsWith("#/reports")) page = <ReportsPage />;
  else if (route.startsWith("#/chat")) page = <ChatPage />;
  else if (route.startsWith("#/settings")) page = <SettingsPage />;
  else page = <BudgetPage />;

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar onMenu={() => setMobileNavOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} open={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
        <main className="min-w-0 flex-1 overflow-auto md:ml-60">{page}</main>
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-navy-950/45 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
    </div>
  );
}

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { t } = useApp();
  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-3 py-2.5 shadow-sm md:hidden">
      <button
        onClick={onMenu}
        aria-label="menu"
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-800"
      >
        <Menu size={19} />
      </button>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600">
        <Wallet size={14} className="text-white" />
      </span>
      <span className="text-sm font-bold text-slate-800">{t("appName")}</span>
    </header>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
