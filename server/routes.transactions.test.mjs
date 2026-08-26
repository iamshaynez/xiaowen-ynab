// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-txlist-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, nowIso, createAccount } = await import("./db.mjs");

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

const accCash = createAccount({ name: "现金", type: "cash", startingBalance: 10000 });
const accBank = createAccount({ name: "储蓄", type: "savings", startingBalance: 0 });

const groupId = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,hidden) VALUES(?,?,0,0)").run(groupId, "日常");
const catFood = uid();
const catTraffic = uid();
const insCat = db.prepare("INSERT INTO categories(id,group_id,name,sort_order,hidden) VALUES(?,?,?,0,0)");
insCat.run(catFood, groupId, "餐饮");
insCat.run(catTraffic, groupId, "交通");

function insertTx({ account = accCash, date, payee = "", memo = "", categoryId = null, amount, isStart = 0 }) {
  const id = uid();
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
     VALUES(?,?,?,?,NULL,?,?,?,0,0,?,NULL,?)`
  ).run(id, account, date, payee, categoryId, memo, amount, isStart, nowIso());
  return id;
}

// 按时间倒序铺一些数据：同一天用 rowid 稳定排序
insertTx({ date: "2026-01-05", payee: "地铁", categoryId: catTraffic, amount: -300 });
insertTx({ date: "2026-03-10", payee: "超市", memo: "买牛奶", categoryId: catFood, amount: -2500 });
insertTx({ date: "2026-08-01", payee: "工资", amount: 500000 });
insertTx({ date: "2026-08-20", payee: "咖啡", amount: -1800 }); // 未分类
insertTx({ date: "2026-08-21", payee: "书店", memo: "杂书", amount: -4500 }); // 未分类
insertTx({ date: "2026-08-22", payee: "初始", amount: 10000, isStart: 1 });

describe("GET /api/transactions（全量交易列表）", () => {
  it("默认按日期倒序返回全部非期初交易，并带 total", async () => {
    const r = await call("GET", "/api/transactions");
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(5);
    const dates = r.json.transactions.map((t) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
    // 同一天内按 rowid 倒序：后插入的在前
    const aug20 = r.json.transactions.filter((t) => t.date === "2026-08-20");
    expect(aug20).toHaveLength(1);
    // 不含期初行
    expect(r.json.transactions.some((t) => t.isStart)).toBe(false);
    // 附带账户名
    expect(r.json.transactions[0].account_name).toBeTruthy();
  });

  it("search 可按收款方、备注、分类匹配", async () => {
    const byPayee = await call("GET", "/api/transactions?search=" + encodeURIComponent("咖啡"));
    expect(byPayee.json.total).toBe(1);
    expect(byPayee.json.transactions[0].payeeName).toBe("咖啡");

    const byMemo = await call("GET", "/api/transactions?search=" + encodeURIComponent("牛奶"));
    expect(byMemo.json.total).toBe(1);
    expect(byMemo.json.transactions[0].memo).toBe("买牛奶");

    const byCat = await call("GET", "/api/transactions?search=" + encodeURIComponent("交通"));
    expect(byCat.json.total).toBe(1);
    expect(byCat.json.transactions[0].categoryId).toBe(catTraffic);
  });

  it("uncategorized=1 只返回未分类且非转账的交易", async () => {
    const r = await call("GET", "/api/transactions?uncategorized=1");
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(new Set(r.json.transactions.map((t) => t.payeeName))).toEqual(new Set(["咖啡", "书店", "工资"]));
    expect(r.json.transactions.every((t) => t.categoryId === null)).toBe(true);
  });

  it("accountId 只返回该账户的交易", async () => {
    insertTx({ account: accBank, date: "2026-07-01", payee: "银行利息", amount: 120 });
    const r = await call("GET", `/api/transactions?accountId=${accBank}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.transactions[0].payeeName).toBe("银行利息");
    expect(r.json.transactions.every((t) => t.accountId === accBank)).toBe(true);
  });

  it("limit/offset 分页且 total 不变", async () => {
    const all = await call("GET", "/api/transactions?accountId=" + accCash);
    const page1 = await call("GET", `/api/transactions?accountId=${accCash}&limit=2&offset=0`);
    const page2 = await call("GET", `/api/transactions?accountId=${accCash}&limit=2&offset=2`);
    expect(page1.json.total).toBe(all.json.total);
    expect(page1.json.transactions).toHaveLength(2);
    expect(page2.json.transactions.length).toBe(Math.min(2, all.json.total - 2));
    expect(page2.json.transactions[0].id).toBe(all.json.transactions[2].id);
    // limit 上限保护
    const huge = await call("GET", "/api/transactions?limit=99999999");
    expect(huge.json.transactions.length).toBeLessThanOrEqual(2000);
  });
});

