import {
  db,
  uid,
  nowIso,
  getSetting,
  currentMonth,
  todayYmd,
} from "./db.mjs";
import { accountBalances } from "./engine.mjs";

const MAX_ITERATIONS = 10;
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 60;
const CALL_TIMEOUT_MS = 90000;

export function getAiConfig() {
  return {
    baseUrl: getSetting("ai_base_url", "https://api.openai.com/v1"),
    model: getSetting("ai_model", "gpt-4o-mini"),
    key: getSetting("ai_key", ""),
  };
}

async function chatCompletion(messages, tools) {
  const { baseUrl, model, key } = getAiConfig();
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, tools, temperature: 0.2 }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`LLM ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function testAiConnection() {
  const data = await chatCompletion([{ role: "user", content: "ping" }], undefined);
  return { ok: true, model: data.model || getAiConfig().model };
}

function buildSystemPrompt() {
  const balances = accountBalances();
  const accounts = db
    .prepare("SELECT id,name,type,on_budget,closed FROM accounts ORDER BY sort_order")
    .all()
    .map((a) => `  - ${a.name} | id=${a.id} | type=${a.type} | on_budget=${a.on_budget} | closed=${a.closed} | balance=${((balances.get(a.id) || 0) / 100).toFixed(2)}元`);

  const groups = db
    .prepare("SELECT * FROM category_groups ORDER BY sort_order")
    .all()
    .map((g) => {
      const cats = db.prepare("SELECT id,name FROM categories WHERE group_id=? ORDER BY sort_order").all(g.id);
      return `- ${g.name} (id=${g.id})\n${cats.map((c) => `    · ${c.name} (id=${c.id})`).join("\n")}`;
    })
    .join("\n");

  return `你是「小文预算」内置的智能记账与财务分析助手，运行在本地 SQLite 数据库之上。请始终使用用户使用的语言回复（默认简体中文）。

# 应用方法论（YNAB 四法则）
1. 给每一块钱一个任务：收入进入 Ready to Assign（待分配金额），由 assignments 表按月分配到分类。
2. 拥抱真实开支：大额支出提前按月储蓄（用目标 targetByDate / targetBalance）。
3. 灵活应变：预算可以随时通过移动资金调整。
4. 关注资金账龄（Age of Money）。

# 数据库 Schema（SQLite，金额一律以「分」为单位的整数存储！¥12.34 = 1234）
- accounts(id PK, name, type, on_budget INT 0/1, closed INT 0/1, starting_balance INT 分, starting_balance_date 'YYYY-MM-DD', sort_order)
  账户余额 = starting_balance + SUM(transactions.amount WHERE is_start=0)。
  type ∈ checking/savings/cash/creditCard/lineOfCredit/investment/property/vehicle/otherAsset/studentLoan/personalLoan/otherLiability。
  现金类(checking/savings/cash)与信用卡默认 on_budget=1；信用卡余额为负代表欠款。
- transactions(id PK, account_id FK→accounts, date 'YYYY-MM-DD', payee_name, transfer_account_id FK→accounts 可空,
               category_id FK→categories 可空, memo, amount INT 分 正=流入/负=流出, cleared 0/1, reconciled 0/1,
               is_start 0/1, pair_id TEXT 可空, created_at)
  【关键】账户间转账 = 两条腿：源账户 amount 为负、目标账户 amount 为正，两行 transfer_account_id 互指对方、pair_id 相同、备注一致。
  目标腿 payee_name 为空串。绝不能只插入一条腿。
  is_start=1 的行是期初余额，禁止修改或删除。
  预算内账户之间互转(category_id 必须为 NULL)不影响预算；只有带 category_id 的交易才影响分类活动；
  无分类的正向流入计入 Ready to Assign。
  信用卡消费：category_id 写实际消费分类（不要写任何 cc: 分类），系统会自动把额度转移到还款科目。
  向信用卡转账=还款：transfer_account_id 指向该卡、amount 为负（从付款账户看）。
- category_groups(id PK, name, sort_order, hidden)
- categories(id PK, group_id FK, name, sort_order, hidden)
- goals(category_id PK FK, type 'monthly'|'targetBalance'|'targetByDate', target INT 分, target_month 'YYYY-MM-DD' 可空)
- assignments(month 'YYYY-MM', category_id TEXT, assigned INT 分, PRIMARY KEY(month, category_id))
  category_id 也可以是合成 id 'cc:<account_uuid>'，表示给某张信用卡的还款科目分配金额。

# 当前账本快照
今天：${todayYmd()}；当前月份：${currentMonth()}
账户：
${accounts.join("\n") || "  （暂无账户）"}
分类组与分类：
${groups || "  （暂无分类）"}

