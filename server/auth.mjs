// 登录 / JWT 认证模块。
// 密码通过环境变量 APP_PASSWORD 管理；JWT 签名密钥为 JWT_SECRET，未设置时由密码派生。
// 认证仅在设置了 APP_PASSWORD 时启用（未设置则视为开放，便于本地开发/测试）。
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const TOKEN_TTL = "7d";

export function getPassword() {
  return process.env.APP_PASSWORD || "";
}

export function isAuthEnabled() {
  return !!process.env.APP_PASSWORD;
}

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // 派生自密码，避免要求额外变量，同时保证签名稳定可验证
  return crypto.createHash("sha256").update("xiaowen-ynab:" + getPassword()).digest("hex");
}

function toDigest(str) {
  return crypto.createHash("sha256").update(String(str)).digest();
}

export function verifyPassword(attempt) {
  const pw = getPassword();
  if (!pw || typeof attempt !== "string") return false;
  // 恒定时间比较两段等长摘要，避免时序侧信道泄漏
  return crypto.timingSafeEqual(toDigest(attempt), toDigest(pw));
}

export function signToken() {
  return jwt.sign({ scope: "user" }, secret(), { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  if (!isAuthEnabled()) return true;
  if (!token || typeof token !== "string") return false;
  try {
    return !!jwt.verify(token, secret());
  } catch {
    return false;
  }
}

export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (verifyToken(token)) return next();
  return res.status(401).json({ error: "unauthorized" });
}
