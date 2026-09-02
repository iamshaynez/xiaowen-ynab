// 隔离环境：必须在导入 engine 之前设置 DATA_DIR
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-engine-report-transfer-test-"));

const { db, uid, createAccount, currentMonth } = await import("./db.mjs");
const { reportsOverview } = await import("./engine.mjs");

// fixtures：预算内账户、预算外账户、另一个预算内账户、支出/收入分类
const checking = createAccount({ name: "储蓄", type: "checking" }); // on_budget=1
const invest = createAccount({ name: "基金", type: "investment" }); // on_budget=0
const checkingB = createAccount({ name: "工资卡", type: "checking" }); // on_budget=1

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "储蓄目标", 0);
const budgetCat = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(budgetCat, spendGid, "投资理财");

const incomeGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,1)").run(incomeGid, "收入", -1);
const salaryCat = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(salaryCat, incomeGid, "工资薪酬");

// 插入一笔预算内↔预算外转账的两条腿。
// budgetAmount 为「预算内账户」这一腿的金额：负数=钱从预算内流出；正数=钱流入预算内。
// 预算外账户那一腿金额恒为相反数、无分类。
function insertBudgetOffBudgetTx(budgetAcc, offBudgetAcc, date, budgetAmount, categoryId = null, payee = "加仓定投") {
  const pairId = uid();
  const ins = db.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,0,?,?)"
  );
  ins.run(uid(), budgetAcc, date, payee, offBudgetAcc, categoryId, "", budgetAmount, pairId, new Date().toISOString());
  ins.run(uid(), offBudgetAcc, date, "", budgetAcc, null, "", -budgetAmount, pairId, new Date().toISOString());
}

// 预算内账户之间互转的两条腿（均无分类）
function insertBudgetToBudgetTx(fromAcc, toAcc, date, amount) {
  const pairId = uid();
  const ins = db.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at) VALUES(?,?,?,?,?,NULL,'',?,1,0,0,?,?)"
  );
  ins.run(uid(), fromAcc, date, "互转", toAcc, amount, pairId, new Date().toISOString());
  ins.run(uid(), toAcc, date, "", fromAcc, -amount, pairId, new Date().toISOString());
}

describe("reportsOverview：预算内账户与预算外账户之间的转账", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM transactions").run();
  });

  it("预算内→预算外带分类转出：计入当月支出与分类占比，不计入收入", () => {
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-01`, -300000, budgetCat);
    const rep = reportsOverview(3);
    const month = currentMonth();
    expect(rep.income.find((x) => x.month === month).value).toBe(0);
    expect(rep.expense.find((x) => x.month === month).value).toBe(300000);
    const bd = rep.breakdown.find((x) => x.name === "投资理财");
    expect(bd?.value).toBe(300000);
  });

  it("预算内→预算外无分类转出：计入支出，绝不误报成收入", () => {
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-02`, -500000, null);
    const rep = reportsOverview(3);
    const month = currentMonth();
    expect(rep.income.find((x) => x.month === month).value).toBe(0);
    expect(rep.expense.find((x) => x.month === month).value).toBe(500000);
  });

  it("预算外→预算内回款：计入当月收入，不计入支出", () => {
    insertBudgetOffBudgetTx(checking, invest, `${currentMonth()}-03`, 200000);
    const rep = reportsOverview(3);
    const month = currentMonth();
    expect(rep.income.find((x) => x.month === month).value).toBe(200000);
    expect(rep.expense.find((x) => x.month === month).value).toBe(0);
  });

  it("预算内账户之间互转：预算中立，不影响收入/支出/分类占比", () => {
    insertBudgetToBudgetTx(checking, checkingB, `${currentMonth()}-04`, -100000);
    const rep = reportsOverview(3);
    const month = currentMonth();
    expect(rep.income.find((x) => x.month === month).value).toBe(0);
    expect(rep.expense.find((x) => x.month === month).value).toBe(0);
    expect(rep.breakdown.length).toBe(0);
  });
});
