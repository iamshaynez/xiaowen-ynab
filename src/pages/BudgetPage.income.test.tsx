// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  const budgetData = (month: string) => ({
    month,
    months: ["2026-02"],
    maxMonth: "2026-04",
    readyToAssign: 800000,
    incomeThisMonth: 800000,
    assignedTotal: 50000,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    groups: [
      {
        id: "g1",
        name: "日常开销",
        virtual: false,
        isIncome: false,
        categories: [
          {
            id: "cat-1",
            name: "食品杂货",
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
      {
        id: "g-income",
        name: "收入",
        virtual: false,
        isIncome: true,
        categories: [
          {
            id: "cat-salary",
            name: "工资薪酬",
            isIncome: true,
            assigned: 0,
            activity: 800000,
            available: 0,
            goal: null,
            need: null,
            lastAssigned: 0,
            avgSpend: 0,
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

describe("BudgetPage 收入分区", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
  });

  it("渲染支出区与收入区两个分区标签，且支出在收入之前", async () => {
    render(<BudgetPage />);
    const expenseLabel = await screen.findByText("budget_expenseSection");
    const incomeLabel = screen.getByText("budget_incomeSection");
    expect(expenseLabel.compareDocumentPosition(incomeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("收入分组排在支出分组之后", async () => {
    render(<BudgetPage />);
    const expenseGroup = await screen.findByText("日常开销");
    const incomeGroup = screen.getByText("收入");
    expect(expenseGroup.compareDocumentPosition(incomeGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("收入分类行只展示活动金额：没有可点击的分配按钮，分配与可用列显示占位符", async () => {
    render(<BudgetPage />);
    const salaryCell = await screen.findByText("工资薪酬");
    const row = salaryCell.parentElement!;
    // 行内没有任何按钮（支出行的分配格是可点击按钮）
    expect(within(row).queryByRole("button")).toBeNull();
    // 活动金额正常渲染（800000 分 = ¥8,000.00）
    expect(row.textContent).toContain("8,000.00");
    // 对照：支出行存在分配按钮
    const expenseRow = screen.getByText("食品杂货").parentElement!;
    expect(within(expenseRow).queryAllByRole("button").length).toBeGreaterThan(0);
  });

  it("点击收入分类打开的检查面板不显示快速分配与目标编辑", async () => {
    render(<BudgetPage />);
    fireEvent.click(await screen.findByText("工资薪酬"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("工资薪酬");
    expect(within(dialog).queryByText("inspector_quickAssign")).toBeNull();
    expect(within(dialog).queryByText("inspector_available")).toBeNull();
    // 但仍展示本月活动
    expect(within(dialog).getByText("inspector_activity")).toBeTruthy();
  });
});
