// 备份核心逻辑单测：gzip 快照完整性、本地滚动裁剪、调度判定纯函数。
// 隔离环境：必须在导入 db.mjs 之前设置 DATA_DIR。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-backup-test-"));

const { db, createAccount, ymd } = await import("./db.mjs");
const {
  createBackupFile,
  pruneLocalBackups,
  runBackupNow,
  shouldRunBackup,
  BACKUP_FILE_RE,
} = await import("./backup.mjs");

const seedRow = () => createAccount({ name: `测试账户-${Date.now()}-${Math.random()}`, type: "cash", startingBalance: 123 });

describe("createBackupFile", () => {
  it("产出 .sql.gz，解压后是合法 SQLite 且包含源库数据", async () => {
    const dir = path.join(process.env.DATA_DIR, "backups-1");
    seedRow();
    const now = new Date(2026, 7, 27, 3, 4, 5);
    const r = await createBackupFile({ dir, now });
    expect(r.fileName).toBe("budget-2026-08-27-030405.sql.gz");
    expect(r.filePath).toBe(path.join(dir, r.fileName));
    expect(BACKUP_FILE_RE.test(r.fileName)).toBe(true);

    const raw = zlib.gunzipSync(fs.readFileSync(r.filePath));
    const restoredPath = path.join(dir, ".restore-check.sqlite");
    fs.writeFileSync(restoredPath, raw);
    const restored = new Database(restoredPath);
    expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    const n = restored.prepare("SELECT COUNT(*) c FROM accounts").get().c;
    expect(n).toBeGreaterThanOrEqual(1);
    restored.close();
    fs.unlinkSync(restoredPath);
  });

  it("同秒多次备份不覆盖：后续文件自动加短随机后缀", async () => {
    const dir = path.join(process.env.DATA_DIR, "backups-collide");
    const now = new Date(2026, 7, 27, 9, 9, 9);
    await createBackupFile({ dir, now });
    await createBackupFile({ dir, now });
    await createBackupFile({ dir, now });
    const files = fs.readdirSync(dir).filter((f) => BACKUP_FILE_RE.test(f));
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.endsWith(".sql.gz"))).toBe(true);
  });
});

describe("pruneLocalBackups", () => {
  it("按 mtime 只保留最新 7 个 .sql.gz，删除其余；目录不存在时返回空数组", () => {
    const dir = path.join(process.env.DATA_DIR, "backups-prune");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      const name = `budget-2026-07-${String(i + 1).padStart(2, "0")}-000000.sql.gz`;
      fs.writeFileSync(path.join(dir, name), "x");
      fs.utimesSync(path.join(dir, name), new Date(2026, 6, i + 1), new Date(2026, 6, i + 1));
    }
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep me");

    const removed = pruneLocalBackups(dir);
    expect(removed).toHaveLength(3);
    const left = fs.readdirSync(dir);
    expect(left.filter((f) => BACKUP_FILE_RE.test(f))).toHaveLength(7);
    // 最旧的三个被删
    expect(left.some((f) => f.startsWith("budget-2026-07-01"))).toBe(false);
    expect(left.some((f) => f === "unrelated.txt")).toBe(true);
  });

  it("不足 keep 数时不误删", () => {
    const dir = path.join(process.env.DATA_DIR, "backups-few");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "budget-2026-01-01-000000.sql.gz"), "x");
    expect(pruneLocalBackups(dir)).toHaveLength(0);
    expect(pruneLocalBackups(path.join(process.env.DATA_DIR, "no-such-dir"))).toEqual([]);
  });
});

