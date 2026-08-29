// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-ai-hist-test-"));

const { db } = await import("./db.mjs");
const { createSession, buildLlmMessages, splitToolPlans } = await import("./ai.mjs");

let seq = 0;
function seedMsg(sessionId, fields) {
  seq += 1;
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,reasoning_content,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    `m${seq}`,
    sessionId,
    fields.role,
    fields.content ?? null,
    fields.toolCalls ? JSON.stringify(fields.toolCalls) : null,
    fields.toolCallId ?? null,
    fields.reasoningContent ?? null,
    fields.pendingSql ?? null,
    fields.pendingPurpose ?? null,
    fields.pendingIndex ?? null,
    fields.resolved === 0 ? 0 : 1,
    new Date(Date.UTC(2026, 7, 25, 0, 0, seq)).toISOString()
  );
}

const tc = (id, sql = "SELECT 1") => ({ id, name: "run_sql", arguments: JSON.stringify({ sql }) });

/**
 * 校验 OpenAI 协议约束：
 * 1. 每条带 tool_calls 的 assistant 消息后必须「紧跟」覆盖其全部 id 的 tool 消息；
 * 2. 不允许存在回指不到任何 assistant 调用的孤儿 tool 消息。
 */
function assertValidToolSequence(msgs) {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      const answers = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === "tool") {
        answers.push(msgs[j].tool_call_id);
        j++;
      }
      for (const call of m.tool_calls) {
        expect(answers, `assistant#${i} 的 tool_call ${call.id} 缺少紧跟的 tool 响应`).toContain(call.id);
      }
    }
    if (m.role === "tool") {
      const prevAssistant = [...msgs.slice(0, i)].reverse().find((x) => x.role === "assistant");
      const prevIds = prevAssistant?.tool_calls?.map((t) => t.id) ?? [];
      expect(prevIds, `孤儿 tool 消息 ${m.tool_call_id}`).toContain(m.tool_call_id);
    }
  }
}

