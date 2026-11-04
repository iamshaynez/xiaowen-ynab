// @vitest-environment jsdom
// 退款流入抬高分类当月可用后的资金移出路径：
// 1) 检查器提供「移回待分配」快捷按钮（负数分配）；
// 2) 自定义金额输入允许负数；
// 3) 移动资金弹窗支持 Ready to Assign 作为目标。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  const budgetData = (month: string) => ({
    month,
    months: ["2026-02"],
    maxMonth: "2026-04",
    readyToAssign: 700000,
    incomeThisMonth: 800000,
    assignedTotal: 50000,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    groups: [
      {
        id: "g1",
        name: "大额购物",
        virtual: false,
        isIncome: false,
        categories: [
          {
            // 退款场景：10 月花完 13000，11 月全额退款流入，已分配 0、可用 13000。
            // 相邻月份给非零已分配，让当月成为行内唯一的 “–” 占位单元格。
            id: "cat-motor",
            name: "摩托车购置",
            assigned: month === "2026-02" ? 0 : 50000,
            activity: month === "2026-02" ? 1300000 : 0,
            available: month === "2026-02" ? 1300000 : 50000,
            goal: null,
            need: null,
            lastAssigned: 1300000,
            avgSpend: 0,
          },
          {
            // 常规场景：可用低于已分配，不应出现移出按钮
            id: "cat-food",
            name: "餐饮外出",
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
  const assign = vi.fn().mockImplementation(async () => budgetData("2026-02"));
  const moveMoney = vi.fn().mockImplementation(async () => budgetData("2026-02"));
  return { budgetData, boot, assign, moveMoney };
});

vi.mock("../api", () => ({
  api: new Proxy(
    { budget: (m: string) => Promise.resolve(h.budgetData(m)), assign: h.assign, moveMoney: h.moveMoney },
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

async function openInspector(name: string) {
  render(<BudgetPage />);
  fireEvent.click(await screen.findByText(name));
  await screen.findByRole("dialog");
}

describe("BudgetPage 检查器：移出退款余额", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    h.assign.mockClear();
    h.moveMoney.mockClear();
  });

  it("退款抬高的分类显示「移回待分配」快捷按钮，点击以负数分配调用 API", async () => {
    await openInspector("摩托车购置");
    const btn = screen.getByText("inspector_moveOut");
    fireEvent.click(btn);
    expect(h.assign).toHaveBeenCalledWith("2026-02", "cat-motor", -1300000);
  });

  it("可用不高于已分配的常规分类不显示移出按钮", async () => {
    await openInspector("餐饮外出");
    expect(screen.queryByText("inspector_moveOut")).toBeNull();
  });

  it("自定义金额输入支持负数", async () => {
    await openInspector("摩托车购置");
    const input = screen.getByPlaceholderText("inspector_custom");
    fireEvent.change(input, { target: { value: "-500" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.assign).toHaveBeenCalledWith("2026-02", "cat-motor", -50000);
  });

  it("表格内联编辑支持负数分配", async () => {
    render(<BudgetPage />);
    const name = await screen.findByText("摩托车购置");
    // 已分配为 0 的单元格显示为 – 占位按钮；相邻月份有非零已分配，
    // 所以摩托车行内唯一的 – 按钮就是当前月（2026-02）的单元格
    const row = name.closest('[class*="grid"]') as HTMLElement;
    const placeholder = within(row)
      .getAllByText("–")
      .find((el) => (el as HTMLElement).tagName === "BUTTON") as HTMLElement;
    fireEvent.click(placeholder);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "-300" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.assign).toHaveBeenCalledWith("2026-02", "cat-motor", -30000);
  });

  it("移动资金弹窗支持 Ready to Assign 目标", async () => {
    await openInspector("摩托车购置");
    fireEvent.click(screen.getByText("inspector_moveBtn"));
    // 页面上还有其他 select，把查询范围限定在移动资金弹窗内
    const modal = screen.getByText("move_title").closest("div[class*='anim-pop']") as HTMLElement;
    const selects = within(modal).getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: "cat-motor" } });
    fireEvent.change(selects[1], { target: { value: "rta" } });
    fireEvent.change(within(modal).getByPlaceholderText("0.00"), { target: { value: "100" } });
    fireEvent.click(within(modal).getByText("move_confirm"));
    expect(h.moveMoney).toHaveBeenCalledWith("2026-02", "cat-motor", "rta", 10000);
  });
});
