// 数据库 schema 迁移脚本。
// 规则：
//  - 只追加，不修改已发布的迁移（version 一旦合入就不可变）。
//  - version 必须严格递增；每个迁移在事务内执行，成功后写入 schema_migrations。
//  - up() 里尽量写成幂等或一次性变更；基线迁移用 IF NOT EXISTS 以兼容旧库。

import crypto from "node:crypto";

export const migrations = [
  {
    version: 1,
    name: "baseline-schema",
    up: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  on_budget INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  starting_balance INTEGER NOT NULL DEFAULT 0,
  starting_balance_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS category_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goals (
  category_id TEXT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 0,
  target_month TEXT
);
CREATE TABLE IF NOT EXISTS assignments (
  month TEXT NOT NULL,
  category_id TEXT NOT NULL,
  assigned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, category_id)
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  payee_name TEXT,
  transfer_account_id TEXT,
  category_id TEXT,
  memo TEXT,
  amount INTEGER NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0,
  reconciled INTEGER NOT NULL DEFAULT 0,
  is_start INTEGER NOT NULL DEFAULT 0,
  pair_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  pending_sql TEXT,
  pending_purpose TEXT,
  pending_index INTEGER,
  resolved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at);
`);
    },
  },
  // 示例：下一个迁移这样写 ——
  // {
  //   version: 2,
  //   name: "add-tx-tags",
  //   up: (db) => {
  //     db.exec("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  //   },
  // },
  {
    // v1 的 accounts/transactions 把 created_at 定义为无默认值的 NOT NULL，
    // 导致 AI 生成的省略该列的 INSERT 全部失败（NOT NULL constraint failed）。
    // SQLite 无法直接修改列默认值，需按官方流程重建表（外键已在迁移期间关闭）。
    version: 2,
    name: "default-created-at",
    up: (db) => {
      const CREATED_AT_DEFAULT = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
      db.exec(`
CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  on_budget INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  starting_balance INTEGER NOT NULL DEFAULT 0,
  starting_balance_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at ${CREATED_AT_DEFAULT}
);
INSERT INTO accounts_new(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at)
  SELECT id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  payee_name TEXT,
  transfer_account_id TEXT,
  category_id TEXT,
  memo TEXT,
  amount INTEGER NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0,
  reconciled INTEGER NOT NULL DEFAULT 0,
  is_start INTEGER NOT NULL DEFAULT 0,
  pair_id TEXT,
  created_at ${CREATED_AT_DEFAULT}
);
INSERT INTO transactions_new(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
  SELECT id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
`);
    },
  },
  {
    // IM 渠道（微信 / Telegram）接入：
    //  - im_channels 存储渠道配置（JSON），cursor 记录 Telegram getUpdates 的 offset。
    //  - chat_sessions 增加 channel/external_id，把外部 IM 会话映射到内部会话。
    version: 3,
    name: "im-channels",
    up: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS im_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  cursor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE chat_sessions ADD COLUMN channel TEXT NOT NULL DEFAULT 'web';
ALTER TABLE chat_sessions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_channel ON chat_sessions(channel, external_id);
`);
    },
  },
  {
    // IM /new 命令：同一外部用户可拥有多个历史会话（rowid 最大者为当前会话），
    // 因此把 (channel, external_id) 的唯一索引降级为普通查询索引。
    version: 4,
    name: "im-session-history",
    up: (db) => {
      db.exec(`
DROP INDEX IF EXISTS idx_chat_sessions_channel;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_channel_lookup ON chat_sessions(channel, external_id);
`);
    },
  },
  {
    // 收入分类体系（方案 B）：
    //  - category_groups 增加 is_income 标志；
    //  - 种子「收入」组与常用收入来源分类；若用户已有同名组则收编（置标志、补分类），不重复建组；
    //  - 存量按旧约定记录的收入（category_id IS NULL AND amount>0 的非期初、非转账行）
    //    迁移到「其他收入」，让 NULL 回归纯粹的“未分类待处理”语义。
    version: 5,
    name: "income-categories",
    up: (db) => {
      db.exec("ALTER TABLE category_groups ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0");

      const INCOME_GROUP = "收入";
      const INCOME_CATS = ["工资薪酬", "奖金", "理财收益", "红包礼金", "其他收入"];
      let gid;
      const existing = db.prepare("SELECT id FROM category_groups WHERE name=?").get(INCOME_GROUP);
      if (existing) {
        gid = existing.id;
        db.prepare("UPDATE category_groups SET is_income=1 WHERE id=?").run(gid);
      } else {
        gid = crypto.randomUUID();
        const minOrder = db.prepare("SELECT COALESCE(MIN(sort_order),0) m FROM category_groups").get().m;
        db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,1)").run(gid, INCOME_GROUP, minOrder - 1);
      }

      const insC = db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)");
      const maxOrder = () => db.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM categories WHERE group_id=?").get(gid).m;
      let order = maxOrder();
      for (const name of INCOME_CATS) {
        const has = db.prepare("SELECT 1 FROM categories WHERE group_id=? AND name=?").get(gid, name);
        if (!has) insC.run(crypto.randomUUID(), gid, name, ++order);
      }

      const otherIncomeId = db
        .prepare("SELECT id FROM categories WHERE group_id=? AND name='其他收入'")
        .get(gid).id;
      db.prepare(
        `UPDATE transactions SET category_id=?
          WHERE category_id IS NULL AND amount>0 AND is_start=0 AND transfer_account_id IS NULL`
      ).run(otherIncomeId);
    },
  },
  {
    // 对账完成功能：
    //  - is_reconcile_adjustment 标记差额兜底流水（对账输入实际余额与计算余额不等时自动创建），
    //    该类流水 category_id 为 NULL —— 影响未分配（Ready to Assign），但不计入「未分类」提醒。
    version: 6,
    name: "reconcile-flag",
    up: (db) => {
      db.exec("ALTER TABLE transactions ADD COLUMN is_reconcile_adjustment INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // 分类备注：每个预算分类附带一段长文本备注（YNAB 式 note），在预算页右侧检查器中维护。
    version: 7,
    name: "category-note",
    up: (db) => {
      db.exec("ALTER TABLE categories ADD COLUMN note TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    // 思考型模型（Kimi K2.x / DeepSeek / Qwen3 / GLM 等）会在 assistant 消息里额外返回
    // reasoning_content（思考轨迹）。续跑时它们的 API 要求把该字段原样回传，
    // 否则返回 400「The reasoning content in the thinking mode must be passed back to the API」。
    // 这里给 chat_messages 增加该列，供 runAgent 持久化、buildLlmMessages 重建历史时回传。
    version: 8,
    name: "chat-reasoning-content",
    up: (db) => {
      db.exec("ALTER TABLE chat_messages ADD COLUMN reasoning_content TEXT");
    },
  },
];
