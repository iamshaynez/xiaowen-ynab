// 信用卡还款虚拟分组的显示设置：默认隐藏，设置开启后出现在预算分组里。
// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR。
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-routes-cc-group-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, currentMonth, setSetting } = await import("./db.mjs");

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

const month = currentMonth();

beforeEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM assignments").run();
  db.prepare("DELETE FROM accounts").run();
  setSetting("show_cc_payments", "0");
});

const addCreditCard = (name = "测试信用卡") =>
  db
    .prepare(
      "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,sort_order,created_at) VALUES(?,?,?,1,0,0,0,?)"
    )
    .run(uid(), name, "creditCard", new Date().toISOString());

const budgetGroups = async () => (await call("GET", `/api/budget/${month}`)).json.groups;

describe("信用卡还款虚拟分组的显示设置", () => {
  it("GET /api/settings 默认 showCcPayments=false", async () => {
    const r = await call("GET", "/api/settings");
    expect(r.status).toBe(200);
    expect(r.json.showCcPayments).toBe(false);
  });

  it("默认隐藏：预算分组不含 __cc__ 虚拟组", async () => {
    addCreditCard();
    const groups = await budgetGroups();
    expect(groups.some((g) => g.virtual)).toBe(false);
  });

  it("开启后预算分组包含 __cc__ 虚拟组，可再次关闭", async () => {
    addCreditCard();
    const r = await call("PUT", "/api/settings", { showCcPayments: true });
    expect(r.status).toBe(200);
    expect((await call("GET", "/api/settings")).json.showCcPayments).toBe(true);

    const groups = await budgetGroups();
    const vg = groups.find((g) => g.virtual);
    expect(vg).toBeTruthy();
    expect(vg.categories.length).toBe(1);
    expect(vg.categories[0].id).toMatch(/^cc:/);

    await call("PUT", "/api/settings", { showCcPayments: false });
    expect((await call("GET", "/api/settings")).json.showCcPayments).toBe(false);
    expect((await budgetGroups()).some((g) => g.virtual)).toBe(false);
  });

  it("无预算内信用卡时，开启设置也不会出现虚拟组", async () => {
    await call("PUT", "/api/settings", { showCcPayments: true });
    expect((await budgetGroups()).some((g) => g.virtual)).toBe(false);
  });
});
