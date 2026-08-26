import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Check,
  Database,
  FilePenLine,
  Loader2,
  Pencil,
  Plus,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import type { ChatMsg, ChatSession } from "../types";
import { Btn, Spinner } from "../components/ui";
import { Mermaid } from "../components/Mermaid";

type TFn = ReturnType<typeof useApp>["t"];

/* ------------------------- markdown ------------------------- */

function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const raw = String(children);
            if (lang === "mermaid") return <Mermaid chart={raw} />;
            return <code className={className}>{raw.replace(/\n$/, "")}</code>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------- tool trace ------------------------- */

function ToolChip({ label, tone }: { label: string; tone: "ok" | "err" | "reject" | "wait" }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-700 border-emerald-100",
    err: "bg-rose-50 text-rose-600 border-rose-100",
    reject: "bg-slate-100 text-slate-500 border-slate-200",
    wait: "bg-amber-50 text-amber-700 border-amber-100",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {tone === "ok" ? <Database size={10} /> : tone === "wait" ? <ShieldAlert size={10} /> : <X size={10} />}
      {label}
    </span>
  );
}

function toolResultChip(reply: ChatMsg | undefined, t: TFn) {
  let parsed: { ok?: boolean; rowCount?: number; changes?: number; rejected?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(reply?.content || "{}");
  } catch {}
  if (!reply) return <ToolChip key="x" label={t("chat_thinking")} tone="wait" />;
  if (parsed.rejected) return <ToolChip label={t("chat_toolRejected")} tone="reject" />;
  if (parsed.ok === false) return <ToolChip label={`${t("chat_toolError")}: ${parsed.error ?? ""}`} tone="err" />;
  if (typeof parsed.rowCount === "number") return <ToolChip label={t("chat_toolQuery", { n: parsed.rowCount })} tone="ok" />;
  if (typeof parsed.changes === "number") return <ToolChip label={t("chat_toolWrite", { n: parsed.changes })} tone="ok" />;
  return <ToolChip label="✓" tone="ok" />;
}

/* ------------------------- message units ------------------------- */

type Unit =
  | { kind: "plain"; msg: ChatMsg }
  | { kind: "tools"; msg: ChatMsg; replies: Record<string, ChatMsg> }
  | { kind: "pending"; msg: ChatMsg };

function buildUnits(messages: ChatMsg[]): Unit[] {
  const units: Unit[] = [];
  for (const m of messages) {
    const last = units[units.length - 1];
    if (m.role === "assistant" && m.pending) {
      units.push({ kind: "pending", msg: m });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      units.push({ kind: "tools", msg: m, replies: {} });
    } else if (m.role === "tool" && last && last.kind === "tools" && m.toolCallId) {
      last.replies[m.toolCallId] = m;
    } else if (m.role !== "tool") {
      units.push({ kind: "plain", msg: m });
    }
  }
  return units;
}

/* ------------------------- main page ------------------------- */

