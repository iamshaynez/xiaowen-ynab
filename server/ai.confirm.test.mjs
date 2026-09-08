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

const { createSession, appendUserMessage, confirmPending, runAgent } = await import("./ai.mjs");

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

// 种入 tool_calls 内容可自定义的 pending 行（模拟损坏/旧数据）
function seedRawPending(sessionId, sql, toolCallsJson) {
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)"
  ).run(uid(), sessionId, "assistant", "", toolCallsJson, null, sql, "测试写入", 0, new Date().toISOString());
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

  it("思考模型的 reasoning_content 会被持久化，供续跑回传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "好的，为你创建一个房贷账户。",
                reasoning_content: "房贷是贷款类负债，应设为预算外账户。",
                tool_calls: [
                  {
                    id: "call-r",
                    type: "function",
                    function: {
                      name: "run_sql",
                      arguments: JSON.stringify({ sql: "INSERT INTO accounts(id,name,type,on_budget) VALUES('acc-x','房贷','personalLoan',0)" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }))
    );

    const s = createSession("c5");
    appendUserMessage(s.id, "帮我创建一个房贷的账户");

    const res = await runAgent(s.id);
    expect(res.status).toBe("awaiting_confirmation");

    const rows = db
      .prepare("SELECT reasoning_content FROM chat_messages WHERE session_id=? AND role='assistant' ORDER BY rowid")
      .all(s.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.reasoning_content).toBe("房贷是贷款类负债，应设为预算外账户。");
  });
});

describe("confirmPending 数据流一致性", () => {
  it("tool_calls 为空数组 → 抛显式错误，不产生半状态（不标 resolved、不写 tool 消息、不执行 SQL）", async () => {
    const s = createSession("c6");
    appendUserMessage(s.id, "记一笔");
    seedRawPending(s.id, "INSERT INTO accounts(id,name,type) VALUES('acc-c6','坏数据','checking')", "[]");

    await expect(confirmPending(s.id, true)).rejects.toThrow();

    expect(lastPendingRow(s.id)).toBeTruthy(); // resolved 仍为 0，未被半标记
    expect(
      db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=? AND role='tool'").get(s.id).c
    ).toBe(0);
    expect(db.prepare("SELECT id FROM accounts WHERE id='acc-c6'").get()).toBeFalsy();
  });

  it("tool_calls 为非法 JSON → 抛显式错误，不产生半状态", async () => {
    const s = createSession("c6b");
    appendUserMessage(s.id, "记一笔");
    seedRawPending(s.id, "INSERT INTO accounts(id,name,type) VALUES('acc-c6b','坏数据','checking')", "not-json{{");

    await expect(confirmPending(s.id, true)).rejects.toThrow();

    expect(lastPendingRow(s.id)).toBeTruthy();
    expect(
      db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=? AND role='tool'").get(s.id).c
    ).toBe(0);
    expect(db.prepare("SELECT id FROM accounts WHERE id='acc-c6b'").get()).toBeFalsy();
  });
});

describe("runAgent 多写操作整批拒绝", () => {
  it("模型单次发起多个写操作 → 所有调用收到明确错误，不产生任何写入，模型可重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-w1",
                    type: "function",
                    function: {
                      name: "run_sql",
                      arguments: JSON.stringify({
                        sql: "INSERT INTO accounts(id,name,type) VALUES('acc-w1','甲','checking')",
                        purpose: "建甲",
                      }),
                    },
                  },
                  {
                    id: "call-w2",
                    type: "function",
                    function: {
                      name: "run_sql",
                      arguments: JSON.stringify({
                        sql: "INSERT INTO accounts(id,name,type) VALUES('acc-w2','乙','checking')",
                        purpose: "建乙",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "抱歉，我分轮执行。" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const s = createSession("c7");
    appendUserMessage(s.id, "帮我建两个账户");
    const res = await runAgent(s.id);

    expect(res.status).toBe("idle");
    // 没有任何写入落库
    expect(db.prepare("SELECT id FROM accounts WHERE id IN ('acc-w1','acc-w2')").all()).toHaveLength(0);
    // 两个调用都收到了明确的错误响应（拒绝静默丢弃）
    const tools = db
      .prepare("SELECT tool_call_id, content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid")
      .all(s.id);
    expect(tools.map((t) => t.tool_call_id)).toEqual(["call-w1", "call-w2"]);
    for (const t of tools) expect(t.content).toContain("one write");
    // assistant 消息同时携带两个调用，协议配对完整
    const assistants = db
      .prepare("SELECT tool_calls FROM chat_messages WHERE session_id=? AND role='assistant' AND tool_calls IS NOT NULL")
      .all(s.id);
    const allIds = assistants.flatMap((a) => JSON.parse(a.tool_calls).map((c) => c.id));
    expect(allIds).toEqual(expect.arrayContaining(["call-w1", "call-w2"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
