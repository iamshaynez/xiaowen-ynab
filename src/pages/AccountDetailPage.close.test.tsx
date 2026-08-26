// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  refreshBoot: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    accountRegister: vi.fn().mockResolvedValue({
      account: { name: "现金钱包", type: "cash", balance: 10000 },
      transactions: [],
    }),
    updateAccount: (...args: unknown[]) => h.updateAccount(...args),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: { currencySymbol: "¥", language: "zh", aiBaseUrl: "", aiModel: "", aiKey: "" },
      accounts: [
        {
          id: "acc-1",
          name: "现金钱包",
          type: "cash",
          on_budget: 1,
          closed: closedFlag,
          starting_balance: 10000,
          starting_balance_date: null,
          sort_order: 0,
          created_at: "",
          balance: 10000,
        },
      ],
      payees: [],
      groups: [],
      currentMonth: "2026-08",
    },
    t: (k: string) => k,
    lang: "zh",
    refreshBoot: h.refreshBoot,
    toast: vi.fn(),
  }),
}));

import { AccountDetailPage } from "./AccountDetailPage";

let closedFlag: 0 | 1 = 0;

describe("AccountDetailPage close/reopen button", () => {
  afterEach(cleanup);
  beforeEach(() => {
    h.updateAccount.mockReset().mockResolvedValue({});
    h.refreshBoot.mockReset().mockResolvedValue({});
    vi.stubGlobal("confirm", () => true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends closed=true when closing an open account", async () => {
    closedFlag = 0;
    render(<AccountDetailPage id="acc-1" />);
    const btn = await screen.findByText("account_close");
    fireEvent.click(btn);
    await waitFor(() => expect(h.updateAccount).toHaveBeenCalled());
    expect(h.updateAccount).toHaveBeenCalledWith("acc-1", { closed: true });
  });

  it("sends closed=false when reopening a closed account", async () => {
    closedFlag = 1;
    render(<AccountDetailPage id="acc-1" />);
    const btn = await screen.findByText("account_reopen");
    fireEvent.click(btn);
    await waitFor(() => expect(h.updateAccount).toHaveBeenCalled());
    expect(h.updateAccount).toHaveBeenCalledWith("acc-1", { closed: false });
  });
});
