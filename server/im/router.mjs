import { db } from "../db.mjs";
import { createSession, appendUserMessage, runAgent, confirmPending } from "../ai.mjs";
import { formatForIm } from "./format.mjs";

// IM 里用于确认/取消写操作的关键词。
// 微信「引用回复」会被包装成 “[引用: …] 正文”，这里容忍任意引用前缀与结尾标点，
// 保证纯文本对话场景下确认指令可靠命中；普通句子（如「好的，麻烦你了」）不会误触发。
const QUOTE_PREFIX = "(?:\\s*\\[引用:[^\\]]*\\]\\s*)*";
const TRAILING_PUNCT = "[!！？?。．,，、~～\\s]*";
export const CONFIRM_RE = new RegExp(`^${QUOTE_PREFIX}(?:确认|确定|同意|执行|好的?|是的?|ok|yes|y|approve)${TRAILING_PUNCT}$`, "i");
export const CANCEL_RE = new RegExp(`^${QUOTE_PREFIX}(?:取消|算了|不要了?|不执行|否|no|n|cancel|reject)${TRAILING_PUNCT}$`, "i");

// /new：新起会话（Telegram 与微信等所有渠道通用）
export const NEW_SESSION_RE = /^\/new[!！？?。．,，~～\s]*$/i;
const NEW_SESSION_HINT = "🆕 已为你开启新会话，直接说需求就行～";
const NEW_SESSION_ABANDONED = "\n（上一会话中待确认的写操作已作废。）";

function pendingInfo(sessionId) {
  const row = db
    .prepare("SELECT pending_sql, pending_purpose FROM chat_messages WHERE session_id=? AND resolved=0 AND pending_sql IS NOT NULL ORDER BY rowid DESC LIMIT 1")
    .get(sessionId);
  return row ? { sql: row.pending_sql, purpose: row.pending_purpose } : null;
}

function pendingHint(info) {
  const lines = ["⚠️ 助手请求修改你的账本："];
  if (info.purpose) lines.push(`目的：${info.purpose}`);
  lines.push(`SQL：${info.sql.slice(0, 300)}${info.sql.length > 300 ? "…" : ""}`);
  lines.push("回复「确认」执行，或回复「取消」放弃。");
  return lines.join("\n");
}
const NOT_CONFIGURED_HINT =
  "还没有配置 AI 模型。请打开网页端「系统设置 → AI / LLM 配置」，填好接口地址与密钥后再来找我聊天。";

function channelKey(channelRow) {
  return `${channelRow.type}:${channelRow.id}`;
}

function sessionLabel(channelRow) {
  return channelRow.type === "telegram" ? "Telegram" : "微信";
}

function existingSession(channelRow, externalId) {
  // /new 会产生多条历史会话，rowid 最大的一条即当前会话
  return db
    .prepare("SELECT * FROM chat_sessions WHERE channel=? AND external_id=? ORDER BY rowid DESC LIMIT 1")
    .get(channelKey(channelRow), String(externalId));
}

function createImSession(channelRow, externalId) {
  return createSession(`${sessionLabel(channelRow)} · ${String(externalId).slice(0, 30)}`, {
    channel: channelKey(channelRow),
    externalId: String(externalId),
  });
}

export function findOrCreateSession(channelRow, externalId) {
  return existingSession(channelRow, externalId) || createImSession(channelRow, externalId);
}

function hasPending(sessionId) {
  return !!db
    .prepare("SELECT id FROM chat_messages WHERE session_id=? AND resolved=0 AND pending_sql IS NOT NULL LIMIT 1")
    .get(sessionId);
}

// 收集 sinceRowid 之后助手产生的可见回复，合并成一段 IM 文本
function collectAssistantText(sessionId, sinceRowid) {
  const rows = db
    .prepare(
      "SELECT content FROM chat_messages WHERE session_id=? AND role='assistant' AND rowid>? AND content IS NOT NULL AND content != '' ORDER BY rowid"
    )
    .all(sessionId, sinceRowid);
  return rows.map((r) => formatForIm(r.content)).filter(Boolean).join("\n\n");
}

function collectReply(sessionId, sinceRowid) {
  return collectAssistantText(sessionId, sinceRowid) || "（助手没有返回内容，请重试。）";
}

function snapshot(sessionId) {
  return db.prepare("SELECT COALESCE(MAX(rowid),0) m FROM chat_messages WHERE session_id=?").get(sessionId).m;
}

async function finishConfirm(channelRow, sessionId, approve) {
  const mark = snapshot(sessionId);
  await confirmPending(sessionId, approve);
  return collectReply(sessionId, mark);
}

/**
 * IM 渠道入站消息统一入口。
 * @returns {Promise<string>} 需要回发给 IM 用户的消息文本
 */
export async function handleInbound(channelRow, externalId, text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";

  try {
    // /new 优先级最高：即使存在待确认操作也直接开新会话（旧待确认随之作废）
    if (NEW_SESSION_RE.test(trimmed)) {
      const prev = existingSession(channelRow, externalId);
      createImSession(channelRow, externalId);
      return (prev && hasPending(prev.id) ? NEW_SESSION_HINT + NEW_SESSION_ABANDONED : NEW_SESSION_HINT);
    }

    const session = findOrCreateSession(channelRow, externalId);

    if (hasPending(session.id)) {
      if (CONFIRM_RE.test(trimmed)) return await finishConfirm(channelRow, session.id, true);
      if (CANCEL_RE.test(trimmed)) return await finishConfirm(channelRow, session.id, false);
      return pendingHint(pendingInfo(session.id));
    }

    const mark = snapshot(session.id);
    appendUserMessage(session.id, trimmed.slice(0, 8000));
    const result = await runAgent(session.id);
    if (result?.status === "awaiting_confirmation") {
      // 助手在发起写操作前的自然语言说明也要送达 IM 用户，后接确认指引
      const said = collectAssistantText(session.id, mark);
      const hint = pendingHint(pendingInfo(session.id));
      return said ? `${said}\n\n${hint}` : hint;
    }
    return collectReply(session.id, mark);
  } catch (e) {
    if (e && e.message === "AI_NOT_CONFIGURED") return NOT_CONFIGURED_HINT;
    return `出错了：${String(e?.message || e).slice(0, 300)}\n请稍后重试。`;
  }
}
