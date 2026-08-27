// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-reconcile-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, nowIso, createAccount, todayYmd, currentMonth } = await import("./db.mjs");

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

function insertTx(account, { date, payee = "", categoryId = null, amount, cleared = 1, transferAccountId = null }) {
  const id = uid();
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,0,0,NULL,?)`
  ).run(id, account, date, payee, transferAccountId, categoryId, "", amount, cleared, nowIso());
  return id;
}

function txCount(accountId) {
  return db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=?").get(accountId).c;
}

// 各用例独立账户，互不干扰
const accEq = createAccount({ name: "对账-金额一致", type: "cash", startingBalance: 10000 });
insertTx(accEq, { date: "2026-08-10", payee: "已清支出", amount: -3000 }); // 计算=7000

const accPos = createAccount({ name: "对账-多出", type: "cash", startingBalance: 10000 }); // 计算=10000

const accNeg = createAccount({ name: "对账-少了", type: "cash", startingBalance: 10000 });
insertTx(accNeg, { date: todayYmd(), payee: "已清支出", amount: -2000 }); // 计算=8000

const accClear = createAccount({ name: "对账-补勾清算", type: "cash", startingBalance: 10000 });
insertTx(accClear, { date: "2026-08-11", payee: "未清支出A", amount: -800, cleared: 0 });
insertTx(accClear, { date: "2026-08-12", payee: "转账腿", amount: -500, cleared: 0, transferAccountId: accPos });

const accKeep = createAccount({ name: "对账-默认不动未清", type: "cash", startingBalance: 10000 });
insertTx(accKeep, { date: "2026-08-13", payee: "未清支出B", amount: -600, cleared: 0 });

const accUncat = createAccount({ name: "对账-未分类过滤", type: "cash", startingBalance: 5000 });
insertTx(accUncat, { date: todayYmd(), payee: "普通未分类", amount: -2000, cleared: 0 }); // 计算=3000

const cur = currentMonth();

describe("POST /api/reconcile/:accountId", () => {
  it("输入等于当前余额时只锁定已对账，不新增流水", async () => {
    const before = txCount(accEq);
    const r = await call("POST", `/api/reconcile/${accEq}`, { statementBalance: 7000 });
    expect(r.status).toBe(200);
    expect(r.json.adjustment).toBeNull();
    expect(txCount(accEq)).toBe(before);

    const locked = db.prepare("SELECT reconciled FROM transactions WHERE account_id=? AND cleared=1").all(accEq);
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((x) => x.reconciled === 1)).toBe(true);
  });

  it("实际余额多于计算值时创建正差额流水，账户余额等于输入值", async () => {
    const before = txCount(accPos);
    const r = await call("POST", `/api/reconcile/${accPos}`, { statementBalance: 10500 });
    expect(r.status).toBe(200);
    expect(r.json.adjustment).toBe(500);

    const row = db
      .prepare(
        "SELECT * FROM transactions WHERE account_id=? AND is_start=0 ORDER BY rowid DESC LIMIT 1"
      )
      .get(accPos);
    expect(txCount(accPos)).toBe(before + 1);
    expect(row.amount).toBe(500);
    expect(row.date).toBe(todayYmd());
    expect(row.category_id).toBeNull();
    expect(row.cleared).toBe(1);
    expect(row.reconciled).toBe(1);
    expect(row.is_reconcile_adjustment).toBe(1);
    // 前端不应看到哨兵收款方
    const reg = await call("GET", `/api/accounts/${accPos}/transactions`);
    expect(reg.json.account.balance).toBe(10500);
    const newest = reg.json.transactions[0];
    expect(newest.amount).toBe(500);
    expect(newest.payeeName).toBeNull();

    const r2 = await call("POST", `/api/reconcile/${accPos}`, {});
    expect(r2.json.adjustment).toBeNull(); // 空 body 兼容旧调用，不再生成差额
  });

  it("负差额减少当前月待分配金额（未分配承担差额）", async () => {
    const b1 = (await call("GET", `/api/budget/${cur}`)).json.readyToAssign;
    const r = await call("POST", `/api/reconcile/${accNeg}`, { statementBalance: 5000 });
    expect(r.json.adjustment).toBe(-3000);
    const b2 = (await call("GET", `/api/budget/${cur}`)).json.readyToAssign;
    expect(b2 - b1).toBe(-3000);
  });

  it("正差额增加当前月待分配金额", async () => {
    const b1 = (await call("GET", `/api/budget/${cur}`)).json.readyToAssign;
    const r = await call("POST", `/api/reconcile/${accPos}`, { statementBalance: 11000 });
    expect(r.json.adjustment).toBe(500);
    const b2 = (await call("GET", `/api/budget/${cur}`)).json.readyToAssign;
    expect(b2 - b1).toBe(500);
  });

  it("差额流水不计入未分类提醒，而普通未分类交易照旧计入", async () => {
    const list = await call("GET", "/api/transactions?uncategorized=1");
    const ids = list.json.transactions.map((t) => t.id);
    const plain = db.prepare("SELECT id FROM transactions WHERE account_id=? AND payee_name='普通未分类'").get(accUncat).id;
    expect(ids).toContain(plain);

    const adj = await call("POST", `/api/reconcile/${accUncat}`, { statementBalance: 4200 }); // 差额 +1200
    expect(adj.json.adjustment).toBe(1200);

    const list2 = await call("GET", "/api/transactions?uncategorized=1");
    expect(list2.json.total).toBe(list.json.total); // 差额行不进未分类列表
    const amounts = list2.json.transactions.map((t) => t.amount);
    expect(amounts).not.toContain(1200);

    const bud = (await call("GET", `/api/budget/${cur}`)).json;
    expect(bud.uncategorizedCount).toBeGreaterThanOrEqual(1);
    // 普通未分类行计入；差额行不计入 —— 用另一笔已知差额前后对比更直接：
    const c1 = db.prepare(
      "SELECT COUNT(*) c FROM transactions WHERE category_id IS NULL AND transfer_account_id IS NULL AND is_start=0 AND is_reconcile_adjustment=0"
    ).get().c;
    expect(c1).toBeGreaterThan(0);
  });

  it("markCleared:true 把非转账的未清流水勾为已清并锁定；转账腿不受影响", async () => {
    const r = await call("POST", `/api/reconcile/${accClear}`, { statementBalance: undefined, markCleared: true });
    expect(r.status).toBe(200);
    const normal = db.prepare("SELECT cleared,reconciled FROM transactions WHERE account_id=? AND payee_name='未清支出A'").get(accClear);
    expect(normal.cleared).toBe(1);
    expect(normal.reconciled).toBe(1);
    const leg = db.prepare("SELECT cleared FROM transactions WHERE account_id=? AND payee_name='转账腿'").get(accClear);
    expect(leg.cleared).toBe(0); // 转账对腿保持原状
  });

  it("缺省 markCleared 时未清流水保持原样", async () => {
    await call("POST", `/api/reconcile/${accKeep}`, {});
    const kept = db.prepare("SELECT cleared,reconciled FROM transactions WHERE account_id=? AND payee_name='未清支出B'").get(accKeep);
    expect(kept.cleared).toBe(0);
    expect(kept.reconciled).toBe(0);
  });

  it("非法 statementBalance 返回 400", async () => {
    const r = await call("POST", `/api/reconcile/${accEq}`, { statementBalance: "abc" });
    expect(r.status).toBe(400);
    const notFound = await call("POST", "/api/reconcile/no-such-account", {});
    expect(notFound.status).toBe(400);
  });
});
