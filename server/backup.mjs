// 每日备份核心逻辑：在线快照 → gzip → 本地滚动保留 7 份 →（可选）上传 R2 并滚动裁剪。
// 上传/列表/删除通过参数注入（默认 server/s3.mjs 的实现），便于离线单测。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { db, getSetting, setSetting, nowIso, DATA_DIR, getTimezone, ymd } from "./db.mjs";
import * as s3Api from "./s3.mjs";

export const BACKUP_DIR_NAME = "backups"; // 位于 DATA_DIR 下，随卷持久化
export const KEEP_VERSIONS = 7;
export const BACKUP_FILE_RE = /^budget-\d{4}-\d{2}-\d{2}-\d{6}(?:-[0-9a-z]{4})?\.sql\.gz$/;

const pad2 = (n) => String(n).padStart(2, "0");

/** budget-YYYY-MM-DD-HHmmss.sql.gz */
export function backupFileName(d) {
  return `budget-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(
    d.getMinutes()
  )}${pad2(d.getSeconds())}.sql.gz`;
}

/**
 * 用 better-sqlite3 在线备份 API 生成一致性快照（WAL 安全、不阻塞读写），
 * 再整体 gzip 写出。临时明文文件用后即删。
 * 同秒重复备份（如手动紧跟定时触发）时追加短随机后缀，避免静默覆盖。
 */
