// 隔离环境：必须在导入 db/engine 之前设置 DATA_DIR
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-engine-test-"));

const { db, uid, createAccount, addMonths, currentMonth } = await import("./db.mjs");
const { computeBudget, listMonths } = await import("./engine.mjs");

const catId = (() => {
  const gid = uid();
  db.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,?)").run(gid, "测试组", 0);
  const cid = uid();
  db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(cid, gid, "测试分类", 0);
  return cid;
})();

function seed({ inflow, catOutflow, uncatOutflow, assigned }) {
  const acc = createAccount({ name: "现金", type: "cash", startingBalance: 0 });
  const ins = db.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,amount,category_id,is_start,created_at) VALUES(?,?,?,?,?,?,0,?)"
  );
  const today = `${currentMonth()}-15`;
  if (inflow) ins.run(uid(), acc, today, "收入", inflow, null, new Date().toISOString());
  if (catOutflow) ins.run(uid(), acc, today, "消费", -catOutflow, catId, new Date().toISOString());
  if (uncatOutflow) ins.run(uid(), acc, today, "神秘扣款", -uncatOutflow, null, new Date().toISOString());
  if (assigned)
    db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(currentMonth(), catId, assigned);
  return acc;
}

describe("computeBudget", () => {
  it("categorized activity does not touch rta: rta = inflow - assigned", () => {
    seed({ inflow: 15000, catOutflow: 4000, uncatOutflow: 0, assigned: 10000 });
    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(15000);
    expect(s.assigned[catId]).toBe(10000);
    expect(s.activity[catId]).toBe(-4000);
    expect(s.available[catId]).toBe(6000);
    expect(s.readyToAssign).toBe(5000);
  });

  it("uncategorized outflow reduces readyToAssign (money left without a job)", () => {
    seed({ inflow: 0, catOutflow: 0, uncatOutflow: 7000, assigned: 0 });
    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    // 基线 RTA=5000（上一用例），本用例只新增一笔 -7000 未分类流出
    expect(s.readyToAssign).toBe(5000 - 7000);
    expect(s.inflow).toBe(15000);
  });
});

describe("listMonths", () => {
  it("builds contiguous months up to the target month", () => {
    const cur = currentMonth();
    const months = listMonths(addMonths(cur, 2));
    expect(months.length).toBeGreaterThanOrEqual(3);
    expect(months.at(-1)).toBe(addMonths(cur, 2));
    for (let i = 1; i < months.length; i++) {
      expect(months[i]).toBe(addMonths(months[i - 1], 1));
    }
  });
});

describe("computeBudget：期初余额", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM assignments").run();
  });

  it("预算内现金账户的期初余额计入 Ready to Assign", () => {
    const acc = createAccount({ name: "储蓄", type: "checking", startingBalance: 50000, startingDate: `${currentMonth()}-01` });
    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(50000);
    expect(s.readyToAssign).toBe(50000);
  });

  it("负债账户的负期初余额作为负流入扣减 Ready to Assign", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -2000, startingDate: `${currentMonth()}-01` });
    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(-2000);
    expect(s.readyToAssign).toBe(-2000);
  });
});

describe("computeBudget：预算内账户与预算外账户之间的转账", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM assignments").run();
  });

  // 插入一笔预算内↔预算外转账的两条腿。
  // budgetAmount 为「预算内账户」这一腿的金额：负数=钱从预算内流出；正数=钱流入预算内。
  function insertBudgetOffBudgetTx(budgetAcc, offBudgetAcc, date, budgetAmount, categoryId = null) {
    const pairId = uid();
    const ins = db.prepare(
      "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,amount,is_start,pair_id,created_at) VALUES(?,?,?,?,?,?,?,0,?,?)"
    );
    ins.run(uid(), budgetAcc, date, "转账", offBudgetAcc, categoryId, budgetAmount, pairId, new Date().toISOString());
    ins.run(uid(), offBudgetAcc, date, "", budgetAcc, null, -budgetAmount, pairId, new Date().toISOString());
  }

  it("预算内账户向预算外账户转账且带分类：记为该分类活动，并因超支扣减 Ready to Assign", () => {
    const checking = createAccount({ name: "储蓄", type: "checking" }); // on_budget=1
    const invest = createAccount({ name: "基金", type: "investment" }); // on_budget=0
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-01`, -300000, catId);

    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.activity[catId]).toBe(-300000);
    expect(s.readyToAssign).toBe(-300000);
  });

  it("预算内账户向预算外账户转账且不带分类：视为未分类流出，扣减 Ready to Assign", () => {
    const checking = createAccount({ name: "储蓄", type: "checking" });
    const invest = createAccount({ name: "基金", type: "investment" });
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-01`, -500000);

    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(0);
    expect(s.readyToAssign).toBe(-500000);
  });

  it("预算外账户向预算内账户转账（回款）：计入 Ready to Assign", () => {
    const checking = createAccount({ name: "储蓄", type: "checking" });
    const invest = createAccount({ name: "基金", type: "investment" });
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-02`, 200000);

    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(200000);
    expect(s.readyToAssign).toBe(200000);
  });

  it("预算内账户之间互转：预算中立，不影响 Ready to Assign", () => {
    const a = createAccount({ name: "A", type: "checking" });
    const b = createAccount({ name: "B", type: "checking" });
    insertBudgetOffBudgetTx(a, b, `${currentMonth()}-03`, -100000);

    const { byMonth } = computeBudget(currentMonth());
    const s = byMonth.get(currentMonth());
    expect(s.inflow).toBe(0);
    expect(s.readyToAssign).toBe(0);
  });
});
