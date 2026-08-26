// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  confirmChat: vi.fn(),
  refreshBoot: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    chatSessions: vi.fn().mockResolvedValue({
      sessions: [{ id: "s1", title: "测试会话", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z" }],
    }),
    chatSession: vi.fn().mockResolvedValue({
      session: { id: "s1", title: "测试会话", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z" },
      status: "awaiting_confirmation",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          toolCalls: null,
          toolCallId: null,
          pending: { sql: "INSERT INTO accounts(name) VALUES('中信银行信用卡')", purpose: "新建账户", index: 0 },
          proposedSql: "INSERT INTO accounts(name) VALUES('中信银行信用卡')",
          resolved: false,
          createdAt: "2026-08-26T00:00:00Z",
        },
      ],
    }),
    confirmChat: (...args: unknown[]) => h.confirmChat(...args),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: { settings: { currencySymbol: "¥", language: "zh", aiBaseUrl: "", aiModel: "", aiKey: "k" }, accounts: [] },
    loading: false,
    lang: "zh",
    t: (k: string) => k,
    refreshBoot: h.refreshBoot,
    toast: vi.fn(),
  }),
}));

import { ChatPage } from "./ChatPage";

describe("ChatPage 确认执行后刷新全局数据", () => {
  afterEach(cleanup);
  beforeEach(() => {
    h.refreshBoot.mockReset().mockResolvedValue({});
    h.confirmChat.mockReset().mockResolvedValue({ messages: [], status: "idle", changed: false });
  });

  const openPendingCard = async () => {
    render(<ChatPage />);
    fireEvent.click(await screen.findByText("测试会话"));
    return await screen.findByText("chat_confirmBtn");
  };

  it("changed=true 时调用 refreshBoot 让侧边栏/账户页立即更新", async () => {
    h.confirmChat.mockResolvedValue({ messages: [], status: "idle", changed: true });
    const btn = await openPendingCard();
    fireEvent.click(btn);
    await waitFor(() => expect(h.confirmChat).toHaveBeenCalledWith("s1", true));
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
  });

  it("changed=false（拒绝或执行失败）时不触发 refreshBoot", async () => {
    h.confirmChat.mockResolvedValue({ messages: [], status: "idle", changed: false });
    const btn = await openPendingCard();
    fireEvent.click(btn);
    await waitFor(() => expect(h.confirmChat).toHaveBeenCalledWith("s1", true));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.refreshBoot).not.toHaveBeenCalled();
  });
});
