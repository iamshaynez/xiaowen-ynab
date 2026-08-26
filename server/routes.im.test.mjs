// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-im-routes-test-"));
process.env.IM_LOGIN_POLL_MS = "5";

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db } = await import("./db.mjs");
const { stopAll } = await import("./im/index.mjs");

const app = express();
app.use(express.json());
app.use("/api", api);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
// 测试自身的 HTTP 请求必须走真实 fetch；vi.stubGlobal 只应影响应用内部的外呼
const httpFetch = globalThis.fetch;
afterAll(async () => {
  stopAll();
  server.close();
});

const call = async (method, url, body) => {
  const res = await httpFetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
};

describe("/api/im/channels CRUD", () => {
  it("非法类型返回 400", async () => {
    const r = await call("POST", "/api/im/channels", { type: "whatsapp", name: "x", config: {} });
    expect(r.status).toBe(400);
  });

  it("启用但缺少凭据返回 400；未启用可先建渠道再扫码", async () => {
    const r = await call("POST", "/api/im/channels", { type: "telegram", name: "tg", enabled: true, config: {} });
    expect(r.status).toBe(400);

    const w = await call("POST", "/api/im/channels", { type: "wechat", name: "个人微信", enabled: false, config: {} });
    expect(w.status).toBe(200);
    expect(w.json.channel.enabled).toBe(false);

    const en = await call("PUT", `/api/im/channels/${w.json.channel.id}`, { enabled: true });
    expect(en.status).toBe(400); // 尚未扫码，无 token 不能启用
  });

  it("创建后可查询，config 被规范化", async () => {
    const r = await call("POST", "/api/im/channels", {
      type: "telegram",
      name: "我的 TG",
      enabled: false,
      config: { token: " tk ", allowedChatIds: "42, 43" },
    });
    expect(r.status).toBe(200);
    expect(r.json.channel.config.token).toBe("tk");
    expect(r.json.channel.config.allowedChatIds).toEqual(["42", "43"]);
    const list = await call("GET", "/api/im/channels");
    expect(list.json.channels.some((c) => c.id === r.json.channel.id)).toBe(true);
  });

  it("PUT 更新名称/启用状态/部分合并 config，DELETE 移除", async () => {
    const created = await call("POST", "/api/im/channels", {
      type: "telegram",
      name: "tg2",
      config: { token: "abc" },
    });
    const id = created.json.channel.id;
    // 启用前先 stub 掉轮询网络请求，避免真实外呼
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "" }),
        json: async () => ({ ret: 0, msgs: [], get_updates_buf: "" }),
      })
    );
    const upd = await call("PUT", `/api/im/channels/${id}`, { enabled: true, config: { allowedChatIds: ["7"] } });
    expect(upd.status).toBe(200);
    expect(upd.json.channel.enabled).toBe(true);
    expect(upd.json.channel.config.token).toBe("abc");
    expect(upd.json.channel.config.allowedChatIds).toEqual(["7"]);

    const del = await call("DELETE", `/api/im/channels/${id}`);
    expect(del.status).toBe(200);
    const list = await call("GET", "/api/im/channels");
    expect(list.json.channels.some((c) => c.id === id)).toBe(false);
  });
});

describe("渠道测试连接", () => {
  it("telegram：getMe 成功", async () => {
    const created = await call("POST", "/api/im/channels", { type: "telegram", config: { token: "tk" } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { username: "bot" } }) })
    );
    const r = await call("POST", `/api/im/channels/${created.json.channel.id}/test`);
    expect(r.status).toBe(200);
    expect(r.json.username).toBe("bot");
  });

  it("wechat：getUpdates 会话可用", async () => {
    const created = await call("POST", "/api/im/channels", {
      type: "wechat",
      config: { token: "wxtoken", baseUrl: "https://gw.example.com" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "" }),
      })
    );
    const r = await call("POST", `/api/im/channels/${created.json.channel.id}/test`);
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it("失败时返回 400 与错误信息", async () => {
    const created = await call("POST", "/api/im/channels", { type: "telegram", config: { token: "bad" } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, description: "Unauthorized" }) })
    );
    const r = await call("POST", `/api/im/channels/${created.json.channel.id}/test`);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("Unauthorized");
  });
});

