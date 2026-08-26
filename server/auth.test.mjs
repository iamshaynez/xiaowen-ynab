// 认证模块纯函数/中间件测试。环境变量在调用时读取，因此在每个用例内设置/清理。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isAuthEnabled,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
} from "./auth.mjs";

const orig = process.env.APP_PASSWORD;
const origSecret = process.env.JWT_SECRET;

beforeEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.JWT_SECRET;
});

afterEach(() => {
  if (orig === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = orig;
  if (origSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = origSecret;
});

describe("isAuthEnabled", () => {
  it("is false when no APP_PASSWORD is set", () => {
    expect(isAuthEnabled()).toBe(false);
  });
  it("is true when APP_PASSWORD is set", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(isAuthEnabled()).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("rejects when no password is configured", () => {
    expect(verifyPassword("anything")).toBe(false);
  });
  it("accepts the correct password", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(verifyPassword("fixture")).toBe(true);
  });
  it("rejects a wrong password", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(verifyPassword("nope")).toBe(false);
  });
  it("rejects non-string input", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(verifyPassword(123)).toBe(false);
    expect(verifyPassword(null)).toBe(false);
    expect(verifyPassword(undefined)).toBe(false);
  });
  it("does not throw on empty attempt", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(() => verifyPassword("")).not.toThrow();
    expect(verifyPassword("")).toBe(false);
  });
});

describe("JWT token", () => {
  it("round-trips a signed token", () => {
    process.env.APP_PASSWORD = "fixture";
    const token = signToken();
    expect(typeof token).toBe("string");
    expect(verifyToken(token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    process.env.APP_PASSWORD = "fixture";
    const token = signToken();
    const [h, p, s] = token.split(".");
    expect(verifyToken(`${h}.${p}.abc`)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    process.env.APP_PASSWORD = "fixture";
    process.env.JWT_SECRET = "secret-a";
    const token = signToken();
    process.env.JWT_SECRET = "secret-b";
    expect(verifyToken(token)).toBe(false);
  });

  it("rejects garbage input", () => {
    process.env.APP_PASSWORD = "fixture";
    expect(verifyToken("not-a-jwt")).toBe(false);
    expect(verifyToken("")).toBe(false);
    expect(verifyToken(null)).toBe(false);
  });

  it("passes through (returns true) when auth is disabled", () => {
    expect(verifyToken("anything")).toBe(true);
    expect(verifyToken(null)).toBe(true);
  });
});

describe("requireAuth middleware", () => {
  function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = vi.fn((code) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn((body) => {
      res.body = body;
      return res;
    });
    return res;
  }

  it("calls next() when auth is disabled", () => {
    const next = vi.fn();
    requireAuth({ headers: {} }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects with 401 when no Authorization header", () => {
    process.env.APP_PASSWORD = "fixture";
    const next = vi.fn();
    const res = makeRes();
    requireAuth({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the token is invalid", () => {
    process.env.APP_PASSWORD = "fixture";
    const next = vi.fn();
    const res = makeRes();
    requireAuth({ headers: { authorization: "Bearer bad.token.value" } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() with a valid Bearer token", () => {
    process.env.APP_PASSWORD = "fixture";
    const token = signToken();
    const next = vi.fn();
    requireAuth({ headers: { authorization: `Bearer ${token}` } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