describe("shouldRunBackup（调度判定纯函数）", () => {
  const at = (str) => new Date(str);
  it("禁用/缺时间时永不执行", () => {
    expect(shouldRunBackup({ enabled: false, cronTime: "03:00", lastRunDate: null }, at("2026-08-27T10:00:00"))).toBe(false);
    expect(shouldRunBackup({ enabled: true, cronTime: "", lastRunDate: null }, at("2026-08-27T10:00:00"))).toBe(false);
  });

  it("当天已跑过则不再执行", () => {
    expect(
      shouldRunBackup({ enabled: true, cronTime: "03:00", lastRunDate: "2026-08-27" }, at("2026-08-27T23:59:00"))
    ).toBe(false);
  });

  it("未跑过且已过当日计划时刻 → 执行（含首次启用）", () => {
    expect(shouldRunBackup({ enabled: true, cronTime: "03:00", lastRunDate: null }, at("2026-08-27T03:00:00"))).toBe(true);
    expect(shouldRunBackup({ enabled: true, cronTime: "03:00", lastRunDate: null }, at("2026-08-27T05:17:00"))).toBe(true);
    expect(shouldRunBackup({ enabled: true, cronTime: "03:00", lastRunDate: "2026-08-26" }, at("2026-08-27T02:59:00"))).toBe(false);
  });

  it("宕机跨天补跑：昨天没跑、今天即使还没到点也立即补一次", () => {
    expect(shouldRunBackup({ enabled: true, cronTime: "03:00", lastRunDate: "2026-08-25" }, at("2026-08-27T01:00:00"))).toBe(true);
  });

  it("按配置时区判定已过当日计划时刻（而非服务器默认时区）", () => {
    // now = 2026-08-27T05:00:00Z，在 America/Chicago（8 月为 CDT, UTC-5）是 08-27 00:00
    const tz = "America/Chicago";
    const now = new Date("2026-08-27T05:00:00Z");
    const lastRunDate = ymd(new Date(now.getTime() - 864e5), tz); // Chicago 的昨天 = 2026-08-26
    // 当前 Chicago 时间 00:00（curMin=0）：计划 01:00 未到点 → 不跑；计划 00:00 已到点 → 跑。
    // 若误用服务器默认时区（UTC，此刻为 05:00），「01:00」会被错判为已到点 → 由此证明配置时区生效。
    expect(shouldRunBackup({ enabled: true, cronTime: "01:00", lastRunDate }, now, tz)).toBe(false);
    expect(shouldRunBackup({ enabled: true, cronTime: "00:00", lastRunDate }, now, tz)).toBe(true);
  });
});

describe("runBackupNow", () => {
  it("无远端配置：只做本地备份+裁剪并写入状态 settings；不触碰调度标记", async () => {
    const dir = path.join(process.env.DATA_DIR, "backups-run");
    seedRow();
    const r = await runBackupNow({ dir, uploadRemote: false });
    expect(r.ok).toBe(true);
    expect(BACKUP_FILE_RE.test(r.file)).toBe(true);
    expect(fs.existsSync(path.join(dir, r.file))).toBe(true);
    expect(r.uploaded).toBe(false);

    const { getSetting } = await import("./db.mjs");
    expect(getSetting("backup_last_result")).toBe("ok");
    expect(getSetting("backup_last_run_at")).toBeTruthy();
    // 调度日期由 scheduler 单独维护，手动备份不得推进它
    expect(getSetting("backup_sched_date")).toBe(null);
  });

  it("远端开启：上传 key 为 prefix/文件名，且远端只留最新 7 个", async () => {
    const dir = path.join(process.env.DATA_DIR, "backups-run2");
    const cfg = {
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "bk",
      prefix: "pre",
      accessKeyId: "akid",
      secretAccessKey: "sk",
      ready: true,
    };
    const puts = [];
    let listed = [];
    const deleted = [];
    const fakeS3 = {
      putObject: async (_cfg, key) => {
        puts.push(key);
        listed.push({ key, lastModified: new Date().toISOString() });
        return true;
      },
      listObjects: async () => listed,
      deleteObjects: async (_cfg, keys) => {
        deleted.push(...keys);
        return true;
      },
    };
    // 预置：bucket 里已有 7 个历史版本
    for (let i = 1; i <= 7; i++) {
      listed.push({
        key: `pre/budget-2026-07-${String(i).padStart(2, "0")}-000000.sql.gz`,
        lastModified: `2026-07-${String(i).padStart(2, "0")}T00:00:00.000Z`,
      });
    }
    seedRow();
    const r = await runBackupNow({ dir, uploadRemote: true, s3Config: cfg, s3: fakeS3, now: new Date(2026, 7, 27, 12, 0, 0) });
    expect(r.uploaded).toBe(true);
    expect(puts[0]).toBe(`pre/${r.file}`);
    expect(deleted).toEqual(["pre/budget-2026-07-01-000000.sql.gz"]); // 只删最旧的 1 个
    expect(getLocalGzCount(dir)).toBeLessThanOrEqual(7);
  });

  function getLocalGzCount(d) {
    try {
      return fs.readdirSync(d).filter((f) => BACKUP_FILE_RE.test(f)).length;
    } catch {
      return 0;
    }
  }
});
