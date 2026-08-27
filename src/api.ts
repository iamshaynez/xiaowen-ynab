import type {
  Bootstrap,
  BudgetData,
  ReportsData,
  Tx,
  Account,
  ChatSession,
  ChatMsg,
  ChatStatus,
  ImChannel,
  ImChannelInput,
  WechatLoginState,
} from "./types";
import { getToken } from "./auth";

export class ApiError extends Error {}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new ApiError(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  authStatus: () => req<{ enabled: boolean }>("/api/auth/status"),
  login: (password: string) => req<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),

  bootstrap: () => req<Bootstrap>("/api/bootstrap"),
  loadDemo: () => req<{ ok: true }>("/api/demo", { method: "POST" }),
  saveSettings: (body: {
    currencySymbol?: string;
    language?: string;
    aiBaseUrl?: string;
    aiModel?: string;
    aiKey?: string;
    aiExtraPrompt?: string;
    backupEnabled?: boolean;
    backupCronTime?: string;
    backupR2Endpoint?: string;
    backupR2Bucket?: string;
    backupR2Prefix?: string;
    backupR2AccessKeyId?: string;
    backupR2SecretKey?: string;
  }) => req<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  aiTest: () => req<{ ok: true; model?: string }>("/api/ai/test", { method: "POST" }),

  runBackup: () =>
    req<{ ok: true; file: string; bytes: number; uploaded: boolean } | { error: string }>("/api/backup/run", {
      method: "POST",
    }),
  testBackup: () => req<{ ok: true } | { error: string }>("/api/backup/test", { method: "POST" }),

  imChannels: () => req<{ channels: ImChannel[] }>("/api/im/channels"),
  createImChannel: (body: ImChannelInput) =>
    req<{ channel: ImChannel }>("/api/im/channels", { method: "POST", body: JSON.stringify(body) }),
  updateImChannel: (id: string, body: Partial<ImChannelInput>) =>
    req<{ channel: ImChannel }>(`/api/im/channels/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteImChannel: (id: string) => req<{ ok: true }>(`/api/im/channels/${id}`, { method: "DELETE" }),
  testImChannel: (id: string) =>
    req<{ ok: true; username?: string }>(`/api/im/channels/${id}/test`, { method: "POST" }),

  // 个人微信扫码登录
  startWechatLogin: (id: string) =>
    req<WechatLoginState>(`/api/im/channels/${id}/wechat/login`, { method: "POST" }),
  wechatLoginState: (id: string) => req<WechatLoginState>(`/api/im/channels/${id}/wechat/login`),
  submitWechatVerifyCode: (id: string, code: string) =>
    req<{ ok: true }>(`/api/im/channels/${id}/wechat/login/verify`, { method: "POST", body: JSON.stringify({ code }) }),
  cancelWechatLogin: (id: string) =>
    req<{ ok: true }>(`/api/im/channels/${id}/wechat/login`, { method: "DELETE" }),

  chatSessions: () => req<{ sessions: ChatSession[] }>("/api/chat/sessions"),
  createChatSession: (title?: string) =>
    req<{ session: ChatSession }>("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title, untitled: "新会话" }) }),
  renameChatSession: (id: string, title: string) =>
    req<{ ok: true }>(`/api/chat/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChatSession: (id: string) => req<{ ok: true }>(`/api/chat/sessions/${id}`, { method: "DELETE" }),
  chatSession: (id: string) =>
    req<{ session: ChatSession; messages: ChatMsg[]; status: ChatStatus }>(`/api/chat/sessions/${id}`),
  sendChatMessage: (id: string, content: string) =>
    req<{ messages: ChatMsg[]; status: ChatStatus }>(`/api/chat/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  confirmChat: (id: string, approve: boolean) =>
    req<{ messages: ChatMsg[]; status: ChatStatus; changed?: boolean }>(`/api/chat/sessions/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ approve }),
    }),

  budget: (month: string) => req<BudgetData>(`/api/budget/${month}`),
  assign: (month: string, categoryId: string, cents: number) =>
    req<BudgetData>(`/api/budget/${month}/category/${categoryId}/assign`, {
      method: "PUT",
      body: JSON.stringify({ assigned: cents }),
    }),
  moveMoney: (month: string, fromId: string, toId: string, cents: number) =>
    req<BudgetData>(`/api/budget/${month}/move`, {
      method: "POST",
      body: JSON.stringify({ fromId, toId, amount: cents }),
    }),
  coverOverspending: (month: string, categoryId: string, fromId: string) =>
    req<BudgetData>(`/api/budget/${month}/cover`, {
      method: "POST",
      body: JSON.stringify({ categoryId, fromId }),
    }),
  autoAssign: (month: string) => req<BudgetData>(`/api/budget/${month}/auto-assign`, { method: "POST" }),
  copyLastMonth: (month: string) => req<BudgetData>(`/api/budget/${month}/copy-previous`, { method: "POST" }),

  accounts: () => req<{ accounts: Account[] }>("/api/accounts"),
  createAccount: (body: { name: string; type: string; startingBalance: number; startingDate?: string }) =>
    req<{ id: string }>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: { name?: string; closed?: boolean }) =>
    req<{ accounts: Account[] }>(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: (id: string) => req<{ accounts: Account[] }>(`/api/accounts/${id}`, { method: "DELETE" }),
  accountRegister: (id: string) =>
    req<{ account: Account & { balance: number }; transactions: Tx[] }>(`/api/accounts/${id}/transactions`),
  reconcile: (accountId: string, body?: { statementBalance?: number; markCleared?: boolean }) =>
    req<{ ok: true; adjustment: number | null }>(`/api/reconcile/${accountId}`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  transactions: (params: { search?: string; uncategorized?: boolean; accountId?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params.search) q.set("search", params.search);
    if (params.uncategorized) q.set("uncategorized", "1");
    if (params.accountId) q.set("accountId", params.accountId);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return req<{ transactions: Tx[]; total: number }>(`/api/transactions${qs ? `?${qs}` : ""}`);
  },
  createTx: (body: unknown) => req<{ ok: true }>("/api/transactions", { method: "POST", body: JSON.stringify(body) }),
  updateTx: (id: string, body: unknown) =>
    req<{ ok: true }>(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTx: (id: string) => req<{ ok: true }>(`/api/transactions/${id}`, { method: "DELETE" }),
  setTxStatus: (id: string, cleared: number) =>
    req<{ ok: true }>(`/api/transactions/${id}/cleared`, { method: "PATCH", body: JSON.stringify({ cleared }) }),
  setTxCategory: (id: string, categoryId: string | null) =>
    req<{ ok: true }>(`/api/transactions/${id}/category`, { method: "PATCH", body: JSON.stringify({ categoryId }) }),
  bulkSetCategory: (ids: string[], categoryId: string | null) =>
    req<{ ok: true; changed: number }>("/api/transactions/bulk-category", {
      method: "POST",
      body: JSON.stringify({ ids, categoryId }),
    }),
  bulkDeleteTx: (ids: string[]) =>
    req<{ ok: true; changed: number }>("/api/transactions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  addGroup: (name: string) => req<{ id: string }>("/api/category-groups", { method: "POST", body: JSON.stringify({ name }) }),
  renameGroup: (id: string, name: string) =>
    req<{ ok: true }>(`/api/category-groups/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteGroup: (id: string) => req<{ ok: true }>(`/api/category-groups/${id}`, { method: "DELETE" }),
  addCategory: (groupId: string, name: string) =>
    req<{ id: string }>("/api/categories", { method: "POST", body: JSON.stringify({ groupId, name }) }),
  renameCategory: (id: string, name: string) =>
    req<{ ok: true }>(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  updateCategory: (id: string, patch: { name?: string; note?: string }) =>
    req<{ ok: true }>(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteCategory: (id: string) => req<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" }),
  setGoal: (
    categoryId: string,
    body: { type: "monthly" | "targetBalance" | "targetByDate"; target: number; targetMonth?: string | null }
  ) => req<{ ok: true }>(`/api/goals/${categoryId}`, { method: "PUT", body: JSON.stringify(body) }),
  clearGoal: (categoryId: string) => req<{ ok: true }>(`/api/goals/${categoryId}`, { method: "PUT", body: JSON.stringify({ type: null }) }),

  reports: (months = 12) => req<ReportsData>(`/api/reports/overview?months=${months}`),
};
