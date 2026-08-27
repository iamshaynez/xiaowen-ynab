// 隔离环境：必须在导入 db/engine 之前设置 DATA_DIR。
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-engine-income-test-"));

const { db, uid, createAccount, currentMonth, addMonths } = await import("./db.mjs");
const { computeBudget } = await import("./engine.mjs");

beforeEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM assignments").run();
});


// 支出组 + 分类
const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 0);
const spendCid = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(spendCid, spendGid, "食品杂货", 0);
// 收入组 + 分类（is_income=1）
const incomeGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,1)").run(incomeGid, "收入", -1);
const salaryCid = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(salaryCid, incomeGid, "工资薪酬", 0);
const otherIncomeCid = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(otherIncomeCid, incomeGid, "其他收入", 1);

const acc = createAccount({ name: "现金", type: "cash", startingBalance: 0 });
const today = `${currentMonth()}-15`;

function tx({ amount, categoryId = null, payee = "x", transferAccountId = null }) {
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,is_start,pair_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,0,?,?)`
  ).run(uid(), acc, today, payee, transferAccountId, categoryId, "", amount, transferAccountId ? uid() : null, new Date().toISOString());
}

function state() {
  return computeBudget(currentMonth()).byMonth.get(currentMonth());
}

describe("computeBudget：收入分类路由", () => {
  it("收入分类的正数交易计入 inflow，并记入该分类 activity 供来源统计", () => {
    tx({ amount: 1000000, categoryId: salaryCid, payee: "公司发薪" });
    const s = state();
    expect(s.inflow).toBe(1000000);
    expect(s.activity[salaryCid]).toBe(1000000);
    expect(s.readyToAssign).toBe(1000000);
  });

  it("收入分类不参与 Available 预算：不产生可用额、不产生超支", () => {
    tx({ amount: 500000, categoryId: salaryCid });
    // 再给支出分类超支，证明收入分类完全独立
    tx({ amount: -300000, categoryId: spendCid });
    const s = state();
    expect(s.available[spendCid]).toBe(-300000);
    expect(s.available[salaryCid]).toBeUndefined();
    expect(Object.keys(s.assigned)).not.toContain(salaryCid);
    // 500000 inflow - 300000 超支回补 = +200000
    expect(s.readyToAssign).toBe(500000 - 300000);
  });

  it("退款记回支出分类：不进入收入，只抵减该分类 activity", () => {
    tx({ amount: -800000, categoryId: spendCid, payee: "购物" });
    tx({ amount: 100000, categoryId: spendCid, payee: "退货" });
    const s = state();
    expect(s.inflow).toBe(0);
    expect(s.activity[spendCid]).toBe(-700000);
    expect(s.available[spendCid]).toBe(-700000);
  });

  it("收入分类上的负数交易按 YNAB 语义扣减 Ready to Assign（防呆兜底）", () => {
    tx({ amount: 400000, categoryId: otherIncomeCid });
    tx({ amount: -150000, categoryId: otherIncomeCid });
    const s = state();
    expect(s.inflow).toBe(400000 - 150000);
    expect(s.readyToAssign).toBe(250000);
  });

  it("无分类正数仍作为旧约定兜底计入收入", () => {
    tx({ amount: 2500, categoryId: null });
    const s = state();
    expect(s.inflow).toBe(2500);
    expect(s.readyToAssign).toBe(2500);
  });

  it("多个月份：收入分类在月份间正常滚动影响 Ready to Assign", () => {
    db.prepare("DELETE FROM transactions").run();
    const ymdDate = (m, d) => `${m}-${d}`;
    const m1 = addMonths(currentMonth(), -1);
    db.prepare(
      "INSERT INTO transactions(id,account_id,date,payee_name,category_id,amount,created_at) VALUES(?,?,?,?,?,?,?)"
    ).run(uid(), acc, ymdDate(m1, "20"), "发薪", salaryCid, 900000, new Date().toISOString());
    const res = computeBudget(currentMonth());
    const s1 = res.byMonth.get(m1);
    const cur = res.byMonth.get(currentMonth());
    expect(s1.inflow).toBe(900000);
    expect(s1.readyToAssign).toBe(900000);
    // 无支出分配，上月结余滚动到本月
    expect(cur.readyToAssign).toBe(900000);
  });
});
