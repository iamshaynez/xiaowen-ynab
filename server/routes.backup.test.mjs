// 备份相关路由 + 调度器集成测试。
// 隔离环境：必须在导入 db/routes 之前设置 DATA_DIR。
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-routes-backup-test-"));

const express = (await import("express")).default;
const { api } = await import("./routes.mjs");
const { db } = await import("./db.mjs");

const app = express();
app.use(express.json());
app.use("/api", api);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

const BACKUPS_DIR = path.join(process.env.DATA_DIR, "backups");
const gzCount = () => (fs.existsSync(BACKUPS_DIR) ? fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".sql.gz")).length : 0);

beforeAll(async () => {
  // 预置一条交易数据，让备份有内容可验证
  db.prepare(
    "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at) VALUES('acc-bk','现金','cash',1,0,0,NULL,0,'2026-01-01T00:00:00Z')"
  ).run();
});

// settings PUT 会随启停备份调度器；用例之间必须停掉，避免计时器跨用例触发备份
afterEach(async () => {
  const { stopBackupScheduler } = await import("./backup.scheduler.mjs");
  stopBackupScheduler();
});

describe("GET /api/settings：默认备份配置", () => {
  it("返回关闭状态、默认时间与 R2 空配置", async () => {
    const r = await call("GET", "/api/settings");
    expect(r.json.backupEnabled).toBe(false);
    expect(r.json.backupCronTime).toBe("03:00");
    expect(r.json.backupR2Endpoint).toBe("");
    expect(r.json.backupR2HasSecret).toBe(false);
  });
});

describe("PUT /api/settings：备份字段保存与回读", () => {
  it("保存启用/时间/R2 配置，secret 只写不读（hasSecret 标记）", async () => {
    const r1 = await call("PUT", "/api/settings", {
      backupEnabled: true,
      backupCronTime: "04:30",
      backupR2Endpoint: "https://acct.r2.cloudflarestorage.com/",
      backupR2Bucket: "my-bucket",
      backupR2Prefix: "/my-prefix/",
      backupR2AccessKeyId: "AKID",
      backupR2SecretKey: "top-secret",
    });
    expect(r1.status).toBe(200);

    const s = (await call("GET", "/api/settings")).json;
    expect(s.backupEnabled).toBe(true);
    expect(s.backupCronTime).toBe("04:30");
    expect(s.backupR2Endpoint).toBe("https://acct.r2.cloudflarestorage.com"); // 尾部斜杠被去除
    expect(s.backupR2Prefix).toBe("my-prefix"); // 两端斜杠被规整
    expect(s.backupR2AccessKeyId).toBe("AKID");
    expect(s.backupR2HasSecret).toBe(true);
    expect(JSON.stringify(s)).not.toContain("top-secret"); // 密钥绝不回传前端
  });

  it("非法 cron 时间被拒绝且不落库", async () => {
    const r = await call("PUT", "/api/settings", { backupCronTime: "25:99" });
    expect(r.status).toBe(400);
    const s = (await call("GET", "/api/settings")).json;
    expect(s.backupCronTime).toBe("04:30");
  });

  it("空 secret 不覆盖已存密钥；空 endpoint 清空配置后 hasSecret 保留", async () => {
    await call("PUT", "/api/settings", { backupR2SecretKey: "" });
    expect((await call("GET", "/api/settings")).json.backupR2HasSecret).toBe(true);
  });
});

describe("POST /api/backup/run：立即备份（仅本地）", () => {
  beforeAll(async () => {
    // 清空 R2 配置，确保本用例只验证本地备份路径（不发起真实网络请求）
    await call("PUT", "/api/settings", {
      backupR2Endpoint: "",
      backupR2Bucket: "",
      backupR2AccessKeyId: "",
      backupR2SecretKey: "",
    });
  });

  it("生成 .sql.gz 并更新 last_run 状态；手动备份不动调度日期标记", async () => {
    const before = gzCount();
    const r = await call("POST", "/api/backup/run");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.uploaded).toBe(false); // R2 已配置但 endpoint 不可达？——uploaded 仅在真正上传后为 true
    expect(gzCount()).toBe(before + 1);

    const s = (await call("GET", "/api/settings")).json;
    expect(s.backupLastRunAt).toBeTruthy();
    expect(s.backupLastResult).toBe("ok");
    // 调度日期由 scheduler 维护，手动运行不得推进
    expect(db.prepare("SELECT value FROM settings WHERE key='backup_sched_date'").get()).toBeUndefined();
  });
});

describe("POST /api/backup/test：R2 连通性测试", () => {
  it("未配置齐要素时返回 400 提示", async () => {
    await call("PUT", "/api/settings", { backupR2Bucket: "" });
    const r = await call("POST", "/api/backup/test");
    expect(r.status).toBe(400);
    expect(typeof r.json.error).toBe("string");
  });

  it("不可达 endpoint 返回 400 与错误信息", async () => {
    await call("PUT", "/api/settings", {
      backupR2Endpoint: "http://127.0.0.1:9",
      backupR2Bucket: "bk",
      backupR2AccessKeyId: "ak",
      backupR2SecretKey: "sk",
    });
    const r = await call("POST", "/api/backup/test");
    expect(r.status).toBe(400);
    expect(String(r.json.error).length).toBeGreaterThan(0);
    // 清理远端配置，避免影响其它用例
    await call("PUT", "/api/settings", { backupR2Endpoint: "", backupR2Bucket: "", backupR2AccessKeyId: "" });
    expect((await call("GET", "/api/settings")).json.backupR2HasSecret).toBe(true);
  }, 20_000);
});

describe("调度器 syncBackupScheduler", () => {
  it("到点补跑一次并盖当日戳；当日再次 tick 不重复执行", async () => {
    const { syncBackupScheduler, stopBackupScheduler, tickBackupOnce } = await import("./backup.scheduler.mjs");
    const { ymd, getTimezone } = await import("./db.mjs");
    try {
      await call("PUT", "/api/settings", { backupEnabled: true, backupCronTime: "23:59" });
      // 把上次调度日拨回前天 → 满足补跑条件（按配置时区的日历日计算）
      const twoDaysAgo = ymd(new Date(Date.now() - 2 * 864e5), getTimezone());
      db.prepare("INSERT INTO settings(key,value) VALUES('backup_sched_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(twoDaysAgo);

      syncBackupScheduler(); // 仅启停轮询，不立即执行
      expect(await tickBackupOnce()).toBe(true); // 第一次 tick：补跑发生

      const stamped = db.prepare("SELECT value FROM settings WHERE key='backup_sched_date'").get().value;
      expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stamped).not.toBe(twoDaysAgo);

      const countAfterFirst = gzCount();
      expect(await tickBackupOnce()).toBe(false); // 当日已盖戳：不重跑
      expect(gzCount()).toBe(countAfterFirst);
    } finally {
      stopBackupScheduler();
      await call("PUT", "/api/settings", { backupEnabled: false });
    }
  });
});
