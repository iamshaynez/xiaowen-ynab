// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  aiTest: vi.fn(),
  imChannels: vi.fn(),
  createImChannel: vi.fn(),
  updateImChannel: vi.fn(),
  deleteImChannel: vi.fn(),
  testImChannel: vi.fn(),
  startWechatLogin: vi.fn(),
  wechatLoginState: vi.fn(),
  submitWechatVerifyCode: vi.fn(),
  cancelWechatLogin: vi.fn(),
  runBackup: vi.fn(),
  testBackup: vi.fn(),
  setLang: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    saveSettings: (...a: unknown[]) => h.saveSettings(...a),
    aiTest: (...a: unknown[]) => h.aiTest(...a),
    imChannels: (...a: unknown[]) => h.imChannels(...a),
    createImChannel: (...a: unknown[]) => h.createImChannel(...a),
    updateImChannel: (...a: unknown[]) => h.updateImChannel(...a),
    deleteImChannel: (...a: unknown[]) => h.deleteImChannel(...a),
    testImChannel: (...a: unknown[]) => h.testImChannel(...a),
    startWechatLogin: (...a: unknown[]) => h.startWechatLogin(...a),
    wechatLoginState: (...a: unknown[]) => h.wechatLoginState(...a),
    submitWechatVerifyCode: (...a: unknown[]) => h.submitWechatVerifyCode(...a),
    cancelWechatLogin: (...a: unknown[]) => h.cancelWechatLogin(...a),
    runBackup: (...a: unknown[]) => h.runBackup(...a),
    testBackup: (...a: unknown[]) => h.testBackup(...a),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: {
        currencySymbol: "¥",
        language: "zh",
        aiBaseUrl: "https://api.deepseek.com/v1",
        aiModel: "deepseek-chat",
        aiKey: "sk-test",
        aiExtraPrompt: "",
        backupEnabled: true,
        backupCronTime: "04:30",
        backupR2Endpoint: "https://acct.r2.cloudflarestorage.com",
        backupR2Bucket: "my-bucket",
        backupR2Prefix: "pre",
        backupR2AccessKeyId: "AKID-1",
        backupR2HasSecret: true,
        backupLastRunAt: "2026-08-27T03:00:05.000Z",
        backupLastResult: "ok",
      },
      accounts: [],
    },
    loading: false,
    lang: "zh",
    t: (k: string, v?: Record<string, string | number>) =>
      v ? `${k}:${JSON.stringify(v)}` : k,
    setLang: h.setLang,
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { SettingsPage } from "./SettingsPage";

const tgChannel = {
  id: "ch1",
  type: "telegram",
  name: "我的机器人",
  enabled: true,
  config: { token: "tk", allowedChatIds: ["42"] },
  cursor: null,
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const wxChannel = {
  id: "ch2",
  type: "wechat",
  name: "我的微信",
  enabled: false,
  config: {},
  cursor: null,
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.imChannels.mockResolvedValue({ channels: [tgChannel, wxChannel] });
  h.refreshBoot.mockResolvedValue({});
});

afterEach(cleanup);

