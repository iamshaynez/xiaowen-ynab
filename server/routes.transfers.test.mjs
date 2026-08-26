// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-routes-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, nowIso, createAccount } = await import("./db.mjs");
const { accountBalances } = await import("./engine.mjs");

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

// 模拟旧版/演示数据：转账两条腿均无 pair_id
function insertLegacyPair(fromId, toId, date, amount) {
  const idA = uid();
  const idB = uid();
  const ins = db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
     VALUES(?,?,?,?,?,NULL,'',?,1,0,0,NULL,?)`
  );
  ins.run(idA, fromId, date, "转账", toId, -amount, nowIso());
  ins.run(idB, toId, date, "", fromId, amount, nowIso());
  return { idA, idB };
}

async function registerOf(accId) {
  const { json } = await call("GET", `/api/accounts/${accId}/transactions`);
  return json;
}

describe("legacy transfers without pair_id", () => {
  it("editing one leg replaces the whole pair without leaving an orphan", async () => {
    const a = createAccount({ name: "A", type: "checking", startingBalance: 0 });
    const b = createAccount({ name: "B", type: "checking", startingBalance: 0 });
    const { idA } = insertLegacyPair(a, b, "2026-08-01", 2200);

    const r = await call("PUT", `/api/transactions/${idA}`, {
      accountId: a,
      date: "2026-08-02",
      payeeName: "房租",
      transferAccountId: b,
      amount: -2200,
    });
    expect(r.status).toBe(200);

    const reg = await registerOf(b);
    // 只能有一条新腿；孤儿腿会让这里出现两行、余额翻倍
    expect(reg.transactions.length).toBe(1);
    expect(reg.account.balance).toBe(2200);
    expect(accountBalances().get(a)).toBe(-2200);
  });

  it("deleting one leg removes both legs", async () => {
    const c = createAccount({ name: "C", type: "checking", startingBalance: 0 });
    const d = createAccount({ name: "D", type: "checking", startingBalance: 0 });
    const { idA } = insertLegacyPair(c, d, "2026-08-03", 500);

    const r = await call("DELETE", `/api/transactions/${idA}`);
    expect(r.status).toBe(200);

    const regD = await registerOf(d);
    expect(regD.transactions.filter((t) => !t.isStart).length).toBe(0);
    expect(regD.account.balance).toBe(0);
    expect(accountBalances().get(c)).toBe(0);
  });

  it("still deletes paired rows via pair_id when present", async () => {
    const e = createAccount({ name: "E", type: "checking", startingBalance: 0 });
    const f = createAccount({ name: "F", type: "checking", startingBalance: 0 });
    const pairId = uid();
    const ins = db.prepare(
      `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,amount,pair_id,is_start,created_at)
       VALUES(?,?,?,?,?,?,?,0,?)`
    );
    ins.run(uid(), e, "2026-08-04", "t", f, -100, pairId, nowIso());
    const idB = uid();
    ins.run(idB, f, "2026-08-04", "", e, 100, pairId, nowIso());

    const r = await call("DELETE", `/api/transactions/${idB}`);
    expect(r.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE pair_id=?").get(pairId).c).toBe(0);
  });
});
