import {
  db,
  uid,
  nowIso,
  getSetting,
  getTimezone,
  currentMonth,
  todayYmd,
} from "./db.mjs";
import { accountBalances } from "./engine.mjs";

const MAX_ITERATIONS = 10;
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 60;
const CALL_TIMEOUT_MS = 90000;

// 多模态（方案1：瞬态，不落库）：每条用户消息最多 6 张图，单张 data URL 上限约 8MB
// 图片仅用于当次 LLM 调用，用后即焚，不写入 chat_messages.images，避免 DB 膨胀与隐私泄露
export const MAX_IMAGES_PER_MESSAGE = 6;
export const MAX_IMAGE_DATAURL_CHARS = 8 * 1024 * 1024;
const ALLOWED_IMAGE_PREFIXES = ["data:image/jpeg;", "data:image/png;", "data:image/webp;", "data:image/gif;"];

export function normalizeImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    if (s.length > MAX_IMAGE_DATAURL_CHARS) continue;
    // 必须是 data:image/*;base64,
    const lower = s.toLowerCase();
    const okPrefix = ALLOWED_IMAGE_PREFIXES.some((p) => lower.startsWith(p));
    if (!okPrefix) continue;
    if (!s.includes("base64,")) continue;
    out.push(s);
    if (out.length >= MAX_IMAGES_PER_MESSAGE) break;
  }
  return out;
}

function parseImagesField(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr;
    return null;
  } catch {
    return null;
  }
}

// 方案1：启动时清理历史残留的 images（若之前已落库），确保不持久化
try {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name);
  if (cols.includes("images")) {
    db.prepare("UPDATE chat_messages SET images=NULL WHERE images IS NOT NULL").run();
  }
} catch {}

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

/* ------------------------- 动态 Schema 内省 ------------------------- */

// 不向模型展示的表：内部表 + 受保护表（见工作规则）
const HIDDEN_SCHEMA_TABLES = new Set(["chat_sessions", "chat_messages", "settings", "schema_migrations", "im_channels"]);

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function buildSchemaDoc() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((n) => !HIDDEN_SCHEMA_TABLES.has(n));

  const lines = [];
  for (const t of tables) {
    const ident = quoteIdent(t);
    const fkMap = new Map(db.pragma(`foreign_key_list(${ident})`).map((f) => [f.from, f.table]));
    const cols = db
      .pragma(`table_info(${ident})`)
      .map((c) => {
        let s = c.type ? `${c.name} ${c.type}` : c.name;
        if (c.pk) s += " PK";
        else if (c.notnull) s += " NOT NULL";
        if (c.dflt_value != null) s += ` DEFAULT ${c.dflt_value}`;
        if (fkMap.has(c.name)) s += ` FK→${fkMap.get(c.name)}`;
        return s;
      });
    lines.push(`- ${t}(${cols.join(", ")})`);
  }
  return lines.join("\n");
}

