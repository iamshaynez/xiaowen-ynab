// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-sessmap-test-"));

const { createSession, listSessions, getSessionRow } = await import("./ai.mjs");

describe("chat session API 形状（camelCase 契约）", () => {
  it("listSessions 返回 createdAt/updatedAt 且不带 snake_case 字段", () => {
    const s = createSession("t1");
    const list = listSessions();
    const found = list.find((x) => x.id === s.id);
    expect(found).toBeTruthy();
    expect(found.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(found.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(found.updated_at).toBeUndefined();
    expect(found.created_at).toBeUndefined();
  });

  it("getSessionRow 返回 createdAt/updatedAt", () => {
    const s = createSession("t2");
    const row = getSessionRow(s.id);
    expect(row.updatedAt).toBeTruthy();
    expect(row.createdAt).toBeTruthy();
    expect(row.updated_at).toBeUndefined();
    expect(row.created_at).toBeUndefined();
  });
});
