import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import type { ImChannel, ImChannelType, Lang, WechatLoginState } from "../types";
import { Btn, Modal, inputCls } from "../components/ui";

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
        {desc && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">{desc}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function SettingsPage() {
  const { boot, lang, setLang, t, toast, refreshBoot } = useApp();

  /* ------------------------- 通用 ------------------------- */
  const [symbol, setSymbol] = useState(boot?.settings.currencySymbol ?? "¥");

  const saveGeneral = async () => {
    await api.saveSettings({ currencySymbol: symbol });
    await refreshBoot();
    toast(t("settings_savedOk"));
  };

  /* ------------------------- AI / LLM ------------------------- */
  const [aiBaseUrl, setAiBaseUrl] = useState(boot?.settings.aiBaseUrl ?? "");
  const [aiModel, setAiModel] = useState(boot?.settings.aiModel ?? "");
  const [aiKey, setAiKey] = useState(boot?.settings.aiKey ?? "");
  const [testing, setTesting] = useState(false);
  const configured = !!boot?.settings.aiKey;

  const saveAi = async () => {
    await api.saveSettings({ aiBaseUrl: aiBaseUrl.trim(), aiModel: aiModel.trim(), aiKey: aiKey.trim() });
    await refreshBoot();
    toast(t("settings_savedOk"));
  };

  const testAi = async () => {
    setTesting(true);
    try {
      await saveAi();
      await api.aiTest();
      toast(t("settings_testOk"), "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setTesting(false);
    }
  };

  /* ------------------------- IM 渠道 ------------------------- */
  const [channels, setChannels] = useState<ImChannel[] | null>(null);
  const [editing, setEditing] = useState<ImChannel | "new" | null>(null);
  const [loginFor, setLoginFor] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const { channels: list } = await api.imChannels();
      setChannels(list);
    } catch {
      setChannels([]);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-8">
      <h1 className="text-lg font-bold text-slate-800">{t("settings_title")}</h1>

      <Card title={t("settings_general")}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_language")}</span>
            <div className="flex overflow-hidden rounded-full border border-slate-200 p-0.5">
              {(["zh", "en"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${
                    lang === l ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {l === "zh" ? "中文" : "EN"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_currencyLabel")}</span>
            <div className="flex items-center gap-2">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.slice(0, 3))}
                className={`${inputCls} w-20 text-center`}
              />
              <Btn onClick={saveGeneral}>{t("common_save")}</Btn>
            </div>
          </div>
        </div>
      </Card>

      <Card title={t("settings_aiSection")} desc={t("settings_aiDesc")}>
        <Field label={t("settings_baseUrl")}>
          <input className={inputCls} value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label={t("settings_model")}>
          <input className={inputCls} value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o-mini" />
        </Field>
        <Field label={t("settings_apiKey")}>
          <input
            className={inputCls}
            type="password"
            autoComplete="off"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder="sk-…"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Btn variant="primary" onClick={saveAi}>
            <Check size={14} /> {t("settings_aiSave")}
          </Btn>
          <Btn disabled={testing} onClick={testAi}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("settings_testConn")}
          </Btn>
          <span
            className={`ml-auto h-2 w-2 rounded-full ${configured ? "bg-emerald-400" : "bg-slate-300"}`}
            title={configured ? t("settings_testOk") : t("chat_notConfigured")}
          />
        </div>
      </Card>

      <Card title={t("settings_imSection")} desc={t("settings_imDesc")}>
        <div className="space-y-2">
          {(channels ?? []).map((ch) => (
            <ChannelRow
              key={ch.id}
              channel={ch}
              onChanged={loadChannels}
              onEdit={() => setEditing(ch)}
              onLogin={() => setLoginFor(ch.id)}
            />
          ))}
          {channels && channels.length === 0 && (
            <p className="py-6 text-center text-xs leading-relaxed text-slate-300">{t("settings_noChannels")}</p>
          )}
        </div>
        <div className="mt-4">
          <Btn variant="primary" onClick={() => setEditing("new")}>
            <Plus size={14} /> {t("settings_addChannel")}
          </Btn>
        </div>
      </Card>

      {editing && (
        <ChannelModal
          channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadChannels();
            toast(t("settings_savedOk"));
          }}
        />
      )}

      {loginFor && (
        <WechatLoginModal
          channel={channels?.find((c) => c.id === loginFor) ?? null}
          onClose={() => setLoginFor(null)}
          onConfirmed={async () => {
            setLoginFor(null);
            await loadChannels();
            toast(t("settings_savedOk"));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- 渠道行 ------------------------- */

function ChannelRow({
  channel,
  onChanged,
  onEdit,
  onLogin,
}: {
  channel: ImChannel;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onLogin: () => void;
}) {
  const { t, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const Icon = channel.type === "telegram" ? Send : MessageCircle;
  const typeLabel = channel.type === "telegram" ? "Telegram" : "微信";
  const wxUserId = channel.type === "wechat" ? channel.config.userId : undefined;

  const toggle = async () => {
    setBusy(true);
    try {
      await api.updateImChannel(channel.id, { enabled: !channel.enabled });
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t("settings_deleteChannelConfirm"))) return;
    try {
      await api.deleteImChannel(channel.id);
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-2.5 transition-colors hover:border-slate-200">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          channel.type === "telegram" ? "bg-sky-50 text-sky-500" : "bg-emerald-50 text-emerald-600"
        }`}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-slate-700">{channel.name}</div>
        <div className="truncate text-[11px] text-slate-300">
          {channel.type === "wechat"
            ? wxUserId
              ? `${typeLabel} · ${wxUserId}`
              : t("settings_notBound")
            : typeLabel}
        </div>
      </div>
      {channel.type === "wechat" && (
        <Btn aria-label={`login-${channel.id}`} onClick={onLogin}>
          <QrCode size={13} /> {t("settings_wechatScan")}
        </Btn>
      )}
      <button
        aria-label={channel.id}
        role="switch"
        aria-checked={channel.enabled}
        disabled={busy}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
          channel.enabled ? "bg-emerald-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            channel.enabled ? "translate-x-4" : ""
          }`}
        />
      </button>
      <div className="flex shrink-0 gap-0.5">
        <button
          aria-label={`edit-${channel.id}`}
          className="rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          aria-label={`del-${channel.id}`}
          className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
          onClick={remove}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------- 渠道编辑弹窗 ------------------------- */

function ChannelModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: ImChannel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, toast } = useApp();
  const [type, setType] = useState<ImChannelType>(channel?.type ?? "telegram");
  const [name, setName] = useState(channel?.name ?? "");
  const tg = channel && channel.type === "telegram" ? channel.config : null;
  const [token, setToken] = useState(tg?.token ?? "");
  const [allowedChatIds, setAllowedChatIds] = useState((tg?.allowedChatIds ?? []).join(", "));

  const isWechat = type === "wechat";
  const allowedIdList = allowedChatIds
    .split(/[\uFF0C,\s]+/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  const submit = async () => {
    if (!name.trim()) {
      toast(t("settings_channelName"), "err");
      return;
    }
    try {
      if (channel) {
        await api.updateImChannel(channel.id, {
          name: name.trim(),
          config: isWechat ? {} : { token, allowedChatIds: allowedIdList },
        });
      } else {
        await api.createImChannel({
          type,
          name: name.trim(),
          enabled: false,
          // 个人微信的凭据由扫码登录写入，创建时无需填写
          config: isWechat ? {} : { token, allowedChatIds: allowedIdList },
        });
      }
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <Modal title={channel ? t("settings_editChannel") : t("settings_addChannel")} onClose={onClose}>
      <Field label={t("settings_channelType")}>
        <select className={inputCls} value={type} disabled={!!channel} onChange={(e) => setType(e.target.value as ImChannelType)}>
          <option value="telegram">Telegram</option>
          <option value="wechat">微信（个人号 · 扫码登录）</option>
        </select>
      </Field>
      <Field label={t("settings_channelName")}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={isWechat ? "我的微信" : "我的机器人"} />
      </Field>

      {isWechat ? (
        <>
          {channel?.type === "wechat" && channel.config.userId && (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              {t("settings_boundAccount", { id: channel.config.userId })}
            </p>
          )}
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-700">
            {t("settings_scanHint")}
          </p>
        </>
      ) : (
        <>
          <Field label={t("settings_botToken")}>
            <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF…" />
          </Field>
          <Field label={t("settings_allowedIds")}>
            <input className={inputCls} value={allowedChatIds} onChange={(e) => setAllowedChatIds(e.target.value)} placeholder="123456789, 987654321" />
          </Field>
        </>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>{t("common_cancel")}</Btn>
        <Btn variant="primary" aria-label="channel_submit" onClick={submit}>
          <Check size={14} /> {t("common_save")}
        </Btn>
      </div>
    </Modal>
  );
}

/* ------------------------- 微信扫码登录弹窗 ------------------------- */

function WechatLoginModal({
  channel,
  onClose,
  onConfirmed,
}: {
  channel: ImChannel | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { t, toast } = useApp();
  const [state, setState] = useState<WechatLoginState | null>(null);
  const [code, setCode] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const doneRef = useRef(false);
  const channelId = channel?.id ?? "";

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;

    api
      .startWechatLogin(channelId)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((e) => {
        if (!cancelled) toast(e instanceof Error ? e.message : t("common_error"), "err");
      });

    const timer = setInterval(async () => {
      if (doneRef.current || cancelled) return;
      try {
        const s = await api.wechatLoginState(channelId);
        if (cancelled) return;
        setState((prev) => ({ ...s, qrDataUrl: s.qrDataUrl ?? prev?.qrDataUrl ?? null }));
        if (["confirmed", "failed", "timeout", "already_connected"].includes(s.status)) {
          doneRef.current = true;
          clearInterval(timer);
          if (s.status === "confirmed") setTimeout(onConfirmed, 600);
        }
      } catch {
        // 登录会话不存在（超时/未开始）→ 停止轮询
        doneRef.current = true;
        clearInterval(timer);
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const statusText =
    state?.status === "need_verifycode" ? t("settings_verifyPrompt") : state?.message || state?.error || "";

  const cancel = async () => {
    setCancelling(true);
    try {
      doneRef.current = true;
      await api.cancelWechatLogin(channelId);
    } catch {}
    onClose();
  };

  const submitCode = async () => {
    const c = code.trim();
    if (!c) return;
    try {
      await api.submitWechatVerifyCode(channelId, c);
      setCode("");
      setState((prev) => (prev ? { ...prev, status: "scanned" } : prev));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <Modal title={`${t("settings_wechatScan")} · ${channel?.name ?? ""}`} onClose={onClose} width="max-w-sm">
      <div className="flex flex-col items-center">
        {state?.qrDataUrl ? (
          <img src={state.qrDataUrl} alt="qrcode" className="rounded-xl border border-slate-100 p-1" />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
            <Loader2 size={22} className="animate-spin text-brand-500" />
          </div>
        )}
        <p className="mt-3 min-h-[36px] text-center text-xs leading-relaxed text-slate-500">{statusText}</p>

        {state?.status === "need_verifycode" && (
          <div className="mt-1 flex w-full items-center gap-2">
            <input
              aria-label={t("settings_verifyPrompt")}
              className={inputCls}
              value={code}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && submitCode()}
              placeholder="1234"
            />
            <Btn variant="primary" aria-label="verify_submit" onClick={submitCode} disabled={!code.trim()}>
              <Check size={14} /> OK
            </Btn>
          </div>
        )}

        <button className="mt-4 text-xs text-slate-400 hover:text-slate-600" disabled={cancelling} onClick={cancel}>
          {t("settings_loginCancel")}
        </button>
      </div>
    </Modal>
  );
}
