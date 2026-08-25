import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "budget.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

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
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, String(value));
}

if (!getSetting("initialized")) {
  setSetting("currency_symbol", "¥");
  setSetting("language", "zh");
  seedDefaultCategories();
  setSetting("initialized", "1");
}

function seedDefaultCategories() {
  const groups = [
    ["日常开销", ["食品杂货", "餐饮外出", "交通出行", "日用百货", "话费网费"]],
    ["账单", ["房租房贷", "水电燃气", "订阅服务", "医疗保险"]],
    ["储蓄目标", ["应急基金", "旅行基金", "大额购物", "投资理财"]],
    ["其他支出", ["医疗健康", "学习提升", "人情往来", "宠物花费", "其他"]],
  ];
  const insG = db.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,?)");
  const insC = db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)");
  const tx = db.transaction(() => {
    groups.forEach(([gname, cats], gi) => {
      const gid = uid();
      insG.run(gid, gname, gi);
      cats.forEach((cname, ci) => insC.run(uid(), gid, cname, ci));
    });
  });
  tx();
}

const CREDIT_TYPES = new Set(["creditCard", "lineOfCredit", "studentLoan", "personalLoan", "otherLiability"]);
const ACCOUNT_TYPES = [
  { type: "checking", onBudget: 1 },
  { type: "savings", onBudget: 1 },
  { type: "cash", onBudget: 1 },
  { type: "creditCard", onBudget: 1 },
  { type: "lineOfCredit", onBudget: 0 },
  { type: "investment", onBudget: 0 },
  { type: "property", onBudget: 0 },
  { type: "vehicle", onBudget: 0 },
  { type: "otherAsset", onBudget: 0 },
  { type: "studentLoan", onBudget: 0 },
  { type: "personalLoan", onBudget: 0 },
  { type: "otherLiability", onBudget: 0 },
];
export const isCreditType = (t) => CREDIT_TYPES.has(t);

export function createAccount({ name, type, startingBalance = 0, startingDate = null }) {
  const meta = ACCOUNT_TYPES.find((a) => a.type === type);
  if (!meta) throw new Error("invalid account type");
  const id = uid();
  db.prepare(
    "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at) VALUES(?,?,?,?,0,?,?,?,?)"
  ).run(id, name, type, meta.onBudget, Math.round(startingBalance), startingDate || ymd(new Date()), Date.now(), nowIso());
  if (startingBalance !== 0) {
    db.prepare(
      "INSERT INTO transactions(id,account_id,date,payee_name,amount,cleared,reconciled,is_start,created_at) VALUES(?,?,?,?,?,1,0,1,?)"
    ).run(uid(), id, startingDate || ymd(new Date()), "__starting__", Math.round(startingBalance), nowIso());
  }
  return id;
}

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function endOfMonth(ymStr) {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, m, 0);
  return ymd(d);
}

export function todayYmd() {
  return ymd(new Date());
}

