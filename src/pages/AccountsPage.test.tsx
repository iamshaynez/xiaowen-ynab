// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createAccount: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    createAccount: (...a: unknown[]) => h.createAccount(...a),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: { settings: { currencySymbol: "¥" }, accounts: [] },
    lang: "zh",
    t: (k: string) =>
      (({ account_tagOnBudget: "预算内", account_tagOffBudget: "预算外" } as Record<string, string>)[k] ?? k),
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { AccountsPage } from "./AccountsPage";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.refreshBoot.mockResolvedValue({});
  h.createAccount.mockResolvedValue({ id: "a1" });
});

afterEach(cleanup);

describe("AccountsPage 新建账户弹窗", () => {
  it("类型下拉的每个选项都标注预算内/预算外", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    const select = (await screen.findByLabelText("account_type")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "支票账户 · 预算内",
      "储蓄账户 · 预算内",
      "现金 · 预算内",
      "信用卡 · 预算内",
      "信用额度 · 预算外",
      "投资账户 · 预算外",
      "房产 · 预算外",
      "车辆 · 预算外",
      "其他资产 · 预算外",
      "助学贷款 · 预算外",
      "个人贷款 · 预算外",
      "其他负债 · 预算外",
    ]);
  });

  it("选择带标注的类型后提交，仍发送对应的类型值", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    const nameInput = await screen.findByLabelText("account_name");
    fireEvent.change(nameInput, { target: { value: "工资卡" } });
    fireEvent.change(screen.getByLabelText("account_type"), { target: { value: "savings" } });
    fireEvent.click(screen.getByRole("button", { name: "account_create" }));
    await waitFor(() =>
      expect(h.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ name: "工资卡", type: "savings" })
      )
    );
  });
});
