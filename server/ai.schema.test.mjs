// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-schema-test-"));

const { db, setSetting } = await import("./db.mjs");
const { buildSchemaDoc, buildSystemPrompt } = await import("./ai.mjs");

describe("buildSchemaDoc：从数据库动态内省 schema", () => {
  it("包含核心业务表及列定义（类型/PK/NOT NULL/DEFAULT）", () => {
    const doc = buildSchemaDoc();
    expect(doc).toContain("- accounts(");
    expect(doc).toContain("- transactions(");
    expect(doc).toContain("- categories(");
    expect(doc).toContain("- assignments(");
    expect(doc).toMatch(/id TEXT PK|id TEXT NOT NULL/);
    expect(doc).toContain("starting_balance");
    expect(doc).toContain("starting_balance_date");
  });

  it("外键以 FK→ 形式标注", () => {
    const doc = buildSchemaDoc();
    expect(doc).toMatch(/account_id[^()]*FK→accounts/);
    expect(doc).toMatch(/group_id[^()]*FK→category_groups/);
  });

  it("排除内部表与受保护表", () => {
    const doc = buildSchemaDoc();
    expect(doc).not.toContain("chat_sessions");
    expect(doc).not.toContain("chat_messages");
    expect(doc).not.toContain("settings");
    expect(doc).not.toContain("schema_migrations");
    expect(doc).not.toContain("sqlite_");
  });

  it("数据库新增表后无需改代码即可出现在文档中（动态性）", () => {
    db.exec("CREATE TABLE tx_tags(id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, tag TEXT NOT NULL)");
    const doc = buildSchemaDoc();
    expect(doc).toContain("- tx_tags(");
    expect(doc).toContain("transaction_id");
    db.exec("DROP TABLE tx_tags");
    expect(buildSchemaDoc()).not.toContain("tx_tags");
  });

  it("系统提示词由动态 schema + 固定业务语义组成", () => {
    db.exec("CREATE TABLE tx_tags(id TEXT PRIMARY KEY)");
    const prompt = buildSystemPrompt();
    db.exec("DROP TABLE tx_tags");
    // 动态部分：新表自动可见
    expect(prompt).toContain("tx_tags");
    // 动态部分：实时账户快照仍在
    expect(prompt).toContain("账户：");
    // 固定部分：关键业务语义保留（分单位 / 两条腿转账 / 保护表）
    expect(prompt).toContain("「分」");
    expect(prompt).toContain("两条腿");
    expect(prompt).toContain("chat_messages");
  });

  it("未配置额外提示词时系统提示词不含自定义上下文段", () => {
    setSetting("ai_extra_prompt", "");
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain("用户自定义上下文");
  });

  it("配置额外提示词后系统提示词嵌入用户自定义上下文", () => {
    const extra = "我是小王，常用的转账对方是房东张女士，工资每月 10 号入账。";
    setSetting("ai_extra_prompt", extra);
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("用户自定义上下文");
    expect(prompt).toContain(extra);
    // 清理，避免污染其它用例
    setSetting("ai_extra_prompt", "");
  });
});
