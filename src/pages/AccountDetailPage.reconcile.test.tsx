// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  reconcile: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    accountRegister: vi.fn().mockResolvedValue({
      account: { name: "现金钱包", type: "cash", balance: 12345 },
      transactions: [
        {
          id: "tx-1",
          accountId: "acc-1",
          date: "2026-08-01",
          payeeName: "未清一笔",
          isStart: false,
          transferAccountId: null,
          otherAccountName: null,
          otherAccountType: null,
          categoryId: null,
          categoryName: null,
          memo: "",
          amount: -1000,
          cleared: 0,
          reconciled: 0,
        },
      ],
    }),
    reconcile: (...args: unknown[]) => h.reconcile(...args),
    updateAccount: vi.fn().mockResolvedValue({}),
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
          closed: 0,
          starting_balance: 12345,
          starting_balance_date: null,
          sort_order: 0,
          created_at: "",
          balance: 12345,
        },
      ],
      payees: [],
      groups: [],
      currentMonth: "2026-08",
    },
    t: (k: string) => k,
    lang: "zh",
    refreshBoot: vi.fn().mockResolvedValue({}),
    toast: vi.fn(),
  }),
}));

import { AccountDetailPage } from "./AccountDetailPage";

describe("AccountDetailPage 对账弹窗", () => {
  afterEach(cleanup);
  beforeEach(() => {
    h.reconcile.mockReset().mockResolvedValue({ ok: true, adjustment: null });
  });

  it("点击对账按钮打开弹窗，实际余额默认为当前余额", async () => {
    render(<AccountDetailPage id="acc-1" />);
    fireEvent.click(await screen.findByText("account_reconcile"));
    const input = await screen.findByLabelText("rec_statement");
    expect((input as HTMLInputElement).value).toBe("123.45");
  });

  it("修改输入后提交，携带 statementBalance 与默认 markCleared:true", async () => {
    render(<AccountDetailPage id="acc-1" />);
    fireEvent.click(await screen.findByText("account_reconcile"));
    const input = await screen.findByLabelText("rec_statement");
    fireEvent.change(input, { target: { value: "150.00" } });
    fireEvent.click(await screen.findByText("common_confirm"));
    await waitFor(() =>
      expect(h.reconcile).toHaveBeenCalledWith("acc-1", { statementBalance: 15000, markCleared: true })
    );
  });

  it("有未清算交易时可取消勾选，提交携带 markCleared:false", async () => {
    render(<AccountDetailPage id="acc-1" />);
    fireEvent.click(await screen.findByText("account_reconcile"));
    const cb = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(cb.checked).toBe(true); // 默认勾选
    fireEvent.click(cb);
    fireEvent.click(await screen.findByText("common_confirm"));
    await waitFor(() =>
      expect(h.reconcile).toHaveBeenCalledWith("acc-1", { statementBalance: 12345, markCleared: false })
    );
  });
});
