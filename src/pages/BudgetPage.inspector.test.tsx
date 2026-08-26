// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const budgetData = (month: string) => ({
    month,
    months: ["2026-02"],
    maxMonth: "2026-04",
    readyToAssign: 10000,
    incomeThisMonth: 800000,
    assignedTotal: 50000,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    groups: [
      {
        id: "g1",
        name: "Everyday",
        virtual: false,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            assigned: 50000,
            activity: -20000,
            available: 30000,
            goal: null,
            need: null,
            lastAssigned: 40000,
            avgSpend: 25000,
          },
        ],
      },
    ],
  });
  const boot = {
    settings: { currencySymbol: "¥", language: "zh", aiBaseUrl: "", aiModel: "", aiKey: "" },
    accounts: [
      {
        id: "acc-1",
        name: "现金钱包",
        type: "cash",
        on_budget: 1,
        closed: 0,
        starting_balance: 10000,
        starting_balance_date: null,
        sort_order: 0,
        created_at: "",
        balance: 10000,
      },
    ],
    payees: [],
    groups: [],
    currentMonth: "2026-02",
  };
  return { budgetData, boot };
});

vi.mock("../api", () => ({
  api: new Proxy(
    { budget: (m: string) => Promise.resolve(h.budgetData(m)) },
    {
      get: (target, prop) =>
        prop in target ? target[prop as keyof typeof target] : vi.fn().mockResolvedValue({}),
    }
  ),
}));

vi.mock("../store", () => {
  const t = (k: string) => k;
  const toast = vi.fn();
  const setLang = vi.fn();
  const refreshBoot = vi.fn().mockResolvedValue({});
  const useApp = () => ({
    boot: h.boot,
    loading: false,
    lang: "zh" as const,
    t,
    toast,
    setLang,
    refreshBoot,
  });
  return { useApp };
});

import { BudgetPage } from "./BudgetPage";

async function openInspector() {
  render(<BudgetPage />);
  fireEvent.click(await screen.findByText("Groceries"));
}

describe("BudgetPage Inspector responsive layout", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens the inspector as a slide-over drawer with a backdrop when a category is selected", async () => {
    await openInspector();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Groceries");
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("inset-y-0");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("z-40");
    expect(dialog.className).toContain("max-w-[85vw]");
    const backdrop = document.querySelector('div[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
  });

  it("keeps the inline sidebar layout on very wide screens via breakpoint overrides", async () => {
    await openInspector();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("min-[1680px]:static");
    expect(dialog.className).toContain("min-[1680px]:max-w-none");
    const backdrop = document.querySelector('div[aria-hidden="true"]');
    expect(backdrop?.className).toContain("min-[1680px]:hidden");
  });

  it("closes the drawer when the backdrop is clicked", async () => {
    await openInspector();
    await screen.findByRole("dialog");
    fireEvent.click(document.querySelector('div[aria-hidden="true"]')!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the drawer when Escape is pressed", async () => {
    await openInspector();
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
