import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_BASE_URL,
  createIlinkClient,
  createWechatPersonalAdapter,
  extractInboundText,
  startWechatLogin,
  getWechatLoginState,
  submitWechatVerifyCode,
  stopWechatLogin,
} from "./wechat.mjs";

const QR_ENDPOINT = "ilink/bot/get_bot_qrcode";
const STATUS_ENDPOINT = "ilink/bot/get_qrcode_status";

function jsonResp(obj) {
  return { ok: true, json: async () => obj, text: async () => JSON.stringify(obj) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  stopWechatLogin("ch-wx");
});

describe("ilink 协议客户端", () => {
  it("getUpdates 携带 ilink 头与同步游标，解析 msgs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResp({ ret: 0, msgs: [{ message_id: 1 }], get_updates_buf: "BUF2", longpolling_timeout_ms: 35000 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createIlinkClient({ baseUrl: "https://gw.example.com", token: "TK" });
    const resp = await client.getUpdates("BUF1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gw.example.com/ilink/bot/getupdates");
    expect(init.headers["AuthorizationType"]).toBe("ilink_bot_token");
    expect(init.headers["Authorization"]).toBe("Bearer TK");
    expect(init.headers["iLink-App-Id"]).toBe("bot");
    // X-WECHAT-UIN: base64(随机 uint32 十进制字符串)
    const uin = Buffer.from(init.headers["X-WECHAT-UIN"], "base64").toString("utf-8");
    expect(uin).toMatch(/^\d+$/);
    const body = JSON.parse(init.body);
    expect(body.get_updates_buf).toBe("BUF1");
    expect(body.base_info.bot_agent).toContain("/");
    expect(resp.get_updates_buf).toBe("BUF2");
    expect(resp.msgs).toHaveLength(1);
  });

  it("sendText 通过 msg 包装发送文本并回传 context_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ ret: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createIlinkClient({ baseUrl: "https://gw.example.com/", token: "TK" });
    await client.sendText("user-1", "你好", "ctx-token");
    await client.sendText("user-1", "第二条", "ctx-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gw.example.com/ilink/bot/sendmessage");
    const body = JSON.parse(init.body);
    expect(body.msg.to_user_id).toBe("user-1");
    expect(body.msg.context_token).toBe("ctx-token");
    expect(body.msg.item_list[0].type).toBe(1);
    expect(body.msg.item_list[0].text_item.text).toBe("你好");
    // iLink 协议要求完整信封：BOT 消息必须声明类型/状态与唯一 client_id，
    // 否则服务端返回 200 但不投递（表现为「只有第一条能收到」）
    expect(body.msg.message_type).toBe(2);
    expect(body.msg.message_state).toBe(2);
    expect(String(body.msg.client_id)).toBeTruthy();

    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body2.msg.client_id).not.toBe(body.msg.client_id);
  });

  it("sendMessage 返回非 0 ret 时抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResp({ ret: -14, errmsg: "session timeout" })));
    const client = createIlinkClient({ baseUrl: DEFAULT_BASE_URL, token: "TK" });
    await expect(client.sendText("u", "hi", "c")).rejects.toThrow(/-14/);
  });

  it("extractInboundText 提取文本项；引用消息拼接上下文；非 USER 消息返回空", () => {
    const text = { type: 1, text_item: { text: "查余额" } };
    expect(extractInboundText({ message_type: 1, item_list: [text] })).toBe("查余额");

    const quoted = {
      type: 1,
      text_item: { text: "再看看" },
      ref_msg: { title: "昨天", message_item: { type: 1, text_item: { text: "花了多少" } } },
    };
    expect(extractInboundText({ message_type: 1, item_list: [quoted] })).toBe("[引用: 昨天 | 花了多少]\n再看看");

    expect(extractInboundText({ message_type: 2, item_list: [text] })).toBe("");
    expect(extractInboundText({ message_type: 1, item_list: [] })).toBe("");
  });
});

