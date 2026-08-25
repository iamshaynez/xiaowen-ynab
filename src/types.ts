export type Lang = "zh" | "en";

export interface Settings {
  currencySymbol: string;
  language: Lang;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  on_budget: 0 | 1;
  closed: 0 | 1;
  starting_balance: number;
  starting_balance_date: string | null;
  sort_order: number;
  created_at: string;
  balance: number;
}

export interface Goal {
  category_id: string;
  type: "monthly" | "targetBalance" | "targetByDate";
  target: number;
  target_month: string | null;
}

export interface Category {
  id: string;
  group_id: string;
  name: string;
  sort_order: number;
  hidden: 0 | 1;
  goal: Goal | null;
}

export interface CategoryGroup {
  id: string;
  name: string;
  sort_order: number;
  hidden: 0 | 1;
  categories: Category[];
}

export interface Bootstrap {
  settings: Settings;
  accounts: Account[];
  payees: string[];
  groups: CategoryGroup[];
  currentMonth: string;
}

export interface Need {
  need: number;
  target: number;
  type: Goal["type"];
  targetMonth?: string;
  monthsLeft?: number;
}

export interface BudCategory {
  id: string;
  name?: string;
  accountId?: string;
  assigned: number;
  activity: number;
  available: number;
  goal: Goal | null;
  need: Need | null;
  lastAssigned: number;
  avgSpend: number;
}

export interface BudGroup {
  id: string;
  name: string;
  virtual: boolean;
  categories: BudCategory[];
}

export interface BudgetData {
  month: string;
  months: string[];
  maxMonth: string;
  readyToAssign: number;
  incomeThisMonth: number;
  assignedTotal: number;
  overspentTotal: number;
  uncategorizedCount: number;
  groups: BudGroup[];
  ageOfMoney: number;
}

export interface Tx {
  id: string;
  accountId: string;
  date: string;
  payeeName: string | null;
  isStart: boolean;
  transferAccountId: string | null;
  otherAccountName: string | null;
  otherAccountType: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string | null;
  amount: number;
  cleared: 0 | 1;
  reconciled: 0 | 1;
  balance?: number;
  account_name?: string;
}

export interface ReportsData {
  months: string[];
  income: { month: string; value: number }[];
  expense: { month: string; value: number }[];
  netWorth: { month: string; assets: number; liabilities: number; net: number }[];
  accounts: Account[];
  totalAssets: number;
  totalLiabilities: number;
  netWorthNow: number;
  breakdown: { name: string; value: number }[];
  topPayees: { name: string; value: number }[];
  ageOfMoney: number;
}
