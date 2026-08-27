import { db, addMonths, endOfMonth, currentMonth, todayYmd } from "./db.mjs";

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function earliestMonth() {
  const cands = [currentMonth()];
  const t = db.prepare("SELECT MIN(date) d FROM transactions").get();
  const s = db.prepare("SELECT MIN(starting_balance_date) d FROM accounts WHERE starting_balance<>0").get();
  const a = db.prepare("SELECT MIN(month) m FROM assignments").get();
  if (t?.d) cands.push(t.d.slice(0, 7));
  if (s?.d) cands.push(s.d.slice(0, 7));
  if (a?.m) cands.push(a.m);
  return cands.sort()[0];
}

export function listMonths(uptoMonth) {
  const months = [];
  let m = earliestMonth();
  while (m <= uptoMonth && months.length < 600) {
    months.push(m);
    m = addMonths(m, 1);
  }
  return months;
}

export function getAccounts() {
  return db.prepare("SELECT * FROM accounts ORDER BY sort_order, created_at").all();
}

export function accountBalances() {
  const rows = db
    .prepare(
      `SELECT a.id,
              a.starting_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0),0) AS balance
       FROM accounts a`
    )
    .all();
  const map = new Map();
  for (const r of rows) map.set(r.id, r.balance);
  return map;
}

export function computeBudget(uptoMonth) {
  const months = listMonths(uptoMonth);
  const txRows = db
    .prepare(
      `SELECT t.*, a.on_budget AS ob, a.type AS atype
       FROM transactions t JOIN accounts a ON a.id = t.account_id`
    )
    .all();
  const assignRows = db.prepare("SELECT * FROM assignments").all();

  const txByMonth = new Map();
  for (const t of txRows) {
    if (!t.ob) continue;
    const m = t.date.slice(0, 7);
    if (!txByMonth.has(m)) txByMonth.set(m, []);
    txByMonth.get(m).push(t);
  }
  const assignByMonth = new Map();
  for (const r of assignRows) {
    if (!assignByMonth.has(r.month)) assignByMonth.set(r.month, new Map());
    assignByMonth.get(r.month).set(r.category_id, r.assigned);
  }

  const realCats = db.prepare("SELECT id FROM categories").all().map((r) => r.id);
  const incomeCats = new Set(
    db
      .prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=1")
      .all()
      .map((r) => r.id)
  );
  const budgetCats = realCats.filter((id) => !incomeCats.has(id));
  const ccAccounts = db
    .prepare("SELECT id FROM accounts WHERE type IN ('creditCard','lineOfCredit') AND on_budget=1")
    .all()
    .map((r) => r.id);

  const catIds = () => {
    const s = new Set(budgetCats);
    for (const c of ccAccounts) s.add(`cc:${c}`);
    return s;
  };

  let carry = 0;
  let prevAvail = new Map();
  const results = new Map();

  for (const month of months) {
    const monthTx = txByMonth.get(month) || [];
    const assigns = assignByMonth.get(month) || new Map();

    let inflow = 0;
    let uncatOutflow = 0;
    const activity = new Map();
    const ids = catIds();
    for (const id of ids) activity.set(id, 0);

    for (const t of monthTx) {
      if (t.is_start) {
        // 期初余额：预算内账户的初始资金计入可分配资金（正增负减）
        inflow += t.amount;
        continue;
      }
      const isCC = t.atype === "creditCard" || t.atype === "lineOfCredit";
      const ccp = `cc:${t.account_id}`;
      if (isCC) {
        if (t.transfer_account_id) {
          if (t.amount > 0) activity.set(ccp, (activity.get(ccp) || 0) - t.amount);
        } else if (t.category_id) {
          activity.set(t.category_id, (activity.get(t.category_id) || 0) + t.amount);
          activity.set(ccp, (activity.get(ccp) || 0) - t.amount);
        }
        continue;
      }
      if (t.transfer_account_id) continue;
      if (t.category_id == null) {
        if (t.amount > 0) inflow += t.amount;
        else uncatOutflow += -t.amount;
        continue;
      }
      if (incomeCats.has(t.category_id)) {
        inflow += t.amount;
        activity.set(t.category_id, (activity.get(t.category_id) || 0) + t.amount);
        continue;
      }
      activity.set(t.category_id, (activity.get(t.category_id) || 0) + t.amount);
    }

    let assignedTotal = 0;
    const assignedMap = new Map();
    for (const id of ids) {
      const a = assigns.get(id) || 0;
      assignedMap.set(id, a);
      assignedTotal += a;
    }

    let rta = carry + inflow - assignedTotal - uncatOutflow;

    const avail = new Map();
    let overspent = 0;
    for (const id of ids) {
      const v = Math.max(prevAvail.get(id) || 0, 0) + assignedMap.get(id) + activity.get(id);
      avail.set(id, v);
      if (v < 0) overspent += v;
    }
    rta += overspent;

    results.set(month, {
      month,
      inflow,
      assignedTotal,
      readyToAssign: rta,
      assigned: Object.fromEntries(assignedMap),
      activity: Object.fromEntries(activity),
      available: Object.fromEntries(avail),
    });

    const nextPrev = new Map();
    for (const id of ids) nextPrev.set(id, Math.max(avail.get(id), 0));
    prevAvail = nextPrev;
    carry = rta;
  }

  return { months, byMonth: results };
}