export function ChatPage() {
  const { boot, t, toast, refreshBoot } = useApp();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const configured = !!boot?.settings.aiKey;
  const openSettings = () => {
    window.location.hash = "#/settings";
  };

  const loadSessions = useCallback(async () => {
    try {
      const { sessions } = await api.chatSessions();
      setSessions(sessions);
      return sessions;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setLoadingSession(true);
    try {
      const r = await api.chatSession(id);
      setMessages(r.messages);
    } catch {
      toast(t("common_error"), "err");
    } finally {
      setLoadingSession(false);
    }
  }, [t, toast]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, confirming]);

  const newSession = async () => {
    const { session } = await api.createChatSession();
    await loadSessions();
    setActiveId(session.id);
    setMessages([]);
    taRef.current?.focus();
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    if (!configured) {
      toast(t("chat_notConfigured"), "err");
      openSettings();
      return;
    }
    let sid = activeId;
    if (!sid) {
      const { session } = await api.createChatSession();
      sid = session.id;
      setActiveId(sid);
    }
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    const temp: ChatMsg = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content,
      toolCalls: null,
      toolCallId: null,
      pending: null,
      proposedSql: null,
      resolved: true,
      createdAt: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, temp]);
    setSending(true);
    try {
      const r = await api.sendChatMessage(sid, content);
      setMessages(r.messages);
      loadSessions();
    } catch (e) {
      setMessages((ms) => ms.filter((m) => m.id !== temp.id));
      const msg = e instanceof Error ? e.message : "";
      toast(msg === "AI_NOT_CONFIGURED" ? t("chat_notConfigured") : t("chat_errorReply"), "err");
    } finally {
      setSending(false);
    }
  };

  const confirmSql = async (approve: boolean) => {
    if (!activeId || confirming) return;
    setConfirming(true);
    try {
      const r = await api.confirmChat(activeId, approve);
      setMessages(r.messages);
      if (approve && r.changed) await refreshBoot();
    } catch {
      toast(t("chat_errorReply"), "err");
    } finally {
      setConfirming(false);
    }
  };

  const removeSession = async (id: string) => {
    if (!confirm(t("chat_delSession"))) return;
    await api.deleteChatSession(id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    loadSessions();
  };

  const renameSessionLocal = async (id: string, title: string) => {
    if (!title.trim()) return;
    await api.renameChatSession(id, title.trim());
    loadSessions();
  };

  const units = useMemo(() => buildUnits(messages), [messages]);
  const awaiting = messages.some((m) => m.pending);

  return (
    <div className="flex h-full">
      {/* sessions */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="p-3">
          <Btn variant="primary" className="w-full" onClick={newSession}>
            <Plus size={14} /> {t("chat_new")}
          </Btn>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={s.id === activeId}
              onOpen={() => openSession(s.id)}
              onDelete={() => removeSession(s.id)}
              onRename={(title) => renameSessionLocal(s.id, title)}
            />
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-6 text-center text-xs leading-relaxed text-slate-300">{t("chat_emptyDesc")}</p>
          )}
        </div>
      </aside>

      {/* thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur">
          <Bot size={17} className="text-brand-600" />
          <h1 className="text-[15px] font-semibold text-slate-800">{t("nav_chat")}</h1>
          <span
            className={`ml-1 h-2 w-2 rounded-full ${configured ? "bg-emerald-400" : "bg-slate-300"}`}
            title={configured ? "OK" : t("chat_notConfigured")}
          />
          <Btn variant="ghost" className="ml-auto" onClick={openSettings}>
            <Settings2 size={14} /> {t("nav_settings")}
          </Btn>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {!activeId && messages.length === 0 && (
              <div className="pt-16 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-600/25">
                  <Sparkles size={24} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-slate-800">{t("chat_emptyTitle")}</h2>
                <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-400">{t("chat_emptyDesc")}</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {[t("chat_example1"), t("chat_example2"), t("chat_example3")].map((ex) => (
                    <button
                      key={ex}
                      onClick={() => {
                        setInput(ex);
                        taRef.current?.focus();
                      }}
                      className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs text-slate-500 shadow-sm transition-all hover:border-brand-300 hover:text-brand-600"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <Btn variant="primary" className="mt-8" onClick={newSession}>
                  <Plus size={14} /> {t("chat_new")}
                </Btn>
              </div>
            )}

            {loadingSession && <Spinner />}

            {units.map((u, i) => (
              <MessageUnitView
                key={u.msg.id}
                unit={u}
                confirming={confirming}
                onConfirm={() => confirmSql(true)}
                onCancel={() => confirmSql(false)}
              />
            ))}

            {(sending || confirming) && (
              <div className="flex items-center gap-2 pl-1 text-[13px] text-slate-400">
                <Loader2 size={14} className="animate-spin text-brand-500" />
                {sending ? t("chat_thinking") : t("chat_confirmBtn") + "…"}
              </div>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-3">
          <div className="mx-auto max-w-3xl">
            {!configured && (
              <button
                onClick={openSettings}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                <ShieldAlert size={13} /> {t("chat_notConfigured")}
                <Settings2 size={12} className="ml-auto" />
              </button>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card transition-colors focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                placeholder={t("chat_placeholder")}
                className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-300"
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Btn variant="primary" disabled={!input.trim() || sending} onClick={send} className="mb-0.5">
                <Send size={14} />
              </Btn>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------- pieces ------------------------- */

function SessionItem({
  session,
  active,
  onOpen,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const { lang } = useApp();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  return (
    <div
      className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
        active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50"
      }`}
      onClick={() => !editing && onOpen()}
    >
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== session.title) onRename(title.trim());
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-md border border-brand-300 px-1.5 py-0.5 text-[13px] outline-none"
        />
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[13px] font-medium ${active ? "text-brand-700" : "text-slate-600"}`}>
              {session.title}
            </div>
            <div className="truncate text-[11px] text-slate-300">{fmtRel(session.updatedAt, lang)}</div>
          </div>
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className="rounded p-1 text-slate-300 hover:bg-slate-200 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                setTitle(session.title);
                setEditing(true);
              }}
            >
              <Pencil size={11} />
            </button>
            <button
              className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fmtRel(iso: string, lang: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (lang === "zh") {
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MessageUnitView({
  unit,
  confirming,
  onConfirm,
  onCancel,
}: {
  unit: Unit;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useApp();

  if (unit.kind === "plain") {
    const m = unit.msg;
    if (m.role === "user")
      return (
        <div className="anim-pop flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-brand-600 to-brand-500 px-4 py-2.5 text-sm text-white shadow-md shadow-brand-600/20">
            {m.content}
          </div>
        </div>
      );
    return (
      <div className="anim-pop flex gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-sm">
          <Bot size={14} className="text-white" />
        </div>
        <div className="md min-w-0 max-w-full rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-3 text-sm shadow-card">
          <Md text={m.content} />
        </div>
      </div>
    );
  }

  if (unit.kind === "tools") {
    return (
      <div className="anim-pop flex gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-sm">
          <Bot size={14} className="text-white" />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 py-1">
          {unit.msg.content && <span className="w-full text-[13px] italic text-slate-400">{unit.msg.content}</span>}
          {unit.msg.toolCalls!.map((tc) => (
            <span key={tc.id}>{toolResultChip(unit.replies[tc.id], t)}</span>
          ))}
        </div>
      </div>
    );
  }

  const p = unit.msg.pending!;
  return (
    <div className="anim-pop flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-400 shadow-sm">
        <FilePenLine size={14} className="text-white" />
      </div>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50/70 shadow-card">
        <div className="flex items-center gap-2 border-b border-amber-200/80 bg-amber-100/60 px-4 py-2.5 text-[13px] font-semibold text-amber-800">
          <ShieldAlert size={14} /> {t("chat_confirmTitle")}
        </div>
        <div className="px-4 py-3">
          {p.purpose && <p className="mb-2 text-[13px] leading-relaxed text-slate-600">{p.purpose}</p>}
          <pre className="overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs leading-relaxed text-slate-100">{p.sql}</pre>
          <p className="mt-2 text-xs text-slate-400">{t("chat_confirmDesc")}</p>
          <div className="mt-3 flex gap-2">
            <Btn variant="primary" disabled={confirming} onClick={onConfirm}>
              <Check size={14} /> {t("chat_confirmBtn")}
            </Btn>
            <Btn disabled={confirming} onClick={onCancel}>
              <X size={14} /> {t("chat_cancelBtn")}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