describe("个人微信适配器（长轮询）", () => {
  function jsonMsg(id, overrides = {}) {
    return {
      message_id: id,
      message_type: 1,
      from_user_id: "u1",
      context_token: `ct-${id}`,
      item_list: [{ type: 1, text_item: { text: `m${id}` } }],
      ...overrides,
    };
  }

  function makeAdapter(overrides = {}) {
    const calls = { onMessage: [], bufs: [], sessionExpired: [] };
    const adapter = createWechatPersonalAdapter(
      { token: "TK", baseUrl: "https://gw.example.com", ...overrides },
      {
        onMessage: async (userId, text, meta) => {
          calls.onMessage.push([userId, text, meta]);
          return `echo:${text}`;
        },
        persistCursor: (c) => calls.bufs.push(c),
        onSessionExpired: (e) => calls.sessionExpired.push(String(e?.message || e)),
        log: () => {},
      }
    );
    return { adapter, calls };
  }

  it("pollOnce：取消息→过滤 BOT/重复→路由→sendmessage 回复→推进游标", async () => {
    let polls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("getupdates")) {
        polls++;
        if (polls === 1) {
          return jsonResp({
            ret: 0,
            get_updates_buf: "B2",
            msgs: [jsonMsg(11), jsonMsg(12, { message_type: 2 }), jsonMsg(11)],
          });
        }
        return jsonResp({ ret: 0, get_updates_buf: "B3", msgs: [] });
      }
      if (u.includes("sendmessage")) return jsonResp({ ret: 0 });
      throw new Error("unexpected " + u);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { adapter, calls } = makeAdapter();
    await adapter.pollOnce();

    // BOT 消息与重复 message_id 均被忽略
    expect(calls.onMessage).toEqual([["u1", "m11", { contextToken: "ct-11" }]]);
    expect(calls.bufs.at(-1)).toBe("B2");

    await adapter.pollOnce();
    // 第二次请求携带上一次响应的游标 B2，其响应返回新游标 B3
    const secondPoll = fetchMock.mock.calls.filter(([u]) => String(u).includes("getupdates"))[1];
    expect(JSON.parse(secondPoll[1].body).get_updates_buf).toBe("B2");

    const sent = fetchMock.mock.calls.filter(([u]) => String(u).includes("sendmessage"));
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0][1].body);
    expect(body.msg.context_token).toBe("ct-11");
    expect(body.msg.item_list[0].text_item.text).toBe("echo:m11");
  });

  it("非文本消息提示仅支持文字，不调用路由", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("getupdates")) {
        return jsonResp({
          ret: 0,
          get_updates_buf: "BX",
          msgs: [{ message_id: 21, message_type: 1, from_user_id: "u9", context_token: "c9", item_list: [{ type: 2 }] }],
        });
      }
      if (u.includes("sendmessage")) return jsonResp({ ret: 0 });
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { adapter, calls } = makeAdapter();
    await adapter.pollOnce();
    expect(calls.onMessage).toHaveLength(0);
    const sent = fetchMock.mock.calls.filter(([u]) => String(u).includes("sendmessage"));
    expect(JSON.parse(sent[0][1].body).msg.item_list[0].text_item.text).toContain("文字");
  });

  it("重启恢复：构造时传入持久化游标，首次 getupdates 携带该游标", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ ret: 0, msgs: [], get_updates_buf: "NEXT" }));
    vi.stubGlobal("fetch", fetchMock);

    const { adapter } = makeAdapter({ cursor: "SAVED-BUF" });
    await adapter.pollOnce();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.get_updates_buf).toBe("SAVED-BUF");
  });

  it("getupdates 返回 errcode -14（会话过期）→ 通知并停止轮询，等待重新扫码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResp({ ret: -14, errcode: -14, errmsg: "session timeout" }))
    );

    const { adapter, calls } = makeAdapter();
    await adapter.pollOnce();

    expect(calls.sessionExpired).toHaveLength(1);
    expect(adapter.stoppedReason).toBe("session_expired");
  });

  it("getupdates 返回其他非零 ret → 抛错交给循环退避重试，不停止轮询", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResp({ ret: -2, errmsg: "" }))
    );

    const { adapter } = makeAdapter();
    await expect(adapter.pollOnce()).rejects.toThrow(/ret=-2/);
    expect(adapter.stoppedReason).toBeNull();
  });
});

