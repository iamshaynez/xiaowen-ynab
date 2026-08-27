// 每日备份调度器：轻量轮询（30s）检查是否到达计划时刻，而非重量级 cron 解析。
// 「今天是否已跑过」持久化在 settings.backup_sched_date，重启/宕机跨天后自动补跑。
// 保存备份设置的路由负责调用 syncBackupScheduler() 使启停即时生效。
import { getSetting, setSetting, ymd } from "./db.mjs";
import { runBackupNow, shouldRunBackup } from "./backup.mjs";

const TICK_MS = 30_000;

let timer = null;
let runningJob = false;

/** 单次检查；到点则执行一次完整备份并盖当日调度戳 */
export async function tickBackupOnce() {
  if (runningJob) return false;
  const enabled = getSetting("backup_enabled", "0") === "1";
  if (!enabled) return false;
  const lastRunDate = getSetting("backup_sched_date", null);
  if (!shouldRunBackup({ enabled, cronTime: getSetting("backup_cron_time", "03:00"), lastRunDate })) return false;

  runningJob = true;
  try {
    await runBackupNow();
    console.log("[backup] scheduled backup finished");
  } catch (e) {
    console.error("[backup] scheduled backup failed:", e.message);
  } finally {
    // 成败都盖当日戳：失败信息已记录在 backup_last_result，避免每 30s 重试风暴
    setSetting("backup_sched_date", ymd(new Date()));
    runningJob = false;
  }
  return true;
}

/** 幂等：按当前设置启动/停止轮询（模式同 im/index.mjs 的 syncChannels）。
 * 不在启动时立即执行 —— 错过时刻/跨天补跑交给首个 interval tick（≤30s 内），
 * 避免每次保存设置都可能附带一次全量备份的意外副作用。 */
export function syncBackupScheduler() {
  const enabled = getSetting("backup_enabled", "0") === "1";
  if (enabled && !timer) {
    timer = setInterval(() => {
      tickBackupOnce().catch((e) => console.error("[backup] tick error:", e.message));
    }, TICK_MS);
    timer.unref?.(); // 不阻止进程退出
    console.log("[backup] scheduler started");
  } else if (!enabled && timer) {
    clearInterval(timer);
    timer = null;
    console.log("[backup] scheduler stopped");
  }
}

export function stopBackupScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 路由层读取：settings 接口的备份相关字段（密钥只回传存在性标记，绝不回传值） */
export function readBackupSettings() {
  return {
    backupEnabled: getSetting("backup_enabled", "0") === "1",
    backupCronTime: getSetting("backup_cron_time", "03:00"),
    backupR2Endpoint: getSetting("backup_r2_endpoint", ""),
    backupR2Bucket: getSetting("backup_r2_bucket", ""),
    backupR2Prefix: getSetting("backup_r2_prefix", ""),
    backupR2AccessKeyId: getSetting("backup_r2_access_key_id", ""),
    backupR2HasSecret: !!getSetting("backup_r2_secret_key", ""),
    backupLastRunAt: getSetting("backup_last_run_at", null),
    backupLastResult: getSetting("backup_last_result", null),
  };
}