export function buildSystemPrompt() {
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

  const tz = getTimezone();
  const base = `你是「小文预算」内置的智能记账与财务分析助手，运行在本地 SQLite 数据库之上。请始终使用用户使用的语言回复（默认简体中文）。

# 应用方法论（YNAB 四法则）
1. 给每一块钱一个任务：收入进入 Ready to Assign（待分配金额），由 assignments 表按月分配到分类。
2. 拥抱真实开支：大额支出提前按月储蓄（用目标 targetByDate / targetBalance）。
3. 灵活应变：预算可以随时通过移动资金调整。
4. 关注资金账龄（Age of Money）。

# 数据库 Schema（由当前数据库实时内省生成，列标记：PK=主键、NOT NULL=必填、DEFAULT=有默认值可省略、FK→表=外键）
金额一律以「分」为单位的整数存储！¥12.34 = 1234。
${buildSchemaDoc()}

# 关键业务语义（固定不变，与上面的实时 Schema 配合理解）
- 账户余额 = starting_balance + SUM(transactions.amount WHERE is_start=0)；is_start=1 的行是期初余额，禁止修改或删除。
- 账户间转账 = 两条腿：源账户 amount 为负、目标账户 amount 为正，两行 transfer_account_id 互指对方、pair_id 相同、备注一致。目标腿 payee_name 为空串。绝不能只插入一条腿。
- 预算内账户之间互转 category_id 必须为 NULL，不影响预算；只有带 category_id 的交易才影响分类活动。
- 收入分类：category_groups.is_income=1 的分组下的分类是「收入来源」（如工资薪酬、奖金、理财收益、其他收入）。正数金额 + 收入分类 = 计入 Ready to Assign（待分配），并作为收入来源统计；收入分类不接受负金额（负数应记录在支出分类或退款原分类）。
- 无分类的正向流入也计入 Ready to Assign（旧约定兜底）；无分类的负向流出计入「未分类支出」。退款/报销记回原支出分类，会抵减该分类支出、不计入收入。
- 信用卡消费：category_id 写实际消费分类（不要写任何 cc: 分类），系统会自动把额度转移到还款科目；信用卡余额为负代表欠款。
- 向信用卡转账=还款：transfer_account_id 指向该卡、amount 为负（从付款账户看）。
- assignments 的 category_id 也可以是合成 id 'cc:<account_uuid>'，表示给某张信用卡的还款科目分配金额。
- accounts.type ∈ checking/savings/cash/creditCard/lineOfCredit/investment/property/vehicle/otherAsset/studentLoan/personalLoan/otherLiability；
  现金类(checking/savings/cash)与信用卡默认 on_budget=1。

# 当前账本快照
今天：${todayYmd()}（时区：${tz}）；当前月份：${currentMonth()}
⚠️ 日期规范：所有写入 transactions.date 必须直接使用此“今天”的 YYYY-MM-DD 字面量（或用户在对话中明确指定的日期）；禁止使用 SQLite 的 date('now')/datetime('now')/strftime('%Y-%m-%d','now')，否则会得到 UTC 而非配置时区的日期，导致跨天错位。报表/预算的月份筛选亦以此历法日期为准。
账户：
${accounts.join("\n") || "  （暂无账户）"}
分类组与分类：
${groups || "  （暂无分类）"}

# 工作规则
1. 你拥有 run_sql 工具直接操作上述数据库。回答任何数据问题前先 SELECT 查询确认事实，不要凭空猜测。
2. 只允许单条 SQL；SELECT 建议加 LIMIT；写操作只能是 INSERT/UPDATE/DELETE 单条语句。
3. 禁止触碰的表：chat_sessions、chat_messages、settings、im_channels。禁止 ATTACH/PRAGMA/VACUUM 等命令。
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

  // 用户自定义上下文：由系统设置「额外提示词」注入，网页端与 IM 共用同一份系统提示词
  const extraPrompt = getSetting("ai_extra_prompt", "").trim();
  if (extraPrompt) {
    return (
      base +
      `

# 用户自定义上下文
以下是用户补充的偏好与约定，回答时请优先遵循：
${extraPrompt}`
    );
  }
  return base;
}

function imageGuideAddition() {
  return `

# 视觉能力
你具备多模态视觉能力，可以直接“看到”用户发送的图片（票据、小票、转账截图、账单、表格等）。
当用户发送图片时：
- 仔细识别其中的关键信息：商户/收款方、金额（注意税额/合计/实付）、日期、支付方式/账户、分类线索、订单号等；
- 金额换算成「分」：¥12.34=1234，小数点后两位，缺失则按 0 补齐；
- 日期若图片上未写明则回落到「今天」${todayYmd()}，不要臆造；
- 结合已有的账户/分类信息，选择最匹配的账户与分类；若无法确定则在回复中向用户确认或给出最可能的建议；
- 随后用 run_sql 工具写入交易（transactions 表），同样需要用户确认才会执行。`;
}

// 带视觉引导的完整系统提示词
export function buildSystemPromptWithVision() {
  return buildSystemPrompt() + imageGuideAddition();
}

/* ------------------------- SQL safety ------------------------- */

const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum|reindex)\b/i;
const PROTECTED_TABLES = /\b(chat_sessions|chat_messages|settings|im_channels)\b/i;

export function classifySql(rawSql) {
  const sql = String(rawSql || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { error: "empty sql" };
  if (/;/.test(sql)) return { error: "only one statement allowed" };
  if (FORBIDDEN_SQL.test(sql)) return { error: "command not allowed" };
  if (PROTECTED_TABLES.test(sql)) return { error: "this table is protected" };
  if (/^(select|with)\b/i.test(sql)) return { kind: "read", sql };
  if (/^(insert|update|delete)\b/i.test(sql)) return { kind: "write", sql };
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

let insMsgStmt = null;
let insHasImages = null;
function getInsStmt() {
  if (insMsgStmt) return insMsgStmt;
  // 兼容迁移前后的表结构：images 列可能尚未存在（老库重启瞬间）
  try {
    const cols = db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name);
    if (cols.includes("images")) {
      insHasImages = true;
      insMsgStmt = db.prepare(
        "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,reasoning_content,pending_sql,pending_purpose,pending_index,resolved,created_at,images) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
      );
    } else {
      insHasImages = false;
      insMsgStmt = db.prepare(
        "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,reasoning_content,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
      );
    }
  } catch {
    insHasImages = false;
    insMsgStmt = db.prepare(
      "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,reasoning_content,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    );
  }
  return insMsgStmt;
}

export function listSessions() {
  return db
    .prepare(
      `SELECT s.*, (SELECT content FROM chat_messages m WHERE m.session_id=s.id AND m.role='user' ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM chat_sessions s WHERE s.channel='web' ORDER BY s.updated_at DESC`
    )
    .all();
}

export function createSession(title, meta = {}) {
  const id = uid();
  const now = nowIso();
  db.prepare("INSERT INTO chat_sessions(id,title,channel,external_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
    id,
    title,
    meta.channel || "web",
    meta.externalId ?? null,
    now,
    now
  );
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
  const text = String(content || "").trim();
  const s = getSessionRow(sessionId);
  if (s && (!s.title || s.title === "新会话" || s.title === "Untitled" || s.title === "新对话")) {
    const titleSeed = text || "新会话";
    // 图片记账的标题若无文字，回落到“图片记账”
    const finalTitle = titleSeed || "图片记账";
    renameSession(sessionId, finalTitle.slice(0, 30));
  }
  return addMessage(sessionId, { role: "user", content: text });
}

function transformMsg(m) {
  return {
    id: m.id,
    role: m.role,
    content: m.content ?? "",
    reasoningContent: m.reasoning_content ?? null,
    toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    toolCallId: m.tool_call_id ?? null,
    pending:
      m.resolved === 0 && m.pending_sql
        ? { sql: m.pending_sql, purpose: m.pending_purpose, index: m.pending_index ?? 0 }
        : null,
    proposedSql: m.pending_sql,
    resolved: m.resolved === 1,
    createdAt: m.created_at,
    images: parseImagesField(m.images) || null,
  };
}

function touchSession(sessionId) {
  db.prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(nowIso(), sessionId);
}

function addMessage(sessionId, fields) {
  const id = uid();
  const stmt = getInsStmt();
  const imagesJson = fields.images && fields.images.length ? JSON.stringify(fields.images) : null;
  try {
    if (insHasImages) {
      stmt.run(
        id,
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
        fields.createdAt ?? nowIso(),
        imagesJson
      );
    } else {
      stmt.run(
        id,
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
        fields.createdAt ?? nowIso()
      );
    }
  } catch (e) {
    // 若因列缺失导致失败，回退到无 images 的语句
    if (String(e.message || "").includes("images")) {
      insHasImages = false;
      insMsgStmt = db.prepare(
        "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,reasoning_content,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
      );
      insMsgStmt.run(
        id,
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
        fields.createdAt ?? nowIso()
      );
    } else throw e;
  }
  touchSession(sessionId);
  return id;
}/* ------------------------- History for LLM ------------------------- */

// OpenAI 协议要求：带 tool_calls 的 assistant 消息后必须紧跟覆盖全部 id 的 tool 消息。
// 历史数据可能存在悬空调用（旧版 bug、用户未确认就继续提问等），这里统一补齐/清洗。
const NO_RESULT_TOOL = JSON.stringify({ ok: false, error: "no result was recorded for this tool call" });

export function buildLlmMessages(sessionId, opts = {}) {
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at, rowid")
    .all(sessionId);
  const recent = rows.slice(-MAX_HISTORY_MESSAGES);
  const ephemeralImages = normalizeImages(opts.images || opts.ephemeralImages || []);
  // 若当次请求携带图片，则使用带视觉指引的系统提示词（瞬态，不依赖历史落库）
  const hasAnyImage = ephemeralImages.length > 0;
  const systemContent = hasAnyImage ? buildSystemPromptWithVision() : buildSystemPrompt();
  const out = [{ role: "system", content: systemContent }];
  let awaiting = [];

  const flushAwaiting = () => {
    for (const id of awaiting.splice(0)) {
      out.push({ role: "tool", tool_call_id: id, content: NO_RESULT_TOOL });
    }
  };

  // 找到最近一条 user 消息的索引，用于挂载瞬态图片（仅当次生效，不落库）
  let lastUserIndex = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  for (let idx = 0; idx < recent.length; idx++) {
    const m = recent[idx];
    if (m.role === "user") {
      flushAwaiting();
      const isLastUser = idx === lastUserIndex;
      const images = isLastUser && ephemeralImages.length ? ephemeralImages : null;
      if (Array.isArray(images) && images.length) {
        const parts = [];
        const text = (m.content || "").trim();
        if (text) parts.push({ type: "text", text });
        else parts.push({ type: "text", text: "请识别这张图片中的消费/账单信息并按需记账。" });
        for (const url of images) {
          parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
        }
        out.push({ role: "user", content: parts });
      } else {
        out.push({ role: "user", content: m.content || "" });
      }
    } else if (m.role === "assistant") {
      let calls = null;
      if (m.tool_calls) {
        try {
          calls = JSON.parse(m.tool_calls);
        } catch {
          calls = null;
        }
      }
      if (Array.isArray(calls) && calls.length > 0) {
        flushAwaiting();
        out.push({
          role: "assistant",
          content: m.content || null,
          ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}) },
          })),
        });
        awaiting = calls.map((c) => c.id).filter(Boolean);
      } else if (m.content) {
        flushAwaiting();
        out.push({
          role: "assistant",
          content: m.content,
          ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        });
      }
    } else if (m.role === "tool") {
      if (m.tool_call_id && awaiting.includes(m.tool_call_id)) {
        awaiting = awaiting.filter((id) => id !== m.tool_call_id);
        out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content || "" });
      }
      // 孤儿/重复的 tool 响应直接丢弃
    }
  }
  flushAwaiting();
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

// 拆分工具调用计划：首个写操作之前的读语句立即执行；写操作单独等待用户确认。
// 关键约束：写调用绝不能混入 visibleCalls，否则持久化的 assistant(tool_calls)
// 消息将永远等不到 tool 响应，后续每次请求都会触发 LLM 400。
export function splitToolPlans(plans) {
  const firstWriteIdx = plans.findIndex((p) => !p.cls.error && p.cls.kind === "write");
  const executable = firstWriteIdx === -1 ? plans : plans.slice(0, firstWriteIdx);
  const writePlan = firstWriteIdx === -1 ? null : plans[firstWriteIdx];
  const visibleCalls = executable.map((p) => p.call);
  return { executable, writePlan, visibleCalls };
}

function truncate(s) {
  return s.length > MAX_TOOL_RESULT_CHARS ? s.slice(0, MAX_TOOL_RESULT_CHARS) + "…(truncated)" : s;
}

/* ------------------------- Agent loop ------------------------- */

export async function runAgent(sessionId, opts = {}) {
  const cfg = getAiConfig();
  if (!cfg.key || !cfg.baseUrl) throw new Error("AI_NOT_CONFIGURED");

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const llmMessages = buildLlmMessages(sessionId, opts);
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
      const { executable, writePlan, visibleCalls } = splitToolPlans(plans);
      addMessage(sessionId, {
        role: "assistant",
        content: msg.content || "",
        toolCalls: visibleCalls,
        reasoningContent: msg.reasoning_content ?? null,
      });

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
          reasoningContent: msg.reasoning_content ?? null,
          pendingSql: writePlan.cls.sql,
          pendingPurpose: writePlan.purpose,
          pendingIndex: 0,
          resolved: 0,
        });
        return { status: "awaiting_confirmation" };
      }
      continue;
    }

    addMessage(sessionId, {
      role: "assistant",
      content: msg.content || "(无内容)",
      reasoningContent: msg.reasoning_content ?? null,
    });
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
  if (!row) return { status: "idle", changed: false };

  const call = JSON.parse(row.tool_calls)[0];
  db.prepare("UPDATE chat_messages SET resolved=1 WHERE id=?").run(row.id);

  let result;
  let changed = false;
  if (approve) {
    result = execWrite(row.pending_sql);
    let parsed = {};
    try {
      parsed = JSON.parse(result);
    } catch {}
    changed = parsed.ok === true;
  } else {
    result = JSON.stringify({ ok: false, rejected: true, message: "用户取消了这个操作" });
  }
  addMessage(sessionId, { role: "tool", toolCallId: call.id, content: result });

  if (!approve) {
    addMessage(sessionId, {
      role: "assistant",
      content: "好的，已取消该操作，数据未发生任何变化。需要我换个方案吗？",
    });
    return { status: "idle", changed: false };
  }
  // 写入已生效；后续 LLM 汇总失败不应让前端误以为写入失败
  let agentResult;
  try {
    agentResult = await runAgent(sessionId);
  } catch (e) {
    agentResult = { status: "idle", error: e.message };
  }
  return { changed, ...agentResult };
}
