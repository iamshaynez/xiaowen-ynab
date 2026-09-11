// 隔离环境：必须在导入 db/engine 之前设置 DATA_DIR
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-engine-cc-balance-test-"));

const { db, uid, createAccount, currentMonth, addMonths } = await import("./db.mjs");
const { computeBudget } = await import("./engine.mjs");

// 支出组 + 分类
const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 0);
const spendCid = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(spendCid, spendGid, "食品杂货", 0);
// 收入组 + 分类
const incomeGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,1)").run(incomeGid, "收入", -1);
const salaryCid = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(salaryCid, incomeGid, "工资薪酬", 0);

beforeEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM assignments").run();
  db.prepare("DELETE FROM accounts").run();
});

const m = () => currentMonth();

function tx(acc, amount, { categoryId = null, day = 10, transferTo = null, pairId = null } = {}) {
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,is_start,pair_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,0,?,?)`
  ).run(uid(), acc, `${m()}-${String(day).padStart(2, "0")}`, "x", transferTo, categoryId, "", amount, pairId, new Date().toISOString());
}

function payCard(ck, cc, amount, day = 20) {
  const pair = uid();
  tx(ck, -amount, { transferTo: cc, pairId: pair, day });
  tx(cc, amount, { transferTo: ck, pairId: pair, day });
}

function state(monthsAhead = 1) {
  return computeBudget(addMonths(m(), monthsAhead)).byMonth.get(m());
}

// 预算侧有效合计：RTA + 全部分类 available（负 available 已在上月 RTA 中扣过，按 0 计）
function budgetEffectiveTotal(s) {
  return s.readyToAssign + Object.values(s.available).reduce((a, b) => a + Math.max(b, 0), 0);
}

// 账户侧期望合计：现金账户计全额余额；信用卡只计正余额（溢缴），欠款由储备信封背书
function expectedTotal() {
  return db
    .prepare(
      `SELECT a.type, a.starting_balance + COALESCE(SUM(CASE WHEN t.is_start=0 THEN t.amount ELSE 0 END),0) AS b
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.on_budget=1 GROUP BY a.id`
    )
    .all()
    .reduce((s, r) => s + (["creditCard", "lineOfCredit"].includes(r.type) ? Math.max(r.b, 0) : r.b), 0);
}

describe("computeBudget：信用卡余额驱动语义", () => {
  it("守恒基线：刷卡-还卡闭环，预算合计恒等于账户合计", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(m(), spendCid, 100000);
    tx(cc, -100000, { categoryId: spendCid, day: 5 });
    payCard(ck, cc, 100000);
    const s = state();
    expect(s.readyToAssign).toBe(0);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
    const s2 = computeBudget(addMonths(m(), 2)).byMonth.get(addMonths(m(), 1));
    expect(budgetEffectiveTotal(s2)).toBe(expectedTotal());
  });

  it("无欠款时还款视为溢缴（预算内现金），RTA 不消耗", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    payCard(ck, cc, 100000);
    const s = state();
    expect(s.readyToAssign).toBe(100000);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("期初欠款在还款时才单次扣减 RTA，不发生双重计费", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -100000 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    payCard(ck, cc, 100000);
    const s = state();
    expect(s.readyToAssign).toBe(0);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
    const next = computeBudget(addMonths(m(), 2)).byMonth.get(addMonths(m(), 1));
    expect(next.readyToAssign).toBe(0);
    expect(budgetEffectiveTotal(next)).toBe(expectedTotal());
  });

  it("信用卡期初欠款扣减 Ready to Assign，并注入等额还款储备备偿", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -2000, startingDate: `${m()}-01` });
    const s = state();
    expect(s.inflow).toBe(-2000);
    expect(s.readyToAssign).toBe(-2000);
    expect(s.available[`cc:${cc}`]).toBe(2000);
  });

  it("无消费基础上的退款记回支出分类：储备不为负，RTA 不被额外扣减", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(m(), spendCid, 100000);
    tx(cc, 100000, { categoryId: spendCid, day: 5 });
    const s = state();
    expect(s.readyToAssign).toBe(0);
    expect(s.available[spendCid]).toBe(200000);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("收入分类流入有欠款的信用卡：收入先用于抵债，RTA 不虚增", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -100000 });
    tx(cc, 100000, { categoryId: salaryCid, day: 5 });
    const s = state();
    // 期初 -100000 与卡上收入 +100000 相抵：钱直接用于抵债，RTA 不虚增
    expect(s.inflow).toBe(0);
    expect(s.readyToAssign).toBe(0);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("无分类刷卡支出按未分类流出扣减 RTA，并等额攒储备", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(cc, -100000, { day: 5 });
    const s = state();
    expect(s.readyToAssign).toBe(-100000);
    expect(s.available[`cc:${cc}`]).toBe(100000);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("溢缴后再刷卡消耗溢缴，不重复扣 RTA", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    payCard(ck, cc, 100000, 5);
    tx(cc, -100000, { categoryId: spendCid, day: 8 });
    const s = state();
    expect(s.readyToAssign).toBe(0);
    expect(s.available[spendCid]).toBe(-100000);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
    const next = computeBudget(addMonths(m(), 2)).byMonth.get(addMonths(m(), 1));
    expect(budgetEffectiveTotal(next)).toBe(expectedTotal());
  });

  it("还款同时覆盖旧债与溢缴：只有旧债部分扣减 RTA", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -50000 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    payCard(ck, cc, 100000);
    const s = state();
    expect(s.readyToAssign).toBe(50000);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("期初欠款已自动占用等额储备：额外拨给 cc: 的拨款不会被偿债误消耗", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -100000 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(m(), `cc:${cc}`, 100000);
    payCard(ck, cc, 100000);
    const s = state();
    // 偿债消耗的是期初库存；额外拨款原样留在还款科目，可挪回 RTA
    expect(s.readyToAssign).toBe(-100000);
    expect(s.available[`cc:${cc}`]).toBe(100000);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("退款不超过既有债务：从储备释放，不触碰 RTA", () => {
    const ck = createAccount({ name: "储蓄卡", type: "checking", startingBalance: 0 });
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    tx(ck, 100000, { categoryId: salaryCid, day: 1 });
    db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(m(), spendCid, 100000);
    tx(cc, -100000, { categoryId: spendCid, day: 5 });
    tx(cc, 30000, { categoryId: spendCid, day: 8 });
    const s = state();
    expect(s.readyToAssign).toBe(0);
    expect(s.available[spendCid]).toBe(30000);
    expect(s.available[`cc:${cc}`]).toBe(70000);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("信用卡取现到预算外账户：按流出扣减 RTA，储备与新增债务对等", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: 0 });
    const inv = createAccount({ name: "基金", type: "investment", startingBalance: 0 });
    const p = uid();
    tx(cc, -100000, { transferTo: inv, pairId: p });
    tx(inv, 100000, { transferTo: cc, pairId: p });
    const s = state();
    expect(s.readyToAssign).toBe(-100000);
    expect(s.available[`cc:${cc}`]).toBe(100000);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });

  it("预算外账户资金还信用卡：预算侧按流入回收储备，不虚耗", () => {
    const cc = createAccount({ name: "信用卡", type: "creditCard", startingBalance: -100000 });
    const inv = createAccount({ name: "基金", type: "investment", startingBalance: 100000 });
    const p = uid();
    tx(inv, -100000, { transferTo: cc, pairId: p });
    tx(cc, 100000, { transferTo: inv, pairId: p });
    const s = state();
    // 期初欠款已在开户时扣 RTA；预算外资金代为偿债，储备释放回到 RTA
    expect(s.readyToAssign).toBe(0);
    expect(s.available[`cc:${cc}`]).toBe(0);
    expect(budgetEffectiveTotal(s)).toBe(expectedTotal());
  });
});
