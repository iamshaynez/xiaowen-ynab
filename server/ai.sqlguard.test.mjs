// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-ai-test-"));

const { classifySql } = await import("./ai.mjs");

describe("classifySql", () => {
  it("classifies plain reads as read", () => {
    expect(classifySql("SELECT * FROM accounts").kind).toBe("read");
    expect(classifySql("  select id from categories limit 5").kind).toBe("read");
    expect(classifySql("WITH t AS (SELECT 1) SELECT * FROM t").kind).toBe("read");
  });

  it("classifies single writes as write", () => {
    expect(classifySql("INSERT INTO accounts(id,name,type) VALUES('a','b','cash')").kind).toBe("write");
    expect(classifySql("UPDATE accounts SET name='x' WHERE id='a'").kind).toBe("write");
    expect(classifySql("DELETE FROM assignments WHERE month='2026-01'").kind).toBe("write");
  });

  it("rejects multiple statements", () => {
    expect(classifySql("SELECT 1; SELECT 2").error).toBeTruthy();
    expect(classifySql("DELETE FROM accounts; DROP TABLE accounts").error).toBeTruthy();
  });

  it("rejects forbidden commands", () => {
    expect(classifySql("PRAGMA table_info(accounts)").error).toBeTruthy();
    expect(classifySql("ATTACH DATABASE 'x' AS y").error).toBeTruthy();
    expect(classifySql("VACUUM").error).toBeTruthy();
  });

  it("rejects writes against protected tables", () => {
    expect(classifySql("UPDATE settings SET value='x'").error).toBeTruthy();
    expect(classifySql("INSERT INTO chat_sessions(id,title) VALUES('a','b')").error).toBeTruthy();
    expect(classifySql("DELETE FROM chat_messages").error).toBeTruthy();
  });

  it("rejects READS against protected tables (settings holds the AI key)", () => {
    expect(classifySql("SELECT value FROM settings WHERE key='ai_key'").error).toBeTruthy();
    expect(classifySql("select * from settings").error).toBeTruthy();
    expect(classifySql("SELECT * FROM chat_messages LIMIT 10").error).toBeTruthy();
    expect(classifySql("WITH s AS (SELECT * FROM settings) SELECT * FROM s").error).toBeTruthy();
  });

  it("rejects non-SQL statements", () => {
    expect(classifySql("").error).toBeTruthy();
    expect(classifySql("EXPLAIN SELECT 1").error).toBeTruthy();
  });
});
