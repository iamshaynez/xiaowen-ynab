// 渠道生命周期管理：根据 DB 中的渠道配置，拉起/停止 Telegram 与个人微信的长轮询。
import { listChannels, setCursor } from "./store.mjs";
import { createTelegramAdapter } from "./telegram.mjs";
import { createWechatPersonalAdapter } from "./wechat.mjs";
import { handleInbound } from "./router.mjs";

const running = new Map(); // channelId -> { adapter, sig }

function signatureOf(ch) {
  return JSON.stringify([ch.enabled, ch.config]);
}

function hooksFor(ch) {
  return {
    onMessage: (externalId, text, meta) => handleInbound(ch, externalId, text, meta),
    persistCursor: (cursor) => {
      try {
        setCursor(ch.id, cursor);
      } catch {}
    },
    log: (msg) => console.log(msg),
  };
}

/** 导出便于测试：渠道行（含 DB 持久化的 cursor）→ 长轮询适配器 */
export function createAdapter(ch) {
  // cursor 单独存列，重启后恢复游标位置，避免从空 buf 重放/丢消息
  const configWithCursor = { ...ch.config, cursor: ch.cursor ?? null };
  if (ch.type === "telegram") return createTelegramAdapter(configWithCursor, hooksFor(ch));
  if (ch.type === "wechat") return createWechatPersonalAdapter(configWithCursor, hooksFor(ch));
  return null;
}

/** 让后台轮询进程与数据库中的渠道配置保持一致（幂等，可反复调用） */
export function syncChannels() {
  let channels = [];
  try {
    channels = listChannels();
  } catch {
    return; // 迁移尚未就绪（极端时序），下次调用再同步
  }
  const wanted = new Map(
    channels.filter((c) => c.enabled && c.config.token).map((c) => [c.id, c])
  );

  for (const [id, entry] of [...running]) {
    const target = wanted.get(id);
    if (!target || signatureOf(target) !== entry.sig) {
      entry.adapter.stop();
      running.delete(id);
      console.log(`[im] poller stopped: ${id}`);
    }
  }
  for (const [id, ch] of wanted) {
    if (running.has(id)) continue;
    const adapter = createAdapter(ch);
    if (!adapter) continue;
    adapter.start();
    running.set(id, { adapter, sig: signatureOf(ch) });
    console.log(`[im] ${ch.type} poller started: ${ch.name} (${id})`);
  }
}

export function stopAll() {
  for (const [, entry] of running) entry.adapter.stop();
  running.clear();
}
