import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./store";
import { Sidebar } from "./components/Sidebar";
import { BudgetPage } from "./pages/BudgetPage";
import { AccountsPage } from "./pages/AccountsPage";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
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
  const { loading } = useApp();

  let page;
  const detail = route.match(/^#\/accounts\/([\w-]+)$/);
  if (detail) page = <AccountDetailPage id={detail[1]} />;
  else if (route.startsWith("#/accounts")) page = <AccountsPage />;
  else if (route.startsWith("#/reports")) page = <ReportsPage />;
  else page = <BudgetPage />;

  return (
    <div className="flex h-full">
      <Sidebar route={route} />
      <main className="ml-60 h-full min-w-0 flex-1 overflow-y-auto">{loading ? <Spinner /> : page}</main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
