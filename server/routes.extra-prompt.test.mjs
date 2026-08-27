// 额外提示词配置：PUT 保存后写入 settings，GET /settings 与 GET /bootstrap 回显。
// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-extra-prompt-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db } = await import("./db.mjs");

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

const EXTRA = "我是小王，常用的转账对方是房东张女士，工资每月 10 号入账。\n第二行自定义上下文。";

describe("ai_extra_prompt 额外提示词配置", () => {
  it("PUT /api/settings 可保存额外提示词（含多行）", async () => {
    const r = await call("PUT", "/api/settings", { aiExtraPrompt: EXTRA });
    expect(r.status).toBe(200);
    expect(db.prepare("SELECT value FROM settings WHERE key='ai_extra_prompt'").get().value).toBe(EXTRA);
  });

  it("GET /api/settings 与 GET /api/bootstrap 回显额外提示词", async () => {
    await call("PUT", "/api/settings", { aiExtraPrompt: EXTRA });
    const s = await call("GET", "/api/settings");
    expect(s.json.aiExtraPrompt).toBe(EXTRA);
    const b = await call("GET", "/api/bootstrap");
    expect(b.json.settings.aiExtraPrompt).toBe(EXTRA);
  });

  it("未配置时回退为空字符串", async () => {
    await call("PUT", "/api/settings", { aiExtraPrompt: "" });
    const s = await call("GET", "/api/settings");
    expect(s.json.aiExtraPrompt).toBe("");
  });

  it("超过长度上限时整体拒绝", async () => {
    const tooLong = "x".repeat(20001);
    const r = await call("PUT", "/api/settings", { aiExtraPrompt: tooLong });
    expect(r.status).toBe(400);
    expect(r.json.error).toBeTruthy();
  });
});
