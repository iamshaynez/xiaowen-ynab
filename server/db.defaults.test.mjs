// 隔离环境：必须在导入 db.mjs 之前设置 DATA_DIR。
// 场景：先用「v1 旧 schema」手工建库并写入数据，再导入 db.mjs 触发升级，
// 验证升级后省略 created_at 的 INSERT 能成功（AI 生成的 SQL 不带该列）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-mig-test-"));

// 用与 baseline(v1) 完全一致的结构预置一个旧库
{
  const legacy = new Database(path.join(process.env.DATA_DIR, "budget.db"));
  legacy.pragma("journal_mode = WAL");
  legacy.exec(`
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  on_budget INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
  starting_balance INTEGER NOT NULL DEFAULT 0, starting_balance_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE category_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE categories (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE goals (category_id TEXT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE, type TEXT NOT NULL, target INTEGER NOT NULL DEFAULT 0, target_month TEXT);
CREATE TABLE assignments (month TEXT NOT NULL, category_id TEXT NOT NULL, assigned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, category_id));
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL, payee_name TEXT, transfer_account_id TEXT, category_id TEXT, memo TEXT,
  amount INTEGER NOT NULL, cleared INTEGER NOT NULL DEFAULT 0, reconciled INTEGER NOT NULL DEFAULT 0,
  is_start INTEGER NOT NULL DEFAULT 0, pair_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX idx_tx_category ON transactions(category_id);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT, tool_calls TEXT, tool_call_id TEXT,
  pending_sql TEXT, pending_purpose TEXT, pending_index INTEGER,
  resolved INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_msg_session ON chat_messages(session_id, created_at);
`);
  legacy.prepare(
    "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at) VALUES('acc-old','招商银行储蓄卡','checking',1,0,960000,'2026-02-25',1000,'2026-02-25T08:00:00.000Z')"
  ).run();
  legacy.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,amount,cleared,reconciled,is_start,created_at) VALUES('tx-old','acc-old','2026-03-01','超市',-1234,1,0,0,'2026-03-01T09:30:00.000Z')"
  ).run();
  legacy.close();
}

const { db } = await import("./db.mjs");

describe("migration v2：created_at 提供默认值", () => {
  it("accounts 允许省略 created_at 并自动填充 ISO 时间", () => {
    db.prepare("INSERT INTO accounts(id,name,type,on_budget,starting_balance) VALUES('acc-new','中信银行信用卡','creditCard',1,0)").run();
    const row = db.prepare("SELECT created_at,type,name FROM accounts WHERE id='acc-new'").get();
    expect(row.type).toBe("creditCard");
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("transactions 同样允许省略 created_at", () => {
    db.prepare("INSERT INTO transactions(id,account_id,date,amount) VALUES('tx-new','acc-new','2026-08-26',500)").run();
    const row = db.prepare("SELECT created_at FROM transactions WHERE id='tx-new'").get();
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("旧数据在重建后完整保留", () => {
    const acc = db.prepare("SELECT * FROM accounts WHERE id='acc-old'").get();
    expect(acc).toBeTruthy();
    expect(acc.name).toBe("招商银行储蓄卡");
    expect(acc.starting_balance).toBe(960000);
    expect(acc.created_at).toBe("2026-02-25T08:00:00.000Z");

    const tx = db.prepare("SELECT * FROM transactions WHERE id='tx-old'").get();
    expect(tx.amount).toBe(-1234);
    expect(tx.created_at).toBe("2026-03-01T09:30:00.000Z");
  });

  it("外键约束仍然生效且指向重建后的表", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toHaveLength(0);
    // 引用不存在账户的交易必须被拒绝
    expect(() =>
      db.prepare("INSERT INTO transactions(id,account_id,date,amount) VALUES('tx-bad','no-such','2026-08-26',1)").run()
    ).toThrow(/FOREIGN KEY|failed/);
  });
});
