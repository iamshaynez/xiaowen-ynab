// 负数分配与移动资金到待分配：退款流入会抬高该分类当月可用金额（引擎把正数
// 金额计入当月 activity），用户必须能把这笔钱从分类里移出去——要么负数分配、
// 要么移动资金退回 Ready to Assign。
// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR。
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-routes-negassign-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, createAccount, setSetting } = await import("./db.mjs");

const app = express();
app.use(express.json());
app.use("/api", api);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

const OCT = "2026-10";
const NOV = "2026-11";
const MOTOR = 1_300_000; // ¥13000

let catId;
let otherCatId;

beforeEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM assignments").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM categories").run();
  db.prepare("DELETE FROM category_groups").run();
  setSetting("show_cc_payments", "0");

  const gid = uid();
  db.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,0)").run(gid, "测试组");
  catId = uid();
  otherCatId = uid();
  const insCat = db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)");
  insCat.run(catId, gid, "摩托车购置", 0);
  insCat.run(otherCatId, gid, "餐饮", 1);

  // 起始资金 ¥20000（2026-09），10 月给摩托车分配 ¥13000 并花完
  createAccount({ name: "储蓄卡", type: "checking", startingBalance: 2_000_000, startingDate: "2026-09-01" });
  db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)").run(OCT, catId, MOTOR);
  addTx(`${OCT}-15`, -MOTOR, catId, "摩托车行");
  // 11 月全额退款回到原分类（YNAB 口径：退款记回原支出分类）
  addTx(`${NOV}-02`, MOTOR, catId, "摩托车行");
});

function addTx(date, amount, categoryId, payee) {
  const acc = db.prepare("SELECT id FROM accounts LIMIT 1").get();
  db.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,created_at) VALUES(?,?,?,?,NULL,?,?,?,1,0,0,?)"
  ).run(uid(), acc.id, date, payee, categoryId, "", amount, new Date().toISOString());
}

const catView = async (month, id) => {
  const r = await call("GET", `/api/budget/${month}`);
  return r.json.groups.flatMap((g) => g.categories).find((c) => c.id === id);
};

describe("退款场景前置确认（引擎口径）", () => {
  it("11 月全额退款把当月可用抬高到 13000，已分配仍为 0", async () => {
    const cat = await catView(NOV, catId);
    expect(cat.assigned).toBe(0);
    expect(cat.activity).toBe(MOTOR);
    expect(cat.available).toBe(MOTOR);
  });
});

describe("PUT assign：负数分配（把钱移出分类）", () => {
  it("负数分配把退款全额移出：可用归零、金额回到待分配", async () => {
    const r = await call("PUT", `/api/budget/${NOV}/category/${catId}/assign`, { assigned: -MOTOR });
    expect(r.status).toBe(200);
    const cat = await catView(NOV, catId);
    expect(cat.assigned).toBe(-MOTOR);
    expect(cat.available).toBe(0);
    expect(r.json.readyToAssign).toBe(2_000_000);
  });

  it("部分移出：把可用从 13000 降低到 8000", async () => {
    const r = await call("PUT", `/api/budget/${NOV}/category/${catId}/assign`, { assigned: -(MOTOR - 800_000) });
    expect(r.status).toBe(200);
    const cat = await catView(NOV, catId);
    expect(cat.available).toBe(800_000);
  });

  it("负数分配不允许把当月可用拉成负数", async () => {
    const r = await call("PUT", `/api/budget/${NOV}/category/${catId}/assign`, { assigned: -(MOTOR + 1) });
    expect(r.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) c FROM assignments WHERE month=? AND category_id=?").get(NOV, catId).c).toBe(0);
  });

  it("正数分配行为不变", async () => {
    const r = await call("PUT", `/api/budget/${NOV}/category/${catId}/assign`, { assigned: 300_000 });
    expect(r.status).toBe(200);
    const cat = await catView(NOV, catId);
    expect(cat.available).toBe(MOTOR + 300_000);
  });

  it("隐藏虚拟分组时对 cc: 还款科目分配保持原行为（不设下限）", async () => {
    const card = db
      .prepare("INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,sort_order,created_at) VALUES(?,?,?,1,0,0,0,?)")
      .run(uid(), "测试信用卡", "creditCard", new Date().toISOString());
    const r = await call("PUT", `/api/budget/${NOV}/category/cc:${card.lastInsertRowid}/assign`, { assigned: -100 });
    expect(r.status).toBe(200);
  });
});

describe("POST move：移动资金到 Ready to Assign", () => {
  it("move 到 rta：来源扣减、待分配等额增加", async () => {
    const r = await call("POST", `/api/budget/${NOV}/move`, { fromId: catId, toId: "rta", amount: MOTOR });
    expect(r.status).toBe(200);
    const cat = await catView(NOV, catId);
    expect(cat.available).toBe(0);
    expect(r.json.readyToAssign).toBe(2_000_000);
  });

  it("move 金额超过来源当月可用：拒绝", async () => {
    const r = await call("POST", `/api/budget/${NOV}/move`, { fromId: catId, toId: "rta", amount: MOTOR + 1 });
    expect(r.status).toBe(400);
    expect((await catView(NOV, catId)).available).toBe(MOTOR);
  });

  it("普通分类之间的 move 回归不受影响", async () => {
    await call("PUT", `/api/budget/${NOV}/category/${otherCatId}/assign`, { assigned: 100_000 });
    const r = await call("POST", `/api/budget/${NOV}/move`, { fromId: catId, toId: otherCatId, amount: 300_000 });
    expect(r.status).toBe(200);
    const from = await catView(NOV, catId);
    const to = await catView(NOV, otherCatId);
    expect(from.available).toBe(MOTOR - 300_000);
    expect(to.assigned).toBe(400_000);
    expect(to.available).toBe(400_000);
  });
});
