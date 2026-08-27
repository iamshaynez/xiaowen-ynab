// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-routes-income-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, createAccount, nowIso, currentMonth } = await import("./db.mjs");
const { reportsOverview } = await import("./engine.mjs");

const app = express();
app.use(express.json());
app.use("/api", api);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

// ---- fixtures ----
const acc = createAccount({ name: "现金", type: "cash", startingBalance: 0 });

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,0,0)").run(spendGid, "日常开销");
const spendCat = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(spendCat, spendGid, "食品杂货");

const incomeGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,1)").run(incomeGid, "收入", -1);
const salaryCat = uid();
const otherIncomeCat = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(salaryCat, incomeGid, "工资薪酬");
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,1)").run(otherIncomeCat, incomeGid, "其他收入");

const insertTx = ({ payee = "", amount, categoryId = null, date = "2026-08-10" }) => {
  const id = uid();
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
     VALUES(?,?,?,?,NULL,?,?,?,0,0,0,NULL,?)`
  ).run(id, acc, date, payee, categoryId, "", amount, nowIso());
  return id;
};

describe("POST /api/transactions：收入分类方向校验", () => {
  it("正数（收入）+ 收入分类：允许保存", async () => {
    const r = await call("POST", "/api/transactions", {
      accountId: acc, date: "2026-08-11", payeeName: "公司发薪", amount: 1280000, categoryId: salaryCat,
    });
    expect(r.status).toBe(200);
    const row = db.prepare("SELECT category_id,amount FROM transactions WHERE account_id=? AND payee_name='公司发薪'").get(acc);
    expect(row.category_id).toBe(salaryCat);
    expect(row.amount).toBe(1280000);
  });

  it("负数（流出）+ 收入分类：拒绝", async () => {
    const r = await call("POST", "/api/transactions", {
      accountId: acc, date: "2026-08-12", payeeName: "误标", amount: -500, categoryId: salaryCat,
    });
    expect(r.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE payee_name='误标'").get().c).toBe(0);
  });
});

describe("PATCH /api/transactions/:id/category：方向校验", () => {
  it("把流出改到收入分类：拒绝；改到支出分类：允许", async () => {
    const outflowId = insertTx({ payee: "买包", amount: -8000 });
    const bad = await call("PATCH", `/api/transactions/${outflowId}/category`, { categoryId: salaryCat });
    expect(bad.status).toBe(400);
    const ok = await call("PATCH", `/api/transactions/${outflowId}/category`, { categoryId: spendCat });
    expect(ok.status).toBe(200);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(outflowId).category_id).toBe(spendCat);
  });

  it("把流入改到收入分类：允许；改到支出分类也表示退款/重新分类，允许", async () => {
    const inflowId = insertTx({ payee: "利息", amount: 2000 });
    const okIncome = await call("PATCH", `/api/transactions/${inflowId}/category`, { categoryId: otherIncomeCat });
    expect(okIncome.status).toBe(200);
    const okRefund = await call("PATCH", `/api/transactions/${inflowId}/category`, { categoryId: spendCat });
    expect(okRefund.status).toBe(200);
  });
});

describe("POST /api/transactions/bulk-category：方向校验", () => {
  it("纯支出批量可设置为收入分类以外的分类；混入负数的批量被拒绝", async () => {
    const outflowA = insertTx({ payee: "a", amount: -100 });
    const outflowB = insertTx({ payee: "b", amount: -200 });
    const mixed = await call("POST", "/api/transactions/bulk-category", { ids: [outflowA, outflowB], categoryId: salaryCat });
    expect(mixed.status).toBe(400);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(outflowA).category_id).toBeNull();
  });

  it("纯流入批量可设置为收入分类，且成功修改", async () => {
    const inflowA = insertTx({ payee: "c", amount: 1000 });
    const inflowB = insertTx({ payee: "d", amount: 2000 });
    const r = await call("POST", "/api/transactions/bulk-category", { ids: [inflowA, inflowB], categoryId: salaryCat });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(2);
  });
});

describe("PUT /api/transactions/:id：编辑时方向校验", () => {
  it("编辑流入交易时选择收入分类（即便金额被改为负数）被拒绝", async () => {
    const id = insertTx({ payee: "e", amount: 1000 });
    const bad = await call("PUT", `/api/transactions/${id}`, {
      accountId: acc, date: "2026-08-13", payeeName: "e", amount: -500, categoryId: salaryCat,
    });
    expect(bad.status).toBe(400);
  });
});

describe("PUT /api/category-groups/:id：收入组保护", () => {
  it("收入组不允许隐藏；允许改名", async () => {
    const hide = await call("PUT", `/api/category-groups/${incomeGid}`, { name: "收入", hidden: true });
    expect(hide.status).toBe(400);
    const rename = await call("PUT", `/api/category-groups/${incomeGid}`, { name: "收入来源" });
    expect(rename.status).toBe(200);
    expect(db.prepare("SELECT name FROM category_groups WHERE id=?").get(incomeGid).name).toBe("收入来源");
  });
});

describe("GET /api/budget/:month：收入分组不进入可分配列表", () => {
  it("预算载荷丢弃 is_income 分组，且收入分类不出现在任何组内", async () => {
    const r = await call("GET", `/api/budget/${currentMonth()}`);
    expect(r.status).toBe(200);
    expect(r.json.groups.some((g) => g.is_income)).toBe(false);
    const allIds = r.json.groups.flatMap((g) => g.categories.map((c) => c.id));
    expect(allIds).not.toContain(salaryCat);
    expect(allIds).not.toContain(otherIncomeCat);
  });
});

describe("GET /api/reports/overview：收入口径一致", () => {
  beforeAll(() => {
    db.prepare("DELETE FROM transactions").run();
    // 一笔收入（收入分类）、一笔退款到支出分类（正数）、一笔普通支出
    insertTx({ date: `${currentMonth()}-05`, payee: "工资", amount: 1000000, categoryId: salaryCat });
    insertTx({ date: `${currentMonth()}-07`, payee: "退货", amount: 100000, categoryId: spendCat });
    insertTx({ date: `${currentMonth()}-08`, payee: "买菜", amount: -5000, categoryId: spendCat });
  });

  it("收入只统计收入分类/无分类正数；退款到支出分类不计入收入", () => {
    const rep = reportsOverview(3);
    const m = currentMonth();
    const income = rep.income.find((x) => x.month === m).value;
    expect(income).toBe(1000000);
  });

  it("收入来源 breakdown 按收入分类列出", () => {
    const rep = reportsOverview(3);
    const src = rep.incomeSources;
    expect(src).toEqual([{ name: "工资薪酬", value: 1000000 }]);
  });
});