describe("buildLlmMessages：tool_calls 历史必须完整配对", () => {
  it("生产事故序列（写调用被存进两条 assistant 消息）能被修复为合法序列", () => {
    const s = createSession("t1");
    seedMsg(s.id, { role: "user", content: "新建个信用卡账户，金额 0，中信银行信用卡" });
    // 旧版 bug：第一条 assistant 携带写调用但永远等不到 tool 响应
    seedMsg(s.id, { role: "assistant", content: "", toolCalls: [tc("call-1")] });
    // 第二条重复同一调用作为待确认卡片
    seedMsg(s.id, {
      role: "assistant",
      content: "",
      toolCalls: [tc("call-1")],
      pendingSql: "INSERT INTO accounts(id,name,type) VALUES('x','中信银行信用卡','creditCard')",
      pendingPurpose: "新建信用卡账户",
      resolved: 0,
    });
    // 用户确认后只补了一条 tool 响应
    seedMsg(s.id, { role: "tool", toolCallId: "call-1", content: '{"ok":true,"changes":1}' });

    const out = buildLlmMessages(s.id);
    expect(() => assertValidToolSequence(out)).not.toThrow();
  });

  it("末尾悬空的待确认 tool_calls（用户未确认就继续提问）会被合成响应补齐", () => {
    const s = createSession("t2");
    seedMsg(s.id, { role: "user", content: "帮我记一笔支出" });
    seedMsg(s.id, {
      role: "assistant",
      content: "",
      toolCalls: [tc("call-p")],
      pendingSql: "INSERT INTO transactions(id,account_id,date,amount) VALUES('a','b','2026-08-25',-100)",
      resolved: 0,
    });

    const out = buildLlmMessages(s.id);
    const last = out[out.length - 1];
    expect(last.role).toBe("tool");
    expect(last.tool_call_id).toBe("call-p");
    expect(last.content).toBeTruthy();
    expect(() => assertValidToolSequence(out)).not.toThrow();
  });

  it("丢弃没有归属的孤儿 tool 消息", () => {
    const s = createSession("t3");
    seedMsg(s.id, { role: "user", content: "hi" });
    seedMsg(s.id, { role: "tool", toolCallId: "ghost", content: "{}" });

    const out = buildLlmMessages(s.id);
    expect(out.filter((m) => m.role === "tool")).toHaveLength(0);
  });

  it("正常读流程保持原样且不注入多余响应", () => {
    const s = createSession("t4");
    seedMsg(s.id, { role: "user", content: "查一下有哪些账户" });
    seedMsg(s.id, { role: "assistant", content: "", toolCalls: [tc("a"), tc("b")] });
    seedMsg(s.id, { role: "tool", toolCallId: "a", content: '{"ok":true,"rows":[]}' });
    seedMsg(s.id, { role: "tool", toolCallId: "b", content: '{"ok":true,"rows":[]}' });
    seedMsg(s.id, { role: "assistant", content: "共有 2 个账户。" });

    const out = buildLlmMessages(s.id);
    expect(() => assertValidToolSequence(out)).not.toThrow();
    expect(out.filter((m) => m.role === "tool")).toHaveLength(2);
    expect(out.at(-1)).toEqual({ role: "assistant", content: "共有 2 个账户。" });
  });

  it("重建历史时保留 assistant 消息的 reasoning_content（思考模型续跑不触发 400）", () => {
    const s = createSession("t5");
    seedMsg(s.id, { role: "user", content: "帮我创建一个房贷的账户" });
    seedMsg(s.id, {
      role: "assistant",
      content: "好的，帮你创建一个房贷的账户。",
      toolCalls: [],
      reasoningContent: "用户想要一个房贷账户，这属于贷款类负债，应设为预算外账户。",
    });
    seedMsg(s.id, {
      role: "assistant",
      content: "",
      toolCalls: [tc("call-p")],
      pendingSql: "INSERT INTO accounts(id,name,type,on_budget) VALUES('a','房贷','personalLoan',0)",
      resolved: 0,
      reasoningContent: "需要执行一条 INSERT 来创建账户。",
    });
    seedMsg(s.id, { role: "tool", toolCallId: "call-p", content: '{"ok":true,"changes":1}' });

    const out = buildLlmMessages(s.id);
    const assistants = out.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].reasoning_content).toBe("用户想要一个房贷账户，这属于贷款类负债，应设为预算外账户。");
    expect(assistants[1].reasoning_content).toBe("需要执行一条 INSERT 来创建账户。");
    expect(() => assertValidToolSequence(out)).not.toThrow();
  });
});

describe("splitToolPlans：写调用不得进入已执行可见列表", () => {
  const readCls = { kind: "read", sql: "SELECT 1" };
  const writeCls = { kind: "write", sql: "INSERT INTO accounts(name) VALUES('x')" };

  it("首个 write 之前的 reads 可执行；write 成为独立待确认计划且不出现在 visibleCalls 中", () => {
    const plans = [
      { call: tc("r1"), cls: readCls },
      { call: tc("w1"), cls: writeCls },
      { call: tc("w2"), cls: writeCls },
    ];
    const { executable, writePlan, visibleCalls } = splitToolPlans(plans);
    expect(executable.map((p) => p.call.id)).toEqual(["r1"]);
    expect(writePlan?.call.id).toBe("w1");
    // 回归关键：若写调用混入 visibleCalls，持久化的 assistant 消息将永远等不到 tool 响应（LLM 400）
    expect(visibleCalls.map((c) => c.id)).toEqual(["r1"]);
  });

  it("没有写操作时全部可执行", () => {
    const plans = [
      { call: tc("r1"), cls: readCls },
      { call: tc("r2"), cls: readCls },
    ];
    const { executable, writePlan, visibleCalls } = splitToolPlans(plans);
    expect(writePlan).toBeNull();
    expect(visibleCalls.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(executable).toHaveLength(2);
  });
});
