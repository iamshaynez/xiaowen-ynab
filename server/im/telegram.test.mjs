// 隔离环境：必须在导入 db/store 之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-tg-test-"));

const { setSetting } = await import("../db.mjs");
setSetting("ai_key", "k");
setSetting("ai_base_url", "http://mock.local/v1");

const { createTelegramAdapter } = await import("./telegram.mjs");

function okJson(result) {
  return { ok: true, json: async () => ({ ok: true, result }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeAdapter(overrides = {}) {
  const calls = { onMessage: [], cursors: [] };
  const adapter = createTelegramAdapter(
    { token: "TOK", allowedChatIds: ["42"], cursor: null, ...overrides },
    {
      onMessage: async (externalId, text) => {
        calls.onMessage.push([externalId, text]);
        return `echo:${text}`;
      },
      persistCursor: (c) => calls.cursors.push(c),
      log: () => {},
    }
  );
  return { adapter, calls };
}

describe("telegram adapter", () => {
  it("pollOnce：取更新→过滤白名单→路由消息→sendMessage 回复→推进 offset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson([{ update_id: 101, message: { chat: { id: 42 }, text: "你好" } }]))
      .mockResolvedValue(okJson([]));
    vi.stubGlobal("fetch", fetchMock);

    const { adapter, calls } = makeAdapter();
    await adapter.pollOnce();

    expect(calls.onMessage).toEqual([["42", "你好"]]);
    const sent = fetchMock.mock.calls.find(([u]) => String(u).includes("/sendMessage"));
    expect(sent).toBeTruthy();
    const body = JSON.parse(sent[1].body);
    expect(body.chat_id).toBe("42");
    expect(body.text).toContain("echo:你好");
    expect(calls.cursors.at(-1)).toBe("102");

    await adapter.pollOnce();
    const secondPoll = fetchMock.mock.calls.filter(([u]) => String(u).includes("/getUpdates"))[1];
    expect(JSON.parse(secondPoll[1].body).offset).toBe(102);
  });

  it("不在白名单的 chat 直接忽略，不发消息不回复", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([{ update_id: 5, message: { chat: { id: 43 }, text: "偷看" } }]));
    vi.stubGlobal("fetch", fetchMock);
    const { adapter, calls } = makeAdapter();
    await adapter.pollOnce();
    expect(calls.onMessage).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/sendMessage"))).toBe(false);
    // offset 仍然要推进，避免反复拉到同一条
    expect(calls.cursors.at(-1)).toBe("6");
  });

  it("test() 调用 getMe 返回机器人用户名", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: 1, username: "my_budget_bot" }));
    vi.stubGlobal("fetch", fetchMock);
    const { adapter } = makeAdapter();
    const r = await adapter.test();
    expect(r.ok).toBe(true);
    expect(r.username).toBe("my_budget_bot");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/getMe");
  });

  it("API 返回 ok:false 时抛出带 description 的错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, description: "Unauthorized" }) }));
    const { adapter } = makeAdapter();
    await expect(adapter.test()).rejects.toThrow("Unauthorized");
  });
});
