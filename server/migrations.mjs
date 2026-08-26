// 数据库 schema 迁移脚本。
// 规则：
//  - 只追加，不修改已发布的迁移（version 一旦合入就不可变）。
//  - version 必须严格递增；每个迁移在事务内执行，成功后写入 schema_migrations。
//  - up() 里尽量写成幂等或一次性变更；基线迁移用 IF NOT EXISTS 以兼容旧库。

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
];