export function currentMonth() {
  return todayYmd().slice(0, 7);
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadDemoData() {
  const rand = mulberry32(20260825);
  const yuan = (v) => Math.round(v * 100);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const accounts = {};
  accounts.bank = createAccount({ name: "招商银行储蓄卡", type: "checking", startingBalance: yuan(9600), startingDate: "2026-02-25" });
  accounts.alipay = createAccount({ name: "支付宝", type: "cash", startingBalance: yuan(680), startingDate: "2026-02-25" });
  accounts.wechat = createAccount({ name: "微信钱包", type: "cash", startingBalance: yuan(420), startingDate: "2026-02-25" });
  accounts.save = createAccount({ name: "定期储蓄账户", type: "savings", startingBalance: yuan(18000), startingDate: "2026-02-25" });
  accounts.credit = createAccount({ name: "平安银行信用卡", type: "creditCard", startingBalance: yuan(-2360), startingDate: "2026-02-25" });
  accounts.invest = createAccount({ name: "指数基金组合", type: "investment", startingBalance: yuan(52000), startingDate: "2026-02-25" });

  const cats = {};
  for (const c of db.prepare("SELECT c.id, c.name, g.name AS g FROM categories c JOIN category_groups g ON g.id=c.group_id").all()) {
    cats[c.name] = c.id;
  }

  const insTx = db.prepare(
    "INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)"
  );
  let clock = Date.now();
  const addTx = (accountId, date, payee, amount, categoryId = null, memo = "", transferTo = null, cleared = 1) => {
    const id = uid();
    insTx.run(id, accountId, date, payee, transferTo, categoryId, memo, Math.round(amount), cleared, 0, ++clock);
    if (transferTo) {
      insTx.run(uid(), transferTo, date, "", accountId, null, memo, -Math.round(amount), cleared, 0, ++clock);
    }
    return id;
  };

  const groceryPayees = ["盒马鲜生", "永辉超市", "美团买菜", "山姆会员店"];
  const diningPayees = ["麦当劳", "海底捞", "美团外卖", "瑞幸咖啡", "兰州拉面", "肯德基"];
  const transportPayees = ["滴滴出行", "地铁充值", "哈啰单车"];

  const monthsBack = 6;
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) months.push(addMonths(thisMonth, -i));

  const assign = db.prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?) ON CONFLICT(month,category_id) DO UPDATE SET assigned=excluded.assigned");
  const setGoal = db.prepare("INSERT INTO goals(category_id,type,target,target_month) VALUES(?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET type=excluded.type,target=excluded.target,target_month=excluded.target_month");

  setGoal.run(cats["应急基金"], "targetBalance", yuan(30000), null);
  setGoal.run(cats["旅行基金"], "targetByDate", yuan(12000), "2027-02-01");
  for (const b of ["房租房贷", "水电燃气", "订阅服务", "医疗保险"]) setGoal.run(cats[b], "monthly", 0, null);

  const tx = db.transaction(() => {
    for (const m of months) {
      const [Y, M] = m.split("-").map(Number);
      const dim = new Date(Y, M, 0).getDate();
      const D = (day) => `${m}-${String(Math.min(day, dim)).padStart(2, "0")}`;

      assign.run(m, cats["食品杂货"], yuan(1400));
      assign.run(m, cats["餐饮外出"], yuan(900));
      assign.run(m, cats["交通出行"], yuan(300));
      assign.run(m, cats["日用百货"], yuan(250));
      assign.run(m, cats["话费网费"], yuan(150));
      assign.run(m, cats["房租房贷"], yuan(4200));
      assign.run(m, cats["水电燃气"], yuan(300));
      assign.run(m, cats["订阅服务"], yuan(60));
      assign.run(m, cats["医疗保险"], yuan(220));
      assign.run(m, cats["应急基金"], yuan(1600));
      assign.run(m, cats["旅行基金"], yuan(700));
      assign.run(m, cats["医疗健康"], yuan(100));

      addTx(accounts.bank, D(10), "公司发薪", yuan(12800 + Math.floor(rand() * 600)), null, "工资入账");

      addTx(accounts.bank, D(1), "房东张女士", -yuan(4200), cats["房租房贷"]);
      addTx(accounts.bank, D(16), "供电局", -yuan(120 + rand() * 160), cats["水电燃气"]);
      addTx(accounts.bank, D(17), "燃气公司", -yuan(45 + rand() * 60), cats["水电燃气"]);
      addTx(accounts.bank, D(18), "中国电信", -yuan(88), cats["话费网费"]);
      addTx(accounts.bank, D(19), "中国移动", -yuan(39), cats["话费网费"]);
      addTx(accounts.bank, D(21), "iCloud+ Netflix", -yuan(52), cats["订阅服务"]);
      addTx(accounts.bank, D(22), "平安保险", -yuan(210), cats["医疗保险"]);

      addTx(accounts.bank, D(2), "转账", -yuan(2200), null, "充值", accounts.alipay);
      addTx(accounts.bank, D(9), "转账", -yuan(900), null, "充值", accounts.wechat);

      for (let w = 0; w < 4; w++) {
        const acct = rand() < 0.55 ? accounts.credit : accounts.alipay;
        addTx(acct, D(3 + w * 7 + Math.floor(rand() * 3)), pick(groceryPayees), -yuan(240 + rand() * 260), cats["食品杂货"]);
      }
      for (let k = 0; k < 7; k++) {
        const acct = rand() < 0.65 ? accounts.credit : accounts.wechat;
        addTx(acct, D(1 + Math.floor(rand() * dim)), pick(diningPayees), -yuan(22 + rand() * 110), cats["餐饮外出"]);
        if (rand() < 0.55) addTx(accounts.wechat, D(1 + Math.floor(rand() * dim)), pick(transportPayees), -yuan(8 + rand() * 40), cats["交通出行"]);
      }
      addTx(rand() < 0.5 ? accounts.credit : accounts.alipay, D(12), "屈臣氏", -yuan(60 + rand() * 190), cats["日用百货"]);

      addTx(accounts.bank, D(25), "转账", -yuan(1500), null, "月度储蓄", accounts.save);
      addTx(accounts.bank, D(28), "信用卡还款", -yuan(1300), null, "还上月账单", accounts.credit);
      assign.run(m, `cc:${accounts.credit}`, yuan(500));
      if (rand() < 0.35) addTx(accounts.credit, D(5 + Math.floor(rand() * 20)), pick(diningPayees), yuan(35), cats["餐饮外出"], "退款");
      if (rand() < 0.3) addTx(accounts.wechat, D(Math.floor(dim / 2)), "亲戚红包", yuan(50 + rand() * 350), cats["人情往来"] === undefined ? null : cats["人情往来"], "收到红包");
    }
    addTx(accounts.bank, "2026-05-08", "证券转出", -yuan(3000), cats["投资理财"], "加仓定投", accounts.invest);
    addTx(accounts.bank, "2026-08-06", "证券转出", -yuan(3000), cats["投资理财"], "加仓定投", accounts.invest);
  });
  tx();
}

export { CREDIT_TYPES, ACCOUNT_TYPES };