describe("扫码登录状态机", () => {
  it("完整流程：取码 → wait → scanned → need_verifycode → 提交配对码 → confirmed 保存凭据", async () => {
    let statusCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes(QR_ENDPOINT)) {
        return jsonResp({ qrcode: "QRC", qrcode_img_content: "https://login.weixin.qq.com/qr/QRC" });
      }
      if (u.includes(STATUS_ENDPOINT)) {
        statusCalls++;
        if (statusCalls === 1) return jsonResp({ status: "wait" });
        if (statusCalls === 2) return jsonResp({ status: "scaned" });
        if (statusCalls === 3) return jsonResp({ status: "need_verifycode" });
        return jsonResp({
          status: "confirmed",
          bot_token: "BOT-TOKEN",
          ilink_bot_id: "bot-123",
          baseurl: "https://other-gw.weixin.qq.com",
          ilink_user_id: "wx-user-9",
        });
      }
      throw new Error("unexpected " + u);
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = [];
    const session = startWechatLogin({ channelId: "ch-wx", localTokenList: ["old-tk"], onSave: (creds) => saved.push(creds), pollIntervalMs: 5 });

    // 等状态机推进到 need_verifycode
    for (let i = 0; i < 40 && getWechatLoginState("ch-wx").status !== "need_verifycode"; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(getWechatLoginState("ch-wx").status).toBe("need_verifycode");
    expect(getWechatLoginState("ch-wx").qrcodeUrl).toBe("https://login.weixin.qq.com/qr/QRC");

    submitWechatVerifyCode("ch-wx", "8877");

    for (let i = 0; i < 60 && !["confirmed", "failed"].includes(getWechatLoginState("ch-wx").status); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const st = getWechatLoginState("ch-wx");
    expect(st.status).toBe("confirmed");

    // 凭据通过回调交给路由层落库
    expect(saved).toEqual([
      { token: "BOT-TOKEN", baseUrl: "https://other-gw.weixin.qq.com", userId: "wx-user-9", botId: "bot-123" },
    ]);

    // 取二维码时携带了本地已有 token 列表
    const qrCall = fetchMock.mock.calls.find(([u]) => String(u).includes(QR_ENDPOINT));
    expect(JSON.parse(qrCall[1].body).local_token_list).toEqual(["old-tk"]);
    // 配对码通过 query 传给状态轮询
    const verifyCall = fetchMock.mock.calls.find(
      ([u]) => String(u).includes(STATUS_ENDPOINT) && String(u).includes("verify_code=8877")
    );
    expect(verifyCall).toBeTruthy();
    void session;
  });

  it("expired 时自动刷新二维码（最多 3 次）", async () => {
    let expiredCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes(QR_ENDPOINT)) return jsonResp({ qrcode: `QRC-${Date.now()}`, qrcode_img_content: "https://x/q" });
        if (u.includes(STATUS_ENDPOINT)) {
          expiredCount++;
          return jsonResp({ status: expiredCount <= 2 ? "expired" : "wait" });
        }
        throw new Error("unexpected");
      })
    );
    startWechatLogin({ channelId: "ch-wx", localTokenList: [], onSave: () => {}, pollIntervalMs: 5 });
    for (let i = 0; i < 80 && getWechatLoginState("ch-wx").qrRefreshCount < 3; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(getWechatLoginState("ch-wx").qrRefreshCount).toBeGreaterThanOrEqual(3);
    expect(["wait", "scanned", "qr_ready"].includes(getWechatLoginState("ch-wx").status)).toBe(true);
  });

  it("scaned_but_redirect 切换轮询主机", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes(QR_ENDPOINT)) return jsonResp({ qrcode: "Q", qrcode_img_content: "https://x/q" });
        if (u.includes(STATUS_ENDPOINT)) {
          calls++;
          if (calls === 1) return jsonResp({ status: "scaned_but_redirect", redirect_host: "gz.ilinkai.weixin.qq.com" });
          return jsonResp({ status: "wait" });
        }
        throw new Error("unexpected");
      })
    );
    startWechatLogin({ channelId: "ch-wx", localTokenList: [], onSave: () => {}, pollIntervalMs: 5 });
    for (let i = 0; i < 60; i++) {
      const st = getWechatLoginState("ch-wx");
      if (st.pollBaseUrl === "https://gz.ilinkai.weixin.qq.com") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(getWechatLoginState("ch-wx").pollBaseUrl).toBe("https://gz.ilinkai.weixin.qq.com");
  });

  it("binded_redirect 视为已连接过", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes(QR_ENDPOINT)) return jsonResp({ qrcode: "Q", qrcode_img_content: "https://x/q" });
        if (u.includes(STATUS_ENDPOINT)) return jsonResp({ status: "binded_redirect" });
        throw new Error("unexpected");
      })
    );
    startWechatLogin({ channelId: "ch-wx", localTokenList: [], onSave: () => {}, pollIntervalMs: 5 });
    for (let i = 0; i < 60 && getWechatLoginState("ch-wx").status !== "already_connected"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(getWechatLoginState("ch-wx").status).toBe("already_connected");
  });
});
