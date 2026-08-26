// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-confirm-test-"));

const { db, setSetting, uid } = await import("./db.mjs");

// 配置假 AI，使确认后的 agent 续跑不抛 AI_NOT_CONFIGURED
setSetting("ai_key", "test-key");
setSetting("ai_base_url", "http://mock.local/v1");
setSetting("ai_model", "test-model");

const { createSession, appendUserMessage, confirmPending } = await import("./ai.mjs");

function seedPending(sessionId, sql) {
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)"
  ).run(
    uid(),
    sessionId,
    "assistant",
    "",
    JSON.stringify([{ id: `call-${Math.random().toString(36).slice(2, 8)}`, name: "run_sql", arguments: JSON.stringify({ sql }) }]),
    null,
    sql,
    "测试写入",
    0,
    new Date().toISOString()
  );
}

function lastPendingRow(sessionId) {
  return db
    .prepare("SELECT * FROM chat_messages WHERE session_id=? AND resolved=0 AND pending_sql IS NOT NULL ORDER BY rowid DESC LIMIT 1")
    .get(sessionId);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confirmPending 返回 changed 标记", () => {
  it("批准且写入成功 → changed=true，数据落库，LLM 续跑汇报结果", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "已完成" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const s = createSession("c1");
    appendUserMessage(s.id, "新建信用卡账户");
    seedPending(s.id, "INSERT INTO accounts(id,name,type) VALUES('acc-c1','中信银行信用卡','creditCard')");
    expect(lastPendingRow(s.id)).toBeTruthy();

    const res = await confirmPending(s.id, true);

    expect(res.changed).toBe(true);
    expect(db.prepare("SELECT name FROM accounts WHERE id='acc-c1'").get()?.name).toBe("中信银行信用卡");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("拒绝 → changed=false，不产生任何写入也不调用 LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const s = createSession("c2");
    appendUserMessage(s.id, "帮我删掉点什么");
    seedPending(s.id, "DELETE FROM accounts WHERE id='acc-c1'");
    expect(lastPendingRow(s.id)).toBeTruthy();

    const res = await confirmPending(s.id, false);

    expect(res.changed).toBe(false);
    expect(db.prepare("SELECT id FROM accounts WHERE id='acc-c1'").get()).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("批准但 SQL 执行失败 → changed=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "嗯" } }] }) }))
    );

    const s = createSession("c3");
    appendUserMessage(s.id, "记一笔");
    seedPending(s.id, "INSERT INTO transactions(id,account_id,date,amount) VALUES('tx-bad','no-such-account','2026-08-26',100)");

    const res = await confirmPending(s.id, true);

    expect(res.changed).toBe(false);
    expect(db.prepare("SELECT id FROM transactions WHERE id='tx-bad'").get()).toBeFalsy();
  });

  it("没有待确认项 → changed=false", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const s = createSession("c4");
    const res = await confirmPending(s.id, true);
    expect(res.changed).toBe(false);
  });
});
