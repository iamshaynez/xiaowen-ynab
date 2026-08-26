// 隔离环境：必须在导入 db/engine 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
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