describe("PATCH /api/transactions/:id/category（快速改分类）", () => {
  it("设置与清除分类，不影响其他字段", async () => {
    const txId = insertTx({ date: "2026-08-25", payee: "快餐", amount: -3200 });
    const set = await call("PATCH", `/api/transactions/${txId}/category`, { categoryId: catFood });
    expect(set.status).toBe(200);
    let row = db.prepare("SELECT * FROM transactions WHERE id=?").get(txId);
    expect(row.category_id).toBe(catFood);
    expect(row.payee_name).toBe("快餐");
    expect(row.amount).toBe(-3200);

    const clear = await call("PATCH", `/api/transactions/${txId}/category`, { categoryId: null });
    expect(clear.status).toBe(200);
    row = db.prepare("SELECT * FROM transactions WHERE id=?").get(txId);
    expect(row.category_id).toBeNull();
  });

  it("拒绝期初余额行和不存在的分类", async () => {
    const startId = db.prepare("SELECT id FROM transactions WHERE is_start=1 LIMIT 1").get().id;
    const badStart = await call("PATCH", `/api/transactions/${startId}/category`, { categoryId: catFood });
    expect(badStart.status).toBe(400);

    const txId = insertTx({ date: "2026-08-25", payee: "x", amount: -1 });
    const badCat = await call("PATCH", `/api/transactions/${txId}/category`, { categoryId: "no-such-cat" });
    expect(badCat.status).toBe(400);
  });
});

describe("POST /api/transactions/bulk-category（批量分类）", () => {
  it("批量设置多个交易的分类并返回 changed 数量", async () => {
    const ids = [
      insertTx({ date: "2026-08-23", payee: "a", amount: -100 }),
      insertTx({ date: "2026-08-24", payee: "b", amount: -200 }),
    ];
    const r = await call("POST", "/api/transactions/bulk-category", { ids, categoryId: catTraffic });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(2);
    for (const id of ids) {
      expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(id).category_id).toBe(catTraffic);
    }
  });

  it("categoryId 为空时批量清除；期初行被跳过", async () => {
    const startId = db.prepare("SELECT id FROM transactions WHERE is_start=1 LIMIT 1").get().id;
    const normalId = insertTx({ date: "2026-08-26", payee: "c", amount: -50, categoryId: catFood });
    const r = await call("POST", "/api/transactions/bulk-category", { ids: [normalId, startId], categoryId: null });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(1);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(normalId).category_id).toBeNull();
  });

  it("非法请求体返回 400", async () => {
    const noIds = await call("POST", "/api/transactions/bulk-category", { categoryId: catFood });
    expect(noIds.status).toBe(400);
    const notArray = await call("POST", "/api/transactions/bulk-category", { ids: "x", categoryId: catFood });
    expect(notArray.status).toBe(400);
  });
});

describe("POST /api/transactions/bulk-delete（批量删除）", () => {
  it("批量删除多笔交易，转账对腿一并删除", async () => {
    const ids = [
      insertTx({ date: "2026-08-10", payee: "d1", amount: -100 }),
      insertTx({ date: "2026-08-11", payee: "d2", amount: -200 }),
    ];
    // 一对转账两条腿
    const pairId = uid();
    const insPair = db.prepare(
      `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,amount,pair_id,is_start,created_at)
       VALUES(?,?,?,?,?,?,?,0,?)`
    );
    const legA = uid();
    const legB = uid();
    insPair.run(legA, accCash, "2026-08-12", "", accBank, -300, pairId, nowIso());
    insPair.run(legB, accBank, "2026-08-12", "", accCash, 300, pairId, nowIso());

    const before = db.prepare("SELECT COUNT(*) c FROM transactions").get().c;
    const r = await call("POST", "/api/transactions/bulk-delete", { ids: [...ids, legA] });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(3); // 请求的 3 笔都算已删（对腿不重复计数）
    for (const id of [...ids, legA, legB]) {
      expect(db.prepare("SELECT id FROM transactions WHERE id=?").get(id)).toBeFalsy();
    }
    const after = db.prepare("SELECT COUNT(*) c FROM transactions").get().c;
    expect(before - after).toBe(4);
  });

  it("期初余额行与不存在的 id 被跳过", async () => {
    const startId = db.prepare("SELECT id FROM transactions WHERE is_start=1 LIMIT 1").get().id;
    const normalId = insertTx({ date: "2026-08-13", payee: "d3", amount: -50 });
    const r = await call("POST", "/api/transactions/bulk-delete", { ids: [normalId, startId, "no-such-tx"] });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(1);
    expect(db.prepare("SELECT id FROM transactions WHERE id=?").get(startId)).toBeTruthy();
  });

  it("非法请求体返回 400", async () => {
    const noIds = await call("POST", "/api/transactions/bulk-delete", {});
    expect(noIds.status).toBe(400);
    const notArray = await call("POST", "/api/transactions/bulk-delete", { ids: 123 });
    expect(notArray.status).toBe(400);
  });
});
