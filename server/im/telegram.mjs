// Telegram Bot 适配器：getUpdates 长轮询接收消息，sendMessage 回复。
// 不引入任何第三方依赖，直接使用全局 fetch。

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SEC = 25;
const POLL_HTTP_TIMEOUT_MS = 35000;
const CALL_TIMEOUT_MS = 15000;
const TG_TEXT_LIMIT = 4000; // Telegram 上限 4096，留余量

export function createTelegramAdapter({ token, allowedChatIds = [], cursor = null }, hooks) {
  let running = false;
  let offset = Number(cursor) || 0;
  let wakeTimer = null;

  const allowSet = new Set((allowedChatIds || []).map(String).filter(Boolean));

  async function apiCall(method, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.description || `telegram ${method} failed (${res.status})`);
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  function sendText(chatId, text) {
    const content = text.length > TG_TEXT_LIMIT ? text.slice(0, TG_TEXT_LIMIT) + "\n…（内容过长已截断）" : text;
    return apiCall(
      "sendMessage",
      { chat_id: chatId, text: content, disable_web_page_preview: true },
      CALL_TIMEOUT_MS
    ).catch((e) => hooks.log?.(`[telegram] sendMessage failed: ${e.message}`));
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      wakeTimer = setTimeout(resolve, ms);
    });
  }

  /** 单次拉取并处理所有待处理更新；独立导出便于测试 */
  async function pollOnce() {
    const updates = await apiCall("getUpdates", { offset, timeout: POLL_TIMEOUT_SEC }, POLL_HTTP_TIMEOUT_MS);
    for (const u of updates || []) {
      offset = u.update_id + 1;
      hooks.persistCursor?.(String(offset));
      const msg = u.message;
      if (!msg || typeof msg.text !== "string" || !msg.text.trim()) continue;
      const chatId = String(msg.chat.id);
      if (allowSet.size > 0 && !allowSet.has(chatId)) continue;
      try {
        const reply = await hooks.onMessage(chatId, msg.text);
        if (reply) await sendText(chatId, reply);
      } catch (e) {
        hooks.log?.(`[telegram] handle message failed: ${e.message}`);
        sendText(chatId, "出错了，请稍后重试。");
      }
    }
  }

  async function loop() {
    let backoffMs = 1000;
    while (running) {
      try {
        await pollOnce();
        backoffMs = 1000;
        // 正常情况下 getUpdates 会长阻塞；这里兜底防止服务端即返时热空转
        await sleep(50);
      } catch (e) {
        if (!running) break;
        hooks.log?.(`[telegram] poll error: ${e.message}`);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loop();
    },
    stop() {
      running = false;
      if (wakeTimer) clearTimeout(wakeTimer);
    },
    get running() {
      return running;
    },
    pollOnce,
    test() {
      return apiCall("getMe", {}, CALL_TIMEOUT_MS).then((me) => ({ ok: true, username: me.username }));
    },
    sendText,
  };
}