# 工作规则
1. 你拥有 run_sql 工具直接操作上述数据库。回答任何数据问题前先 SELECT 查询确认事实，不要凭空猜测。
2. 只允许单条 SQL；SELECT 建议加 LIMIT；写操作只能是 INSERT/UPDATE/DELETE 单条语句。
3. 禁止触碰的表：chat_sessions、chat_messages、settings。禁止 ATTACH/PRAGMA/VACUUM 等命令。
4. 任何写操作（INSERT/UPDATE/DELETE）系统会强制弹出用户确认，你只需发起，然后根据工具返回结果继续。
5. 写入后建议 SELECT 验证结果，并向用户报告变更摘要。
6. 回复使用 Markdown。适合时可用 mermaid 代码块（pie/flowchart/xychart 等）做可视化，例如：
   \`\`\`mermaid
   pie title 支出构成
     "餐饮" : 45
   \`\`\`
   注意 mermaid pie 标签若含特殊字符请加引号。
7. 数字输出统一换算成元（分/100）保留两位小数；统计口径上，分析支出时排除预算内账户之间的互相转账。
8. 如果用户的问题与账本无关，也可以正常聊天，但优先引导到财务管理话题。`;
}

/* ------------------------- SQL safety ------------------------- */

const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum|reindex)\b/i;
const FORBIDDEN_WRITE_TABLES = /\b(chat_sessions|chat_messages|settings)\b/i;

function classifySql(rawSql) {
  const sql = String(rawSql || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { error: "empty sql" };
  if (/;/.test(sql)) return { error: "only one statement allowed" };
  if (FORBIDDEN_SQL.test(sql)) return { error: "command not allowed" };
  if (/^(select|with)\b/i.test(sql)) return { kind: "read", sql };
  if (/^(insert|update|delete)\b/i.test(sql)) {
    if (FORBIDDEN_WRITE_TABLES.test(sql)) return { error: "this table is protected" };
    return { kind: "write", sql };
  }
  return { error: "only SELECT / INSERT / UPDATE / DELETE are supported" };
}

function execRead(sql) {
  try {
    let rows = db.prepare(sql).all();
    const total = rows.length;
    const truncated = total > 40;
    if (truncated) rows = rows.slice(0, 40);
    return JSON.stringify({ ok: true, rowCount: total, truncated, rows });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e.message || e) });
  }
}

function execWrite(sql) {
  try {
    const info = db.prepare(sql).run();
    return JSON.stringify({ ok: true, changes: info.changes });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e.message || e) });
  }
}

/* ------------------------- Persistence ------------------------- */

const insMsgStmt = db.prepare(
  "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
);

export function listSessions() {
  return db
    .prepare(
      `SELECT s.*, (SELECT content FROM chat_messages m WHERE m.session_id=s.id AND m.role='user' ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM chat_sessions s ORDER BY s.updated_at DESC`
    )
    .all();
}

export function createSession(title) {
  const id = uid();
  const now = nowIso();
  db.prepare("INSERT INTO chat_sessions(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(id, title, now, now);
  return getSessionRow(id);
}

export function getSessionRow(id) {
  return db.prepare("SELECT * FROM chat_sessions WHERE id=?").get(id);
}

export function deleteSession(id) {
  db.prepare("DELETE FROM chat_sessions WHERE id=?").run(id);
}

export function renameSession(id, title) {
  db.prepare("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?").run(title, nowIso(), id);
}

export function getSessionMessages(sessionId) {
  return db
    .prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at, rowid")
    .all(sessionId)
    .map(transformMsg);
}

export function appendUserMessage(sessionId, content) {
  const s = getSessionRow(sessionId);
  if (s && (!s.title || s.title === "新会话" || s.title === "Untitled" || s.title === "新对话")) {
    renameSession(sessionId, content.slice(0, 30));
  }
  return addMessage(sessionId, { role: "user", content });
}

function transformMsg(m) {
  return {
    id: m.id,
    role: m.role,
    content: m.content ?? "",
    toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    toolCallId: m.tool_call_id ?? null,
    pending:
      m.resolved === 0 && m.pending_sql
        ? { sql: m.pending_sql, purpose: m.pending_purpose, index: m.pending_index ?? 0 }
        : null,
    proposedSql: m.pending_sql,
    resolved: m.resolved === 1,
    createdAt: m.created_at,
  };
}

function touchSession(sessionId) {
  db.prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(nowIso(), sessionId);
}

function addMessage(sessionId, fields) {
  const id = uid();
  insMsgStmt.run(
    id,
    sessionId,
    fields.role,
    fields.content ?? null,
    fields.toolCalls ? JSON.stringify(fields.toolCalls) : null,
    fields.toolCallId ?? null,
    fields.pendingSql ?? null,
    fields.pendingPurpose ?? null,
    fields.pendingIndex ?? null,
    fields.resolved === 0 ? 0 : 1,
    fields.createdAt ?? nowIso()
  );
  touchSession(sessionId);
  return id;
}/* ------------------------- History for LLM ------------------------- */

function buildLlmMessages(sessionId) {
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at, rowid")
    .all(sessionId);
  const recent = rows.slice(-MAX_HISTORY_MESSAGES);
  const out = [{ role: "system", content: buildSystemPrompt() }];
  for (const m of recent) {
    if (m.role === "user") out.push({ role: "user", content: m.content || "" });
    else if (m.role === "assistant") {
      if (m.tool_calls) {
        out.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: JSON.parse(m.tool_calls).map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments) },
          })),
        });
      } else if (m.content) {
        out.push({ role: "assistant", content: m.content });
      }
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content || "" });
    }
  }
  return out;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_sql",
      description:
        "Execute one SQL statement against the budget database. SELECT/WITH runs immediately and returns rows. INSERT/UPDATE/DELETE requires explicit user confirmation before it executes.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "A single SQLite statement. Amounts must be integer cents." },
          purpose: { type: "string", description: "Short human-readable reason for this statement, shown to the user for confirmation." },
        },
        required: ["sql"],
      },
    },
  },
];