export async function createBackupFile({ dir, now = new Date(), database = db } = {}) {
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-backup-${process.pid}-${Date.now()}.sqlite`);
  try {
    await database.backup(tmp);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    let fileName = backupFileName(now);
    while (fs.existsSync(path.join(dir, fileName))) {
      fileName = backupFileName(now).replace(/\.sql\.gz$/, `-${crypto.randomBytes(2).toString("hex")}.sql.gz`);
    }
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, gz);
    return { filePath, fileName, bytes: gz.byteLength };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

/**
 * 本地滚动裁剪：目录内匹配备份命名规则的文件按 mtime 倒序，只留最新 keep 个。
 * 返回被删除的路径列表。
 */
export function pruneLocalBackups(dir, { keep = KEEP_VERSIONS, unlink = fs.unlinkSync, readdir = fs.readdirSync, stat = fs.statSync } = {}) {
  let files = [];
  try {
    files = readdir(dir);
  } catch {
    return []; // 目录不存在等
  }
  const items = files
    .filter((f) => BACKUP_FILE_RE.test(f))
    .map((f) => {
      try {
        return { path: path.join(dir, f), mtimeMs: stat(path.join(dir, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items
    .slice(keep)
    .map((it) => {
      try {
        unlink(it.path);
        return it.path;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 从 settings 聚合 R2 连接配置；ready 表示四要素齐全、可以上传 */
export function s3ConfigFromSettings(get = getSetting) {
  const cfg = {
    endpoint: (get("backup_r2_endpoint", "") || "").trim().replace(/\/+$/, ""),
    bucket: (get("backup_r2_bucket", "") || "").trim(),
    prefix: (get("backup_r2_prefix", "xiaowen-ynab-backup") || "").replace(/^\/+|\/+$/g, ""),
    accessKeyId: (get("backup_r2_access_key_id", "") || "").trim(),
    secretAccessKey: get("backup_r2_secret_key", "") || "",
  };
  cfg.ready = !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
  return cfg;
}

function remoteKeyOf(prefix, fileName) {
  return prefix ? `${prefix}/${fileName}` : fileName;
}

/** 远端滚动裁剪：按 LastModified 倒序保留 KEEP_VERSIONS 个，批量删除其余 */
async function pruneRemoteBackups(cfg, s3, opt) {
  const objects = await s3.listObjects(cfg, cfg.prefix || "", opt);
  // 远端 key 含可选前缀，只按文件名部分匹配本应用命名的备份
  const mine = objects.filter((o) => BACKUP_FILE_RE.test(o.key.split("/").pop()));
  mine.sort((a, b) => (b.lastModified || b.key).localeCompare(a.lastModified || a.key));
  const doomed = mine.slice(KEEP_VERSIONS).map((o) => o.key);
  if (!doomed.length) return [];
  await s3.deleteObjects(cfg, doomed, opt);
  return doomed;
}

function recordOutcome(okFlag, detail = "") {
  setSetting("backup_last_run_at", nowIso());
  setSetting("backup_last_result", okFlag ? "ok" : String(detail).slice(0, 300));
}

// 注入接口约定：{ listObjects, putObject, deleteObjects }；默认绑定到 server/s3.mjs
const defaultS3Binding = {
  listObjects: (cfg, prefix, opt) => s3Api.s3ListObjects(cfg, prefix, opt),
  putObject: (cfg, key, body, opt) => s3Api.s3PutObject(cfg, key, body, opt),
  deleteObjects: (cfg, keys, opt) => s3Api.s3DeleteObjects(cfg, keys, opt),
};

/**
 * 执行一次完整备份并记录结果到 settings（backup_last_*）。
 * 注意：不推进 backup_sched_date —— 该标记由调度器单独维护，
 * 手动「立即备份」不影响当晚定时任务的触发判定。
 *
 * @param opts.dir            备份目录，默认 DATA_DIR/backups
 * @param opts.uploadRemote   是否上传远端；默认按配置是否就绪自动判断
 * @param opts.s3Config       注入的远端配置（测试）；默认读 settings
 * @param opts.s3             注入的 S3 实现（测试）
 */
export async function runBackupNow(opts = {}) {
  const dir = opts.dir ?? path.join(DATA_DIR, BACKUP_DIR_NAME);
  const s3 = opts.s3 ?? defaultS3Binding;
  const cfg = opts.s3Config ?? s3ConfigFromSettings();
  const uploadRemote = opts.uploadRemote ?? cfg.ready;

  let result;
  let prunedLocal = 0;
  try {
    result = await createBackupFile({ dir, now: opts.now });
    prunedLocal = pruneLocalBackups(dir).length;
  } catch (e) {
    recordOutcome(false, e.message);
    throw e;
  }

  let uploaded = false;
  let prunedRemote = [];
  if (uploadRemote) {
    if (!cfg.ready) {
      recordOutcome(false, "R2 not configured");
      const err = new Error("R2 not configured");
      err.result = { file: result.fileName };
      throw err;
    }
    try {
      const key = remoteKeyOf(cfg.prefix, result.fileName);
      await s3.putObject(cfg, key, fs.readFileSync(result.filePath), opts.opt);
      uploaded = true;
      prunedRemote = await pruneRemoteBackups(cfg, s3, opts.opt ?? {});
    } catch (e) {
      recordOutcome(false, e.message);
      e.result = { file: result.fileName, uploaded };
      throw e;
    }
  }

  recordOutcome(true);
  return {
    ok: true,
    file: result.fileName,
    bytes: result.bytes,
    prunedLocal,
    uploaded,
    prunedRemote,
  };
}

/**
 * 调度判定（纯函数）：是否应当在 now 时刻执行一次自动备份。
 * 规则（均按配置时区来判定）：
 *  - 未启用或无计划时刻 → 否；
 *  - 当天已由调度器跑过（backup_sched_date === 今天）→ 否；
 *  - 上次调度日期落后一天以上（宕机/挂机错过）→ 立即补跑；
 *  - 其余情况：已过当日的计划时刻 → 是。
 */
export function shouldRunBackup({ enabled, cronTime, lastRunDate }, now = new Date(), timeZone) {
  if (!enabled || !cronTime) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cronTime));
  if (!m) return false;
  const tz = timeZone || getTimezone();
  const today = ymd(now, tz);
  if (lastRunDate === today) return false;
  // 与上次调度日相差 ≥2 个自然日 → 中间有整天没备份（宕机等），启动即补跑
  if (lastRunDate && /^\d{4}-\d{2}-\d{2}$/.test(lastRunDate)) {
    const [y1, mo1, d1] = lastRunDate.split("-").map(Number);
    const [y2, mo2, d2] = today.split("-").map(Number);
    const dayGap = Math.floor((Date.UTC(y2, mo2 - 1, d2) - Date.UTC(y1, mo1 - 1, d1)) / 864e5);
    if (dayGap >= 2) return true;
  }
  const cronMin = Number(m[1]) * 60 + Number(m[2]);
  const curMin = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const mi = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + mi;
  })();
  return curMin >= cronMin;
}
