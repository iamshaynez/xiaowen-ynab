// 个人微信号接入（与 Tencent openclaw-weixin 相同的 ilink bot 协议）：
//  - 扫码登录：POST ilink/bot/get_bot_qrcode 取二维码，GET ilink/bot/get_qrcode_status
//    长轮询状态机（wait/scanned/need_verifycode/expired/redirect/confirmed…）换取 bot_token；
//  - 收发消息：POST ilink/bot/getupdates 长轮询（get_updates_buf 游标），
//    POST ilink/bot/sendmessage 回复（必须回传入站消息携带的 context_token）。
// 仅支持文字消息；媒体收发暂不支持。

import crypto from "node:crypto";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_BASE_URL = DEFAULT_BASE_URL;
const ILINK_APP_ID = "bot";
const CLIENT_VERSION = buildClientVersion("1.0.0");
const BOT_AGENT = "xiaowen-budget/1.0.0";
const BOT_TYPE = "3";

const LONG_POLL_TIMEOUT_MS = 35000;
const API_TIMEOUT_MS = 15000;
const WX_TEXT_LIMIT = 2000;

const LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH = 3;
const LOGIN_POLL_INTERVAL_MS = 1000;

function buildClientVersion(version) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map((p) => parseInt(p, 10));
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function baseInfo() {
  return { channel_version: "1.0.0", bot_agent: BOT_AGENT };
}

function randomWechatUin() {
  return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64");
}

/* ------------------------- 协议客户端 ------------------------- */

export function createIlinkClient({ baseUrl = DEFAULT_BASE_URL, token }) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  function headers() {
    const h = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
      "iLink-App-Id": ILINK_APP_ID,
      "iLink-App-ClientVersion": String(CLIENT_VERSION),
    };
    if (token?.trim()) h.Authorization = `Bearer ${token.trim()}`;
    return h;
  }

  async function post(endpoint, body, timeoutMs = API_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`ilink ${endpoint} ${res.status}: ${raw.slice(0, 200)}`);
      return JSON.parse(raw);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getUpdates(getUpdatesBuf = "") {
    try {
      return await post(
        "ilink/bot/getupdates",
        { get_updates_buf: getUpdatesBuf, base_info: baseInfo() },
        LONG_POLL_TIMEOUT_MS
      );
    } catch (e) {
      // 长轮询超时属正常控制流，返回空结果即可
      if (e instanceof Error && e.name === "AbortError") {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      throw e;
    }
  }

  async function sendText(toUserId, text, contextToken) {
    const content = text.length > WX_TEXT_LIMIT ? text.slice(0, WX_TEXT_LIMIT) + "\n…（内容过长已截断）" : text;
    // iLink 协议要求完整 BOT 消息信封：缺 client_id / message_type / message_state 时
    // 服务端返回 200 但不投递（典型症状：第一条能收到，后续全部静默丢失）
    const resp = await post("ilink/bot/sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: crypto.randomUUID(),
        message_type: 2, // BOT
        message_state: 2, // FINISH
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text: content } }],
      },
      base_info: baseInfo(),
    });
    if (resp.ret && resp.ret !== 0) {
      throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
    }
  }

  return { getUpdates, sendText };
}

/* ------------------------- 入站消息解析 ------------------------- */