export function goalNeed(goal, available, month, lastAssigned, avgSpend) {
  if (!goal) return null;
  if (goal.type === "monthly") {
    const target = goal.target > 0 ? goal.target : Math.max(lastAssigned || 0, Math.ceil(avgSpend || 0));
    if (target <= 0) return null;
    return { need: Math.max(target - Math.max(available, 0), 0), target, type: goal.type };
  }
  if (goal.type === "targetBalance") {
    return { need: Math.max(goal.target - Math.max(available, 0), 0), target: goal.target, type: goal.type };
  }
  if (goal.type === "targetByDate") {
    if (!goal.target_month) return null;
    let diff =
      (Number(goal.target_month.slice(0, 4)) - Number(month.slice(0, 4))) * 12 +
      (Number(goal.target_month.slice(5, 7)) - Number(month.slice(5, 7)));
    const monthsLeft = Math.max(diff, 0) + 1;
    const need = Math.ceil(Math.max(goal.target - Math.max(available, 0), 0) / monthsLeft);
    return { need, target: goal.target, type: goal.type, targetMonth: goal.target_month, monthsLeft };
  }
  return null;
}

export function categoryMeta() {
  const cats = db
    .prepare(
      `SELECT c.*, g.name AS group_name, g.hidden AS group_hidden, g.sort_order AS group_order,
              g.id AS gid
       FROM categories c JOIN category_groups g ON g.id=c.group_id
       ORDER BY g.sort_order, c.sort_order`
    )
    .all();
  return cats;
}

export function ageOfMoney() {
  const rows = db
    .prepare(
      `SELECT t.date, t.amount FROM transactions t JOIN accounts a ON a.id=t.account_id
       WHERE a.on_budget=1 AND a.type NOT IN ('creditCard','lineOfCredit') AND t.is_start=0
         AND t.transfer_account_id IS NULL
       ORDER BY t.date, t.rowid`
    )
    .all();
  const queue = [];
  for (const t of rows) {
    if (t.amount > 0) queue.push({ date: t.date, left: t.amount });
    else {
      let spend = -t.amount;
      while (spend > 0 && queue.length) {
        const q = queue[0];
        const use = Math.min(q.left, spend);
        q.left -= use;
        spend -= use;
        if (q.left <= 0) queue.shift();
      }
    }
  }
  if (!queue.length) return 0;
  return Math.max(daysBetween(queue[0].date, todayYmd()), 0);
}