function parseToolArgs(call) {
  try {
    const raw = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
    const args = JSON.parse(raw || "{}");
    return { sql: String(args.sql || ""), purpose: args.purpose ? String(args.purpose) : null };
  } catch {
    return { sql: "", purpose: null };
  }
}

function truncate(s) {
  return s.length > MAX_TOOL_RESULT_CHARS ? s.slice(0, MAX_TOOL_RESULT_CHARS) + "…(truncated)" : s;
}

/* ------------------------- Agent loop ------------------------- */

export async function runAgent(sessionId) {
  const cfg = getAiConfig();
  if (!cfg.key || !cfg.baseUrl) throw new Error("AI_NOT_CONFIGURED");

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const llmMessages = buildLlmMessages(sessionId);
    let data;
    try {
      data = await chatCompletion(llmMessages, TOOLS);
    } catch (e) {
      addMessage(sessionId, { role: "assistant", content: `⚠️ 调用模型失败：${e.message}` });
      throw e;
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) {
      addMessage(sessionId, { role: "assistant", content: "⚠️ 模型返回了空响应。" });
      return { status: "idle" };
    }

    if (msg.tool_calls?.length) {
      const calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      }));
      const plans = calls.map((call) => {
        const { sql, purpose } = parseToolArgs(call);
        return { call, sql, purpose, cls: classifySql(sql) };
      });
      const firstWriteIdx = plans.findIndex((p) => !p.cls.error && p.cls.kind === "write");
      const executable = firstWriteIdx === -1 ? plans : plans.slice(0, firstWriteIdx);
      const writePlan = firstWriteIdx === -1 ? null : plans[firstWriteIdx];

      const visibleCalls = executable.map((p) => p.call).concat(writePlan ? [writePlan.call] : []);
      addMessage(sessionId, { role: "assistant", content: msg.content || "", toolCalls: visibleCalls });

      let stopped = false;
      for (const p of executable) {
        if (p.cls.error) {
          addMessage(sessionId, {
            role: "tool",
            toolCallId: p.call.id,
            content: truncate(JSON.stringify({ ok: false, error: p.cls.error })),
          });
        } else {
          addMessage(sessionId, {
            role: "tool",
            toolCallId: p.call.id,
            content: truncate(execRead(p.cls.sql)),
          });
        }
      }

      if (writePlan) {
        addMessage(sessionId, {
          role: "assistant",
          content: "",
          toolCalls: [writePlan.call],
          pendingSql: writePlan.cls.sql,
          pendingPurpose: writePlan.purpose,
          pendingIndex: 0,
          resolved: 0,
        });
        return { status: "awaiting_confirmation" };
      }
      continue;
    }

    addMessage(sessionId, { role: "assistant", content: msg.content || "(无内容)" });
    return { status: "idle" };
  }

  addMessage(sessionId, { role: "assistant", content: "⚠️ 已达到最大工具调用轮数，已停止。" });
  return { status: "idle" };
}

export async function confirmPending(sessionId, approve) {
  const row = db
    .prepare(
      "SELECT * FROM chat_messages WHERE session_id=? AND resolved=0 AND pending_sql IS NOT NULL ORDER BY rowid DESC LIMIT 1"
    )
    .get(sessionId);
  if (!row) return { status: "idle" };

  const call = JSON.parse(row.tool_calls)[0];
  db.prepare("UPDATE chat_messages SET resolved=1 WHERE id=?").run(row.id);

  let result;
  if (approve) {
    result = execWrite(row.pending_sql);
  } else {
    result = JSON.stringify({ ok: false, rejected: true, message: "用户取消了这个操作" });
  }
  addMessage(sessionId, { role: "tool", toolCallId: call.id, content: result });

  if (!approve) {
    addMessage(sessionId, {
      role: "assistant",
      content: "好的，已取消该操作，数据未发生任何变化。需要我换个方案吗？",
    });
    return { status: "idle" };
  }
  return runAgent(sessionId);
}
