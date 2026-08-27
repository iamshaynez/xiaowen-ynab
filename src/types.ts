export type Lang = "zh" | "en";

export interface Settings {
  currencySymbol: string;
  language: Lang;
  aiBaseUrl: string;
  aiModel: string;
  aiKey: string;
  /** 备份：每日定时 + Cloudflare R2 (S3 兼容) 远端 */
  backupEnabled: boolean;
  backupCronTime: string;
  backupR2Endpoint: string;
  backupR2Bucket: string;
  backupR2Prefix: string;
  backupR2AccessKeyId: string;
  /** 密钥不回传，仅返回是否已配置 */
  backupR2HasSecret: boolean;
  backupLastRunAt: string | null;
  backupLastResult: string | null;
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
  is_income: 0 | 1;
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
  incomeSources: { name: string; value: number }[];
  ageOfMoney: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview?: string | null;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: ChatToolCall[] | null;
  toolCallId: string | null;
  pending: { sql: string; purpose: string | null; index: number } | null;
  proposedSql: string | null;
  resolved: boolean;
  createdAt: string;
}

export type ChatStatus = "idle" | "awaiting_confirmation";

export type ImChannelType = "telegram" | "wechat";

export interface TelegramChannelConfig {
  token: string;
  allowedChatIds?: string[];
}

export interface WechatChannelConfig {
  /** 扫码登录后由服务端写入的 bot token */
  token: string;
  baseUrl?: string;
  userId?: string;
  botId?: string;
}

export type ImChannelConfig = TelegramChannelConfig | WechatChannelConfig;

interface ImChannelBase {
  id: string;
  name: string;
  enabled: boolean;
  cursor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramChannel extends ImChannelBase {
  type: "telegram";
  config: TelegramChannelConfig;
}

export interface WechatChannel extends ImChannelBase {
  type: "wechat";
  config: WechatChannelConfig;
}

export type ImChannel = TelegramChannel | WechatChannel;

export interface ImChannelInput {
  type: ImChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export type WechatLoginStatus =
  | "qr_ready"
  | "scanned"
  | "need_verifycode"
  | "confirmed"
  | "already_connected"
  | "timeout"
  | "failed";

export interface WechatLoginState {
  channelId: string;
  status: WechatLoginStatus;
  message?: string;
  qrcodeUrl?: string;
  qrDataUrl?: string | null;
  error?: string | null;
}
