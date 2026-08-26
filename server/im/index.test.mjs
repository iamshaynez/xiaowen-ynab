// 隔离环境：必须在导入 db 相关模块之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-im-index-test-"));

const { createAdapter } = await import("./index.mjs");

function jsonResp(obj) {
  return { ok: true, json: async () => obj, text: async () => JSON.stringify(obj) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAdapter：渠道行 → 适配器配置接线", () => {
  it("wechat 渠道重启后携带 DB 持久化的 get_updates_buf 游标", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ ret: 0, msgs: [], get_updates_buf: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const ch = { id: "c1", type: "wechat", enabled: true, config: { token: "TK" }, cursor: "SAVED-WX" };
    const adapter = createAdapter(ch);
    await adapter.pollOnce();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.get_updates_buf).toBe("SAVED-WX");
  });

  it("telegram 渠道同理恢复 offset 游标", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ ok: true, result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const ch = { id: "c2", type: "telegram", enabled: true, config: { token: "TG" }, cursor: "7" };
    const adapter = createAdapter(ch);
    await adapter.pollOnce();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.offset).toBe(7);
  });
});