function bodyFromItemList(itemList) {
  if (!Array.isArray(itemList)) return "";
  for (const item of itemList) {
    if (item?.type === 1 && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      const parts = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    // 语音消息自带转写文本时直接采用
    if (item?.type === 3 && item.voice_item?.text) return String(item.voice_item.text);
  }
  return "";
}

/** 仅处理 USER 消息（message_type=1）；BOT 自己发出的消息返回空串 */
export function extractInboundText(msg) {
  if (!msg || msg.message_type !== 1) return "";
  return bodyFromItemList(msg.item_list);
}

/* ------------------------- 扫码登录状态机 ------------------------- */

const loginSessions = new Map(); // channelId -> session

async function fetchQrCode(localTokenList) {
  const res = await fetch(`${QR_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "iLink-App-Id": ILINK_APP_ID },
    body: JSON.stringify({ local_token_list: localTokenList }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`get_bot_qrcode ${res.status}: ${raw.slice(0, 200)}`);
  return JSON.parse(raw); // { qrcode, qrcode_img_content }
}

async function pollQrStatus(baseUrl, qrcode, verifyCode) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LONG_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/${endpoint}`, { signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) return { status: "wait" }; // 网关超时等场景视为继续等待
    return JSON.parse(raw);
  } catch {
    return { status: "wait" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发起扫码登录：先取得二维码再返回（保证 qrcodeUrl 可用），随后后台循环推进状态机，
 * 凭据就绪时回调一次 onSave。同一渠道重复调用会终止上一次登录。
 */
export async function startWechatLogin({ channelId, localTokenList = [], onSave, pollIntervalMs = LOGIN_POLL_INTERVAL_MS }) {
  stopWechatLogin(channelId);

  const state = {
    channelId,
    status: "qr_ready",
    message: "请用手机微信扫描二维码",
    qrcodeUrl: "",
    pollBaseUrl: QR_BASE_URL,
    qrRefreshCount: 1,
    startedAt: Date.now(),
    error: null,
  };

  const session = {
    channelId,
    state,
    stopped: false,
    wakeTimer: null,
    pendingVerifyCode: null,
    qrcode: "",
  };
  loginSessions.set(channelId, session);

  const sleep = (ms) =>
    new Promise((resolve) => {
      session.wakeTimer = setTimeout(resolve, ms);
    });

  try {
    const qr = await fetchQrCode(localTokenList);
    session.qrcode = qr.qrcode;
    state.qrcodeUrl = qr.qrcode_img_content;
  } catch (e) {
    state.status = "failed";
    state.error = String(e.message || e);
    return state;
  }

  void (async () => {
    while (!session.stopped && Date.now() - state.startedAt < LOGIN_TTL_MS) {
      const resp = await pollQrStatus(state.pollBaseUrl, session.qrcode, session.pendingVerifyCode);

      switch (resp.status) {
        case "scaned": {
          // 配对码验证通过后服务端回到 scaned
          session.pendingVerifyCode = null;
          if (state.status !== "scanned") {
            state.status = "scanned";
            state.message = "已扫描，正在验证";
          }
          break;
        }
        case "need_verifycode": {
          if (!session.pendingVerifyCode) {
            state.status = "need_verifycode";
            state.message = "请输入手机微信上显示的数字";
            // 等待用户提交配对码，避免空转打爆接口
            await sleep(400);
            continue;
          }
          break;
        }
        case "expired":
        case "verify_code_blocked": {
          session.pendingVerifyCode = null;
          state.qrRefreshCount += 1;
          if (state.qrRefreshCount > MAX_QR_REFRESH) {
            state.status = "failed";
            state.error = resp.status === "expired" ? "二维码多次失效" : "配对码多次错误";
            return;
          }
          try {
            const qr = await fetchQrCode(localTokenList);
            session.qrcode = qr.qrcode;
            state.qrcodeUrl = qr.qrcode_img_content;
            state.status = "qr_ready";
            state.message = "二维码已刷新，请重新扫描";
          } catch (e) {
            state.status = "failed";
            state.error = String(e.message || e);
            return;
          }
          break;
        }
        case "scaned_but_redirect": {
          if (resp.redirect_host) state.pollBaseUrl = `https://${resp.redirect_host}`;
          break;
        }
        case "binded_redirect": {
          state.status = "already_connected";
          state.message = "该微信已连接过，无需重复登录";
          return;
        }
        case "confirmed": {
          if (!resp.ilink_bot_id) {
            state.status = "failed";
            state.error = "登录失败：服务器未返回 bot id";
            return;
          }
          state.status = "confirmed";
          state.message = "已连接到微信";
          try {
            onSave?.({
              token: resp.bot_token,
              baseUrl: resp.baseurl || DEFAULT_BASE_URL,
              userId: resp.ilink_user_id,
              botId: resp.ilink_bot_id,
            });
          } catch {}
          return;
        }
        default:
          break; // wait 等
      }

      await sleep(pollIntervalMs);
    }

    if (!session.stopped && state.status !== "confirmed") {
      state.status = "timeout";
      state.message = "登录超时，请重试";
    }
  })();

  return state;
}
export function getWechatLoginState(channelId) {
  return loginSessions.get(channelId)?.state ?? null;
}

export function submitWechatVerifyCode(channelId, code) {
  const session = loginSessions.get(channelId);
  if (!session) return false;
  session.pendingVerifyCode = String(code ?? "").trim();
  return true;
}

export function stopWechatLogin(channelId) {
  const session = loginSessions.get(channelId);
  if (!session) return;
  session.stopped = true;
  if (session.wakeTimer) clearTimeout(session.wakeTimer);
  loginSessions.delete(channelId);
}

/* ------------------------- 长轮询适配器 ------------------------- */

export function createWechatPersonalAdapter({ token, baseUrl, cursor = null }, hooks) {
  const client = createIlinkClient({ baseUrl: baseUrl || DEFAULT_BASE_URL, token });
  let running = false;
  let stoppedReason = null;
  let syncBuf = typeof cursor === "string" ? cursor : "";
  let wakeTimer = null;
  const seenIds = new Set();

  function seen(msgId) {
    if (msgId == null) return false;
    if (seenIds.has(msgId)) return true;
    seenIds.add(msgId);
    if (seenIds.size > 1000) for (const k of [...seenIds].slice(0, 500)) seenIds.delete(k);
    return false;
  }

  async function handleOne(msg) {
    const userId = msg.from_user_id;
    if (!userId || seen(msg.message_id)) return;
    if (msg.message_type !== 1) return; // 只处理 USER 消息
    const text = extractInboundText(msg);
    if (!text) {
      // USER 消息但不含文字（图片/语音等）→ 提示仅支持文字
      if (msg.item_list?.length) {
        await client
          .sendText(userId, "目前只支持文字消息，请直接输入想问的内容～", msg.context_token)
          .catch((e) => hooks.log?.(`[wechat] sendText failed: ${e.message}`));
      }
      return;
    }
    try {
      const reply = await hooks.onMessage(userId, text, { contextToken: msg.context_token });
      if (reply) {
        await client.sendText(userId, reply, msg.context_token);
      }
    } catch (e) {
      hooks.log?.(`[wechat] handle message failed: ${e.message}`);
      client.sendText(userId, "出错了，请稍后重试。", msg.context_token).catch(() => {});
    }
  }

  /** 单次拉取并处理所有待处理更新；独立导出便于测试 */
  async function pollOnce() {
    const resp = await client.getUpdates(syncBuf);
    if (resp.ret && resp.ret !== 0) {
      // errcode -14 = 会话过期（token 失效），唯一出路是重新扫码；
      // 停止轮询并显式通知，避免静默空转让人误以为"已连接"
      if (resp.errcode === -14 || resp.ret === -14 || /session/i.test(String(resp.errmsg || ""))) {
        const err = new Error(`微信会话已过期（ret=${resp.ret} ${resp.errmsg || ""}），请在设置中重新扫码登录`);
        running = false;
        stoppedReason = "session_expired";
        hooks.onSessionExpired?.(err);
        hooks.log?.(`[wechat] ${err.message}`);
        return;
      }
      throw new Error(`getupdates ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
    }
    if (typeof resp.get_updates_buf === "string" && resp.get_updates_buf) {
      syncBuf = resp.get_updates_buf;
      hooks.persistCursor?.(syncBuf);
    }
    for (const msg of resp.msgs || []) {
      await handleOne(msg);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      wakeTimer = setTimeout(resolve, ms);
    });
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
        hooks.log?.(`[wechat] poll error: ${e.message}`);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stoppedReason = null;
      loop();
    },
    stop() {
      running = false;
      stoppedReason = "manual_stop";
      if (wakeTimer) clearTimeout(wakeTimer);
    },
    get running() {
      return running;
    },
    get stoppedReason() {
      return stoppedReason;
    },
    pollOnce,
    async test() {
      // 用一次空 getUpdates 验证 token/网络可用性（立即短超时）
      const resp = await client.getUpdates(syncBuf);
      if (resp.ret && resp.ret !== 0) throw new Error(resp.errmsg || `ret=${resp.ret}`);
      return { ok: true };
    },
  };
}