describe("SettingsPage", () => {
  it("渲染 LLM 配置并预填当前值", async () => {
    render(<SettingsPage />);
    expect(await screen.findByDisplayValue("https://api.deepseek.com/v1")).toBeTruthy();
    expect(screen.getByDisplayValue("deepseek-chat")).toBeTruthy();
    expect(screen.getByDisplayValue("sk-test")).toBeTruthy();
  });

  it("保存 AI 配置调用 saveSettings 并刷新全局状态", async () => {
    h.saveSettings.mockResolvedValue({ ok: true });
    render(<SettingsPage />);
    const btn = await screen.findByRole("button", { name: "settings_aiSave" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(h.saveSettings).toHaveBeenCalledWith({
        aiBaseUrl: "https://api.deepseek.com/v1",
        aiModel: "deepseek-chat",
        aiKey: "sk-test",
        aiExtraPrompt: "",
        aiRequireConfirmation: true,
      })
    );
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
  });

  it("保存额外提示词：编辑后随 AI 配置一起提交", async () => {
    h.saveSettings.mockResolvedValue({ ok: true });
    render(<SettingsPage />);
    const textarea = (await screen.findByPlaceholderText("settings_extraPromptPlaceholder")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "我是小王，工资每月 10 号入账。" } });
    fireEvent.click(screen.getByRole("button", { name: "settings_aiSave" }));
    await waitFor(() =>
      expect(h.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ aiExtraPrompt: "我是小王，工资每月 10 号入账。" })
      )
    );
  });

  it("测试连接：先保存再调用 aiTest，成功时 toast 提示", async () => {
    h.saveSettings.mockResolvedValue({ ok: true });
    h.aiTest.mockResolvedValue({ ok: true });
    render(<SettingsPage />);
    const btn = await screen.findByRole("button", { name: "settings_testConn" });
    fireEvent.click(btn);
    await waitFor(() => expect(h.aiTest).toHaveBeenCalled());
    await waitFor(() => expect(h.toast).toHaveBeenLastCalledWith("settings_testOk", "ok"));
  });

  it("IM 渠道列表渲染，切换启用状态调用 updateImChannel", async () => {
    h.updateImChannel.mockResolvedValue({ channel: { ...tgChannel, enabled: false } });
    render(<SettingsPage />);
    const sw = await screen.findByRole("switch", { name: "ch1" });
    fireEvent.click(sw);
    await waitFor(() => expect(h.updateImChannel).toHaveBeenCalledWith("ch1", { enabled: false }));
  });

  it("添加渠道：打开弹窗、选择微信类型后提交 createImChannel（凭据由扫码登录写入）", async () => {
    h.createImChannel.mockResolvedValue({ channel: {} });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "settings_addChannel" }));
    const nameInput = await screen.findByLabelText("settings_channelName");
    fireEvent.change(nameInput, { target: { value: "我的微信" } });
    fireEvent.change(screen.getByLabelText("settings_channelType"), { target: { value: "wechat" } });
    fireEvent.click(screen.getByRole("button", { name: "channel_submit" }));
    await waitFor(() =>
      expect(h.createImChannel).toHaveBeenCalledWith({
        type: "wechat",
        name: "我的微信",
        enabled: false,
        config: {},
      })
    );
  });

  it("删除渠道前确认，确认后调用 deleteImChannel", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    h.deleteImChannel.mockResolvedValue({ ok: true });
    render(<SettingsPage />);
    const delBtn = await screen.findByRole("button", { name: "del-ch1" });
    fireEvent.click(delBtn);
    await waitFor(() => expect(h.deleteImChannel).toHaveBeenCalledWith("ch1"));
  });

  it("微信渠道点击扫码登录：发起登录、需要配对码时输入并提交", async () => {
    h.startWechatLogin.mockResolvedValue({
      channelId: "ch2",
      status: "need_verifycode",
      qrDataUrl: "data:image/png;base64,xxx",
      message: "settings_verifyPrompt",
    });
    h.wechatLoginState.mockResolvedValue({ channelId: "ch2", status: "need_verifycode" });
    h.submitWechatVerifyCode.mockResolvedValue({ ok: true });

    render(<SettingsPage />);
    const loginBtn = await screen.findByRole("button", { name: "login-ch2" });
    fireEvent.click(loginBtn);

    // 弹窗展示二维码
    expect(await screen.findByAltText("qrcode")).toBeTruthy();
    // 提交配对码
    const codeInput = await screen.findByLabelText("settings_verifyPrompt");
    fireEvent.change(codeInput, { target: { value: "8877" } });
    fireEvent.click(screen.getByRole("button", { name: "verify_submit" }));
    await waitFor(() => expect(h.submitWechatVerifyCode).toHaveBeenCalledWith("ch2", "8877"));
  });

  it("未绑定的微信渠道显示扫码提示，已绑定的显示用户标识", async () => {
    h.imChannels.mockResolvedValue({
      channels: [
        wxChannel,
        { ...wxChannel, id: "ch3", config: { token: "t", userId: "wx-user-9" }, enabled: true },
      ],
    });
    render(<SettingsPage />);
    expect(await screen.findByText("settings_notBound")).toBeTruthy();
    expect(await screen.findByText(/wx-user-9/)).toBeTruthy();
  });

  it("备份卡片：预填当前配置，密钥留空仅作占位", async () => {
    render(<SettingsPage />);
    const time = (await screen.findByLabelText("settings_backupTime")) as HTMLInputElement;
    expect(time.value).toBe("04:30");
    expect(screen.getByDisplayValue("https://acct.r2.cloudflarestorage.com")).toBeTruthy();
    expect(screen.getByDisplayValue("my-bucket")).toBeTruthy();
    expect(screen.getByDisplayValue("AKID-1")).toBeTruthy();
    const secret = screen.getByLabelText("settings_backupSecretKey") as HTMLInputElement;
    expect(secret.value).toBe("");
    const enable = screen.getByLabelText("settings_backupEnable") as HTMLInputElement;
    expect(enable.checked).toBe(true);
  });

  it("保存备份设置：提交当前表单值，密钥为空字符串（保持不变）", async () => {
    h.saveSettings.mockResolvedValue({ ok: true });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "backup_save" }));
    await waitFor(() =>
      expect(h.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          backupEnabled: true,
          backupCronTime: "04:30",
          backupR2Endpoint: "https://acct.r2.cloudflarestorage.com",
          backupR2Bucket: "my-bucket",
          backupR2AccessKeyId: "AKID-1",
          backupR2SecretKey: "",
        })
      )
    );
  });

  it("立即备份调用 runBackup 并刷新状态", async () => {
    h.runBackup.mockResolvedValue({ ok: true, file: "budget-x.sql.gz", bytes: 1, uploaded: true });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "backup_run" }));
    await waitFor(() => expect(h.runBackup).toHaveBeenCalled());
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
  });
});
