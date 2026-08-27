// 隔离环境：必须在导入 db.mjs 之前设置 DATA_DIR。
// 场景：用 migrations 数组手工把库升到 v4（不含 v5），铺入旧约定的数据后
// 再导入 db.mjs 触发 v5 升级，验证收入分类体系的建立与存量数据迁移。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-income-mig-test-"));

// ---- 预置一个「v4 旧库」：按顺序应用 version<=4 的迁移 ----
{
  const legacy = new Database(path.join(process.env.DATA_DIR, "budget.db"));
  legacy.pragma("journal_mode = WAL");
  const { migrations } = await import("./migrations.mjs");
  legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const record = legacy.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)");
  for (const m of migrations.filter((m) => m.version <= 4)) {
    m.up(legacy);
    record.run(m.version, m.name, "2026-01-01T00:00:00.000Z");
  }

  const uid = () => crypto.randomUUID();
  const insG = legacy.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,?)");
  const insC = legacy.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)");
  const insA = legacy.prepare(
    "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at) VALUES(?,?,?,1,0,?,?,0,?)"
  );
  const insT = legacy.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,is_start,pair_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  );

  // 支出组 + 分类（正常预算结构）
  const spendGid = uid();
  insG.run(spendGid, "日常开销", 0);
  const foodCid = uid();
  insC.run(foodCid, spendGid, "食品杂货", 0);

  // 用户此前自建的、恰好叫「收入」的普通组：v5 应收编而不是重复建组
  const userIncomeGid = uid();
  insG.run(userIncomeGid, "收入", 9);
  const sideJobCid = uid();
  insC.run(sideJobCid, userIncomeGid, "兼职", 0);

  const accId = uid();
  insA.run(accId, "招商银行", "checking", 960000, "2026-02-25", "2026-02-25T08:00:00.000Z");

  // 旧约定：NULL + 正数 = 收入
  insT.run(uid(), accId, "2026-03-10", "公司发薪", null, null, "工资入账", 1280000, 0, null, "2026-03-10T08:00:00.000Z");
  // 真未分类支出：必须保持 NULL
  insT.run(uid(), accId, "2026-03-11", "神秘扣款", null, null, "", -1234, 0, null, "2026-03-11T08:00:00.000Z");
  // 转账腿（NULL + 正数）：不是收入，不能被迁移
  insT.run(uid(), accId, "2026-03-12", "转账", "acc-other", null, "", 50000, 0, null, "2026-03-12T08:00:00.000Z");
  // 期初余额行：不动
  insT.run(uid(), accId, "2026-02-25", "__starting__", null, null, "", 960000, 1, null, "2026-02-25T08:00:00.000Z");

  legacy.close();
}

const { db } = await import("./db.mjs");

function groupByName(name) {
  return db.prepare("SELECT * FROM category_groups WHERE name=?").get(name);
}
function catsOf(groupId) {
  return db.prepare("SELECT name FROM categories WHERE group_id=? ORDER BY sort_order").all(groupId).map((r) => r.name);
}

describe("migration v5：income-categories", () => {
  it("category_groups 增加 is_income 列，默认 0", () => {
    const cols = db.pragma("table_info(category_groups)").map((c) => c.name);
    expect(cols).toContain("is_income");
    expect(groupByName("日常开销").is_income).toBe(0);
  });

  it("已存在的同名「收入」组被收编为 is_income=1，且不重复建组", () => {
    const groups = db.prepare("SELECT COUNT(*) c FROM category_groups WHERE name='收入'").get().c;
    expect(groups).toBe(1);
    expect(groupByName("收入").is_income).toBe(1);
    // 原有自定义分类保留在组内
    expect(catsOf(groupByName("收入").id)).toContain("兼职");
  });

  it("种子常用收入来源分类到收入组", () => {
    const names = catsOf(groupByName("收入").id);
    for (const n of ["工资薪酬", "奖金", "理财收益", "红包礼金", "其他收入"]) {
      expect(names).toContain(n);
    }
  });

  it("存量「无分类流入」迁移到其他收入；未分类流出/转账/期初行保持 NULL", () => {
    const otherIncomeId = db
      .prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=1 AND c.name='其他收入'")
      .get().id;
    expect(otherIncomeId).toBeTruthy();

    const salary = db.prepare("SELECT * FROM transactions WHERE payee_name='公司发薪'").get();
    expect(salary.category_id).toBe(otherIncomeId);

    const mystery = db.prepare("SELECT * FROM transactions WHERE payee_name='神秘扣款'").get();
    expect(mystery.category_id).toBeNull();

    const transferLeg = db.prepare("SELECT * FROM transactions WHERE payee_name='转账'").get();
    expect(transferLeg.category_id).toBeNull();

    const startRow = db.prepare("SELECT * FROM transactions WHERE is_start=1").get();
    expect(startRow.category_id).toBeNull();
  });

  it("升级后数据库完整性不受影响", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toHaveLength(0);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });
});
