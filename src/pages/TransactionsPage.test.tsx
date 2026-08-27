// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  transactions: vi.fn(),
  setTxCategory: vi.fn(),
  bulkSetCategory: vi.fn(),
  bulkDeleteTx: vi.fn(),
  deleteTx: vi.fn(),
  setTxStatus: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    transactions: h.transactions,
    setTxCategory: h.setTxCategory,
    bulkSetCategory: h.bulkSetCategory,
    bulkDeleteTx: h.bulkDeleteTx,
    deleteTx: h.deleteTx,
    setTxStatus: h.setTxStatus,
  },
}));

vi.mock("../store", async () => {
  const { makeT } = await import("../i18n");
  return {
    useApp: () => ({
      boot: {
        accounts: [
          { id: "acc-1", name: "现金", type: "cash", on_budget: 1, closed: 0 },
          { id: "acc-2", name: "储蓄卡", type: "checking", on_budget: 1, closed: 0 },
        ],
        payees: [],
        groups: [
          {
            id: "g1",
            name: "日常",
            categories: [
              { id: "cat-food", group_id: "g1", name: "餐饮" },
              { id: "cat-traffic", group_id: "g1", name: "交通" },
            ],
          },
        ],
      },
      t: makeT("zh"),
      lang: "zh",
      refreshBoot: h.refreshBoot,
      toast: h.toast,
    }),
  };
});

import { TransactionsPage } from "./TransactionsPage";
import type { Tx } from "../types";

function tx(partial: Partial<Tx>): Tx {
  return {
    id: "tx-x",
    accountId: "acc-1",
    date: "2026-08-01",
    payeeName: "咖啡店",
    isStart: false,
    transferAccountId: null,
    otherAccountName: null,
    otherAccountType: null,
    categoryId: null,
    categoryName: null,
    memo: null,
    amount: -1800,
    cleared: 0,
    reconciled: 0,
    account_name: "现金",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.transactions.mockResolvedValue({
    total: 2,
    transactions: [
      tx({ id: "tx-b", date: "2026-08-20", payeeName: "书店" }),
      tx({ id: "tx-a", date: "2026-08-01", payeeName: "咖啡店", categoryId: "cat-food", categoryName: "餐饮" }),
    ],
  });
  h.refreshBoot.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("TransactionsPage", () => {
  it("按时间倒序渲染交易并显示总数", async () => {
    render(<TransactionsPage />);
    const rows = await screen.findAllByText(/书店|咖啡店/);
    expect(rows[0].textContent).toContain("书店"); // 新的在前
    expect(screen.getByText("共 2 笔")).toBeTruthy();
    expect(h.transactions).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it("输入搜索后防抖请求 search 参数", async () => {
    render(<TransactionsPage />);
    await screen.findByText("共 2 笔");
    fireEvent.change(screen.getByPlaceholderText("搜索收款方、备注、分类…"), { target: { value: "牛奶" } });
    expect(h.transactions).toHaveBeenCalledTimes(1); // 防抖期间不立即请求
    await waitFor(
      () => expect(h.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: "牛奶", limit: 200 })),
      { timeout: 1500 }
    );
  });

  it("勾选只看未分类时携带 uncategorized 参数", async () => {
    render(<TransactionsPage />);
    const btn = await screen.findByRole("button", { name: "只看未分类" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(h.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ uncategorized: true }))
    );
  });

  it("行内下拉直接改分类", async () => {
    h.setTxCategory.mockResolvedValue({ ok: true });
    render(<TransactionsPage />);
    await screen.findByText("共 2 笔");
    // 找行内的分类下拉（包含分类选项的 combobox），而非账户筛选下拉
    const rowSelect = (await screen.findAllByRole("combobox")).find((el) =>
      Array.from((el as HTMLSelectElement).options).some((o) => o.value === "cat-food")
    )!;
    fireEvent.change(rowSelect, { target: { value: "cat-traffic" } });
    await waitFor(() => expect(h.setTxCategory).toHaveBeenCalledWith("tx-b", "cat-traffic"));
  });

  it("勾选多笔后批量设置分类", async () => {
    h.bulkSetCategory.mockResolvedValue({ ok: true, changed: 2 });
    render(<TransactionsPage />);
    const checkboxes = await screen.findAllByRole("checkbox");
    // 第一个是表头全选，跳过；勾选两行
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    expect(screen.getByText("已选 2 笔")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /清除分类/ }));
    await waitFor(() => expect(h.bulkSetCategory).toHaveBeenCalledWith(["tx-b", "tx-a"], null));
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
  });

  it("勾选多笔后确认即批量删除", async () => {
    h.bulkDeleteTx.mockResolvedValue({ ok: true, changed: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TransactionsPage />);
    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByRole("button", { name: /批量删除/ }));
    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith("确定删除选中的 2 笔交易吗？转账会连同对侧记录一起删除。")
    );
    expect(h.bulkDeleteTx).toHaveBeenCalledWith(["tx-b", "tx-a"]);
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    // 删除后清空选择
    await waitFor(() => expect(screen.queryByText("已选 2 笔")).toBeNull());
    confirmSpy.mockRestore();
  });

  it("批量删除在确认框取消时不调用接口", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TransactionsPage />);
    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /批量删除/ }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(h.bulkDeleteTx).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("total 大于已加载数量时显示加载更多并追加数据", async () => {
    h.transactions.mockResolvedValueOnce({ total: 3, transactions: [tx({ id: "tx-b" }), tx({ id: "tx-a" })] }).mockResolvedValueOnce({
      total: 3,
      transactions: [tx({ id: "tx-c", date: "2026-07-01", payeeName: "地铁" })],
    });
    render(<TransactionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    await screen.findByText("地铁");
    expect(h.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }));
  });

  it("删除交易前需要确认", async () => {
    h.deleteTx.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TransactionsPage />);
    // 悬停操作按钮依赖 CSS opacity，但 DOM 始终存在
    const delButtons = await screen.findAllByTitle("删除");
    fireEvent.click(delButtons[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(h.deleteTx).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
