import { db, uid, nowIso } from "../db.mjs";

export const CHANNEL_TYPES = ["telegram", "wechat"];

// 各渠道允许写入 config 的字段；多余字段一律丢弃，避免垃圾数据
const CONFIG_FIELDS = {
  telegram: ["token", "allowedChatIds"],
  // 个人微信号（ilink bot 协议）：扫码登录后由服务端写入凭据
  wechat: ["token", "baseUrl", "userId", "botId"],
};

export function normalizeConfig(type, raw = {}) {
  const fields = CONFIG_FIELDS[type] || [];
  const out = {};
  for (const f of fields) {
    const v = raw[f];
    if (f === "allowedChatIds") {
      out[f] = Array.isArray(v)
        ? v.map((x) => String(x).trim()).filter(Boolean)
        : String(v ?? "")
            .split(/[,，\s]+/)
            .filter(Boolean);
    } else if (typeof v === "string") {
      out[f] = v.trim();
    }
  }
  return out;
}

// 凭据类校验只在渠道被启用时强制（个人微信号先建渠道、再扫码获取 token）
export function validateConfig(type, config, { enabled = true } = {}) {
  if (!CHANNEL_TYPES.includes(type)) return "invalid channel type";
  if (!enabled) return null;
  if (type === "telegram" && !config.token) return "telegram token required";
  if (type === "wechat" && !config.token) return "wechat bot token required (scan QR to login)";
  return null;
}

export function rowToChannel(row) {
  let config = {};
  try {
    config = JSON.parse(row.config || "{}");
  } catch {}
  return { ...row, enabled: !!row.enabled, config };
}

export function listChannels() {
  return db.prepare("SELECT * FROM im_channels ORDER BY created_at").all().map(rowToChannel);
}

export function getChannel(id) {
  const row = db.prepare("SELECT * FROM im_channels WHERE id=?").get(id);
  return row ? rowToChannel(row) : null;
}

export function getChannelRow(id) {
  return db.prepare("SELECT * FROM im_channels WHERE id=?").get(id);
}

export function createChannel({ type, name, enabled = false, config = {} }) {
  const norm = normalizeConfig(type, config);
  const err = validateConfig(type, norm, { enabled });
  if (err) throw new Error(err);
  const id = uid();
  const now = nowIso();
  db.prepare(
    "INSERT INTO im_channels(id,type,name,enabled,config,cursor,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?)"
  ).run(id, type, (name || defaultName(type)).slice(0, 60), enabled ? 1 : 0, JSON.stringify(norm), now, now);
  return getChannel(id);
}

function defaultName(type) {
  return type === "telegram" ? "Telegram Bot" : "我的微信";
}

export function updateChannel(id, patch = {}) {
  const ch = getChannel(id);
  if (!ch) return null;
  const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 60) : ch.name;
  const enabled = typeof patch.enabled === "boolean" ? patch.enabled : ch.enabled;
  const config = normalizeConfig(ch.type, { ...ch.config, ...(patch.config || {}) });
  const err = validateConfig(ch.type, config, { enabled });
  if (err) throw new Error(err);
  db.prepare("UPDATE im_channels SET name=?, enabled=?, config=?, updated_at=? WHERE id=?").run(
    name,
    enabled ? 1 : 0,
    JSON.stringify(config),
    nowIso(),
    id
  );
  return getChannel(id);
}

export function deleteChannel(id) {
  db.prepare("DELETE FROM im_channels WHERE id=?").run(id);
}

export function setCursor(id, cursor) {
  db.prepare("UPDATE im_channels SET cursor=? WHERE id=?").run(cursor == null ? null : String(cursor), id);
}