export function reportsOverview(countMonths = 12) {
  const cur = currentMonth();
  const months = [];
  for (let i = countMonths - 1; i >= 0; i--) months.push(addMonths(cur, -i));

  const accts = getAccounts();
  const balById = accountBalances();
  let assets = 0;
  let liabilities = 0;
  const accountList = accts.map((a) => {
    const b = balById.get(a.id) || 0;
    const isLiab = ["creditCard", "lineOfCredit", "studentLoan", "personalLoan", "otherLiability"].includes(a.type);
    if (isLiab) liabilities += b;
    else assets += b;
    return { ...a, balance: b };
  });

  const txRows = db
    .prepare(
      `SELECT t.*, a.on_budget AS ob, a.type AS atype
       FROM transactions t JOIN accounts a ON a.id=t.account_id`
    )
    .all();

  const incomeByM = new Map();
  const expenseByM = new Map();
  for (const m of months) {
    incomeByM.set(m, 0);
    expenseByM.set(m, 0);
  }

  const incomeCatIds = new Set(
    db
      .prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=1")
      .all()
      .map((r) => r.id)
  );
  const isIncome = (catId) => (catId ? incomeCatIds.has(catId) : true);

  for (const t of txRows) {
    if (!t.ob || t.is_start) continue;
    const m = t.date.slice(0, 7);
    if (!incomeByM.has(m)) continue;
    if (t.transfer_account_id) continue;
    if (isIncome(t.category_id)) incomeByM.set(m, incomeByM.get(m) + t.amount);
    else if (t.amount < 0) expenseByM.set(m, expenseByM.get(m) - t.amount);
  }

  const netWorth = [];
  for (const m of months) {
    const eom = endOfMonth(m);
    let a = 0;
    let l = 0;
    for (const acc of accts) {
      let b = acc.starting_balance;
      b += txRows.reduce((s, t) => (t.account_id === acc.id && t.date <= eom && !t.is_start ? s + t.amount : s), 0);
      const isLiab = ["creditCard", "lineOfCredit", "studentLoan", "personalLoan", "otherLiability"].includes(acc.type);
      if (b >= 0) a += b;
      else l += b;
    }
    netWorth.push({ month: m, assets: a, liabilities: l, net: a + l });
  }

  const firstM = months[0];
  const breakdown = new Map();
  const payeeMap = new Map();
  const incomeSourceMap = new Map();
  const catNames = new Map(db.prepare("SELECT id,name FROM categories").all().map((r) => [r.id, r.name]));
  for (const t of txRows) {
    if (!t.ob || t.is_start || t.transfer_account_id) continue;
    const m = t.date.slice(0, 7);
    if (m < firstM || m > cur) continue;
    if (t.amount < 0) {
      if (t.category_id) breakdown.set(t.category_id, (breakdown.get(t.category_id) || 0) - t.amount);
      const p = (t.payee_name || "").trim();
      if (p && p !== "__starting__" && p !== "__reconciling__") payeeMap.set(p, (payeeMap.get(p) || 0) - t.amount);
    } else if (t.category_id && incomeCatIds.has(t.category_id)) {
      incomeSourceMap.set(t.category_id, (incomeSourceMap.get(t.category_id) || 0) + t.amount);
    }
  }

  return {
    months,
    income: months.map((m) => ({ month: m, value: incomeByM.get(m) })),
    expense: months.map((m) => ({ month: m, value: expenseByM.get(m) })),
    netWorth,
    accounts: accountList,
    totalAssets: assets,
    totalLiabilities: liabilities,
    netWorthNow: assets + liabilities,
    breakdown: [...breakdown.entries()]
      .map(([id, value]) => ({ name: catNames.get(id) || id, value }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 10),
    topPayees: [...payeeMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 8),
    incomeSources: [...incomeSourceMap.entries()]
      .map(([id, value]) => ({ name: catNames.get(id) || id, value }))
      .sort((x, y) => y.value - x.value),
    ageOfMoney: ageOfMoney(),
  };
}