describe("个人微信扫码登录", () => {
  let wxId;

  const stubQrFlow = (statusSequence) => {
    let statusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("get_bot_qrcode")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ qrcode: "QRC", qrcode_img_content: "https://login.weixin.qq.com/qr/QRC" }),
          };
        }
        if (u.includes("get_qrcode_status")) {
          const step = statusSequence[Math.min(statusCalls, statusSequence.length - 1)];
          statusCalls++;
          return { ok: true, status: 200, text: async () => JSON.stringify(step) };
        }
        // 其余（getupdates/sendmessage 等轮询）静默成功
        return { ok: true, status: 200, text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "" }) };
      })
    );
  };

  it("完整流程：取二维码 → confirmed 后凭据落库并自动启用", async () => {
    const created = await call("POST", "/api/im/channels", { type: "wechat", name: "个人微信" });
    wxId = created.json.channel.id;

    stubQrFlow([
      { status: "wait" },
      { status: "scaned" },
      {
        status: "confirmed",
        bot_token: "BOT-TOKEN",
        ilink_bot_id: "bot-77",
        baseurl: "https://gz.ilinkai.weixin.qq.com",
        ilink_user_id: "wx-user-9",
      },
    ]);

    const start = await call("POST", `/api/im/channels/${wxId}/wechat/login`);
    expect(start.status).toBe(200);
    expect(start.json.qrcodeUrl).toBe("https://login.weixin.qq.com/qr/QRC");

    for (let i = 0; i < 80; i++) {
      const st = await call("GET", `/api/im/channels/${wxId}/wechat/login`);
      if (st.json?.status === "confirmed") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const list = await call("GET", "/api/im/channels");
    const ch = list.json.channels.find((c) => c.id === wxId);
    expect(ch.enabled).toBe(true);
    expect(ch.config.token).toBe("BOT-TOKEN");
    expect(ch.config.baseUrl).toBe("https://gz.ilinkai.weixin.qq.com");
    expect(ch.config.userId).toBe("wx-user-9");
    expect(ch.config.botId).toBe("bot-77");
  });

  it("need_verifycode 时提交配对码继续流程", async () => {
    stubQrFlow([
      { status: "wait" },
      { status: "need_verifycode" },
      { status: "wait" },
      {
        status: "confirmed",
        bot_token: "T2",
        ilink_bot_id: "bot-2",
        ilink_user_id: "u-2",
      },
    ]);

    const other = await call("POST", "/api/im/channels", { type: "wechat", name: "第二个微信" });
    const id2 = other.json.channel.id;
    await call("POST", `/api/im/channels/${id2}/wechat/login`);

    let sawVerify = false;
    for (let i = 0; i < 100; i++) {
      const st = await call("GET", `/api/im/channels/${id2}/wechat/login`);
      if (st.json?.status === "need_verifycode") {
        sawVerify = true;
        const v = await call("POST", `/api/im/channels/${id2}/wechat/login/verify`, { code: "8877" });
        expect(v.status).toBe(200);
      }
      if (st.json?.status === "confirmed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(sawVerify).toBe(true);
    const list = await call("GET", "/api/im/channels");
    const ch = list.json.channels.find((c) => c.id === id2);
    expect(ch.config.token).toBe("T2");
  });

  it("取消登录后状态接口返回 400", async () => {
    stubQrFlow([{ status: "wait" }]);
    const other = await call("POST", "/api/im/channels", { type: "wechat", name: "第三个微信" });
    const id3 = other.json.channel.id;
    await call("POST", `/api/im/channels/${id3}/wechat/login`);
    const cancel = await call("DELETE", `/api/im/channels/${id3}/wechat/login`);
    expect(cancel.status).toBe(200);
    const st = await call("GET", `/api/im/channels/${id3}/wechat/login`);
    expect(st.status).toBe(400);
  });

  void db;
});
