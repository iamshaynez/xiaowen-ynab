// 认证下的路由守卫测试：设置 APP_PASSWORD 后，除登录与状态外的接口均需 Bearer token。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-auth-test-"));
process.env.APP_PASSWORD = "fixture";

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");

const app = express();
app.use(express.json());
app.use("/api", api);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const call = async (method, url, body, token) => {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

describe("auth routes", () => {
  it("reports auth as enabled", async () => {
    const r = await call("GET", "/api/auth/status");
    expect(r.status).toBe(200);
    expect(r.json.enabled).toBe(true);
  });

  it("status endpoint is public (no token required)", async () => {
    const r = await call("GET", "/api/auth/status");
    expect(r.status).toBe(200);
  });

  it("rejects login with a wrong password", async () => {
    const r = await call("POST", "/api/auth/login", { password: "wrong" });
    expect(r.status).toBe(401);
  });

  it("rejects login with missing password", async () => {
    const r = await call("POST", "/api/auth/login", {});
    expect(r.status).toBe(401);
  });

  it("issues a token for the correct password", async () => {
    const r = await call("POST", "/api/auth/login", { password: "fixture" });
    expect(r.status).toBe(200);
    expect(typeof r.json.token).toBe("string");
    expect(r.json.token.split(".").length).toBe(3);
  });

  it("blocks bootstrap without a token", async () => {
    const r = await call("GET", "/api/bootstrap");
    expect(r.status).toBe(401);
  });

  it("blocks settings write without a token", async () => {
    const r = await call("POST", "/api/demo");
    expect(r.status).toBe(401);
  });

  it("allows bootstrap with a valid token", async () => {
    const login = await call("POST", "/api/auth/login", { password: "fixture" });
    const r = await call("GET", "/api/bootstrap", undefined, login.json.token);
    expect(r.status).toBe(200);
    expect(r.json.currentMonth).toBeTruthy();
  });

  it("rejects a tampered token", async () => {
    const r = await call("GET", "/api/bootstrap", undefined, "aaa.bbb.ccc");
    expect(r.status).toBe(401);
  });
});
