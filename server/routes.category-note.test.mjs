// 分类备注（长文本）：categories.note 字段的迁移、读写与预算载荷透出。
// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-catnote-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db, uid, currentMonth } = await import("./db.mjs");

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

const gid = db.prepare("SELECT id FROM category_groups LIMIT 1").get().id;
const catId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(catId, gid, "备注测试分类");
const cur = currentMonth();

describe("categories.note 备注字段", () => {
  it("迁移后 categories 表存在 note 列，默认空字符串", () => {
    const cols = db.prepare("PRAGMA table_info(categories)").all().map((c) => c.name);
    expect(cols).toContain("note");
    const row = db.prepare("SELECT note FROM categories WHERE id=?").get(catId);
    expect(row.note).toBe("");
  });

  it("PUT /api/categories/:id 可写入多行长文本备注", async () => {
    const note = "每周买菜预算\n备注第二行：尽量在周末采购，".repeat(20);
    const r = await call("PUT", `/api/categories/${catId}`, { note });
    expect(r.status).toBe(200);
    expect(db.prepare("SELECT note FROM categories WHERE id=?").get(catId).note).toBe(note);
  });

  it("仅改名称时备注保持不变，仅改备注时名称保持不变", async () => {
    await call("PUT", `/api/categories/${catId}`, { note: "固定备注" });
    await call("PUT", `/api/categories/${catId}`, { name: "改名后" });
    const row = db.prepare("SELECT name, note FROM categories WHERE id=?").get(catId);
    expect(row.name).toBe("改名后");
    expect(row.note).toBe("固定备注");
  });

  it("备注会出现在预算载荷与 bootstrap 的分类数据里", async () => {
    await call("PUT", `/api/categories/${catId}`, { note: "载荷透出" });
    const b = await call("GET", `/api/budget/${cur}`);
    const cat = b.json.groups.flatMap((g) => g.categories).find((c) => c.id === catId);
    expect(cat.note).toBe("载荷透出");

    const boot = await call("GET", "/api/bootstrap");
    const bootCat = boot.json.groups.flatMap((g) => g.categories).find((c) => c.id === catId);
    expect(bootCat.note).toBe("载荷透出");
  });

  it("备注可清空为空字符串", async () => {
    const r = await call("PUT", `/api/categories/${catId}`, { note: "" });
    expect(r.status).toBe(200);
    expect(db.prepare("SELECT note FROM categories WHERE id=?").get(catId).note).toBe("");
  });
});
