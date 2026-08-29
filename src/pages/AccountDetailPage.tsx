import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Circle,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { fmtDate, fmtMoney, parseAmountToCents, todayIso } from "../format";
import { Btn, Modal, Spinner, Field, inputCls } from "../components/ui";
import { AmountInput, CategorySelect, PayeeSelect, defaultIncomeCategory, emptyForm, formAmount, incomeCategoryIds, type FormState } from "../components/txEdit";
import { ACCOUNT_TYPE_LABELS } from "./AccountsPage";
import type { Tx } from "../types";

export function AccountDetailPage({ id }: { id: string }) {
  const { boot, t, lang, refreshBoot, toast } = useApp();
  const [reg, setReg] = useState<{ account: { name: string; type: string; balance: number }; transactions: Tx[] } | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(() => emptyForm());
  const [search, setSearch] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const saveRef = useRef(false);

  // 新建表单的日期按系统配置的时区校正
  useEffect(() => {
    if (!boot?.settings.timezone) return;
    const tzDate = todayIso(boot.settings.timezone);
    setForm((prev) => {
      const pristine = !prev.payeeName && !prev.transferAccountId && !prev.memo && !prev.inflow && !prev.outflow;
      if (pristine && prev.date !== tzDate) return { ...prev, date: tzDate };
      return prev;
    });
  }, [boot?.settings.timezone]);

  const load = useCallback(async () => {
    setReg(await api.accountRegister(id));
  }, [id]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const accMeta = boot?.accounts.find((a) => a.id === id);
  const isCredit = accMeta ? ["creditCard", "lineOfCredit"].includes(accMeta.type) : false;

  const visible = useMemo(() => {
    if (!reg) return [];
    if (!search.trim()) return reg.transactions;
    const q = search.toLowerCase();
    return reg.transactions.filter(
      (tx) =>
        (tx.payeeName ?? "").toLowerCase().includes(q) ||
        (tx.categoryName ?? "").toLowerCase().includes(q) ||
        (tx.memo ?? "").toLowerCase().includes(q)
    );
  }, [reg, search]);

  if (!boot || !reg) return <Spinner />;

  const label = ACCOUNT_TYPE_LABELS[reg.account.type];
  const clearedBalance =
    (boot.accounts.find((a) => a.id === id)?.starting_balance ?? 0) +
    reg.transactions.filter((tx) => tx.cleared === 1 && !tx.isStart).reduce((s, tx) => s + tx.amount, 0);
  // 对账弹窗里的“一并勾为已清算”只针对非转账流水，与后端 markCleared 的口径一致
  const unclearedCount = reg.transactions.filter((tx) => !tx.isStart && !tx.transferAccountId && tx.cleared === 0).length;

  const saveNew = async () => {
    if (saveRef.current) return;
    const amount = formAmount(form);
    if (!amount) return;
    saveRef.current = true;
    try {
      await api.createTx({
        accountId: id,
        date: form.date,
        payeeName: form.transferAccountId ? "" : form.payeeName,
        transferAccountId: form.transferAccountId || undefined,
        categoryId: form.transferAccountId ? undefined : form.categoryId || undefined,
        memo: form.memo,
        amount,
      });
      setForm(emptyForm(boot?.settings.timezone));
      await Promise.all([load(), refreshBoot()]);
    } catch {
      toast(t("common_error"), "err");
    } finally {
      saveRef.current = false;
    }
  };

  const startEdit = (tx: Tx) => {
    setEditingId(tx.id);
    const inf = tx.amount > 0 ? (tx.amount / 100).toString() : "";
    const outf = tx.amount < 0 ? (-tx.amount / 100).toString() : "";
    setEditForm({
      date: tx.date,
      payeeName: tx.payeeName ?? "",
      transferAccountId: tx.transferAccountId ?? "",
      categoryId: tx.categoryId ?? "",
      memo: tx.memo ?? "",
      inflow: inf,
      outflow: outf,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amount = formAmount(editForm);
    if (!amount) return;
    try {
      await api.updateTx(editingId, {
        accountId: id,
        date: editForm.date,
        payeeName: editForm.transferAccountId ? "" : editForm.payeeName,
        transferAccountId: editForm.transferAccountId || undefined,
        categoryId: editForm.transferAccountId ? undefined : editForm.categoryId || undefined,
        memo: editForm.memo,
        amount,
      });
      setEditingId(null);
      await Promise.all([load(), refreshBoot()]);
    } catch {
      toast(t("common_error"), "err");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 pb-4 pt-5 shadow-card md:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <a href="#/accounts" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <ArrowLeft size={18} />
          </a>
          <HeaderName name={reg.account.name} onSave={async (n) => { await api.updateAccount(id, { name: n }); await refreshBoot(); await load(); }} />
          {label && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">{label[lang]}</span>}
          {accMeta?.closed === 1 && (
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-white">{t("account_closedTip")}</span>
          )}
          <div className="ml-auto flex items-center gap-5">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{t("account_clearedBalance")}</div>
              <div className="num text-sm font-semibold text-slate-600">{fmtMoney(clearedBalance)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{t("account_balance")}</div>
              <div className={`num text-xl font-bold ${reg.account.balance < 0 ? "text-rose-600" : "text-slate-900"}`}>
                {fmtMoney(reg.account.balance)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Btn onClick={() => setReconciling(true)}>
                <Check size={14} /> {t("account_reconcile")}
              </Btn>
              {!isCredit && (
                <Btn onClick={async () => {
                  if (!confirm(t("confirm_closeAccount"))) return;
                  try {
                    await api.updateAccount(id, { closed: accMeta?.closed !== 1 });
                    await refreshBoot();
                    toast("✓");
                  } catch { toast(t("common_error"), "err"); }
                }}>
                  {accMeta?.closed === 1 ? <RotateCcw size={14} /> : <X size={14} />}
                  {accMeta?.closed === 1 ? t("account_reopen") : t("account_close")}
                </Btn>
              )}
              <Btn variant="danger" title={t("account_deleteWarn")} onClick={async () => {
                if (!confirm(lang === "zh" ? "确定删除该账户？" : "Delete this account?")) return;
                try {
                  await api.deleteAccount(id);
                  location.hash = "#/accounts";
                } catch {
                  toast(t("account_deleteWarn"), "err");
                }
              }}>
                <Trash2 size={14} />
              </Btn>
            </div>
          </div>
        </div>

        {!accMeta?.on_budget && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{t("tx_offbudgetHint")}</p>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 pt-4 md:px-6">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={inputCls + " pl-8"} placeholder={t("tx_search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Register */}
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-10 pt-3 md:px-6">
        <TxTable
          txs={visible}
          editingId={editingId}
          editForm={editForm}
          setEditForm={setEditForm}
          onStartEdit={startEdit}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={saveEdit}
          onDelete={async (txid) => {
            if (!confirm(t("confirm_deleteTx"))) return;
            await api.deleteTx(txid);
            await Promise.all([load(), refreshBoot()]);
          }}
          onToggleCleared={async (tx) => {
            await api.setTxStatus(tx.id, tx.cleared === 1 ? 0 : 1);
            await Promise.all([load(), refreshBoot()]);
          }}
        />

        {/* New transaction form */}
        <div className="mt-4 min-w-[920px] overflow-visible rounded-xl border border-brand-200 bg-brand-50/40 shadow-card">
          <div className="flex items-center gap-2 rounded-t-xl border-b border-brand-100 bg-white/70 px-4 py-2 text-[13px] font-semibold text-brand-700">
            <Plus size={14} /> {t("tx_add")}
            <span className="ml-auto text-[11px] font-normal text-slate-400">{t("tx_saveAnother")}</span>
          </div>
          <TxFormRow
            form={form}
            setForm={setForm}
            excludeAccountId={id}
            onSave={saveNew}
          />
        </div>
      </div>

      {reconciling && (
        <ReconcileModal
          id={id}
          balance={reg.account.balance}
          unclearedCount={unclearedCount}
          onClose={() => setReconciling(false)}
          onDone={async () => {
            await Promise.all([load(), refreshBoot()]);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- Reconcile ------------------------- */

function ReconcileModal({
  id,
  balance,
  unclearedCount,
  onClose,
  onDone,
}: {
  id: string;
  balance: number;
  unclearedCount: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, toast } = useApp();
  const [v, setV] = useState((balance / 100).toFixed(2));
  const [markCleared, setMarkCleared] = useState(true);
  const [busy, setBusy] = useState(false);
  const cents = parseAmountToCents(v);
  const diff = cents === null ? null : cents - balance;

  const submit = async () => {
    if (cents === null || busy) return;
    setBusy(true);
    try {
      await api.reconcile(id, { statementBalance: cents, markCleared });
      await onDone();
      toast("✓");
      onClose();
    } catch {
      toast(t("common_error"), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("rec_title")} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm text-slate-600">
        <span>{t("rec_currentBalance")}</span>
        <span className="num font-semibold text-slate-900">{fmtMoney(balance)}</span>
      </div>
      <Field label={t("rec_statement")}>
        <input
          autoFocus
          className={`${inputCls} num text-right`}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>
      {diff !== null && diff !== 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t("rec_diffHint", { amount: fmtMoney(diff) })}
        </p>
      )}
      {unclearedCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-brand-600"
            checked={markCleared}
            onChange={(e) => setMarkCleared(e.target.checked)}
          />
          {t("rec_markCleared", { n: unclearedCount })}
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>{t("common_cancel")}</Btn>
        <Btn variant="primary" disabled={cents === null || busy} onClick={submit}>
          {t("common_confirm")}
        </Btn>
      </div>
    </Modal>
  );
}

function HeaderName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  if (!editing)
    return (
      <button className="group flex items-center gap-1.5" onClick={() => setEditing(true)}>
        <h1 className="text-lg font-bold text-slate-900">{name}</h1>
        <Pencil size={12} className="text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  return (
    <input
      autoFocus
      className={inputCls + " max-w-xs"}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { setEditing(false); if (v.trim() && v !== name) onSave(v.trim()); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/* ------------------------- Form row ------------------------- */

const gridCls = "grid grid-cols-[34px_110px_minmax(140px,1fr)_minmax(130px,1fr)_minmax(90px,1fr)_128px_128px_140px] items-center gap-x-1";

function TxFormRow({
  form,
  setForm,
  onSave,
  excludeAccountId,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  excludeAccountId: string;
}) {
  const { t, boot } = useApp();
  const groups = boot?.groups ?? [];
  const incomeIds = incomeCategoryIds(groups);
  const defaultIncomeId = defaultIncomeCategory(groups);
  return (
    <div className={`${gridCls} px-3 py-2`} onKeyDown={(e) => e.key === "Enter" && onSave()}>
      <div />
      <input
        type="date"
        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none focus:border-brand-400 focus:bg-white"
        value={form.date}
        onChange={(e) => setForm({ ...form, date: e.target.value })}
      />
      <PayeeSelect
        value={form.transferAccountId ? "" : form.payeeName}
        transferValue={form.transferAccountId}
        excludeAccountId={excludeAccountId}
        onChange={(patch) => setForm({ ...form, ...patch })}
      />
      <CategorySelect value={form.categoryId} disabled={!!form.transferAccountId} onChange={(v) => setForm({ ...form, categoryId: v })} />
      <input
        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none placeholder:text-slate-300 focus:border-brand-400 focus:bg-white"
        placeholder={t("tx_memo")}
        value={form.memo}
        onChange={(e) => setForm({ ...form, memo: e.target.value })}
      />
      <AmountInput
        value={form.outflow}
        onChange={(v) => setForm({ ...form, outflow: v, inflow: "", categoryId: incomeIds.has(form.categoryId) ? "" : form.categoryId })}
        placeholder={t("tx_outflow")}
      />
      <AmountInput
        value={form.inflow}
        onChange={(v) => setForm({ ...form, inflow: v, outflow: "", categoryId: form.categoryId || defaultIncomeId })}
        placeholder={t("tx_inflow")}
      />
      <div className="flex justify-end pr-1">
        <Btn variant="primary" onClick={onSave}>
          <Check size={14} />
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------- Table ------------------------- */

const headCls = "px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400";

function TxTable({
  txs,
  editingId,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggleCleared,
}: {
  txs: Tx[];
  editingId: string | null;
  editForm: FormState;
  setEditForm: (f: FormState) => void;
  onStartEdit: (tx: Tx) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: (id: string) => void;
  onToggleCleared: (tx: Tx) => void;
}) {
  const { t, lang } = useApp();

  return (
    <div className="min-w-[940px] overflow-visible rounded-xl border border-slate-200 bg-white shadow-card">
      <div className={`${gridCls} rounded-t-xl border-b border-slate-100 bg-slate-50/80`}>
        <div className={headCls}>{t("tx_status")}</div>
        <div className={headCls}>{t("tx_date")}</div>
        <div className={headCls}>{t("tx_payee")}</div>
        <div className={headCls}>{t("tx_category")}</div>
        <div className={headCls}>{t("tx_memo")}</div>
        <div className={`${headCls} text-right`}>{t("tx_outflow")}</div>
        <div className={`${headCls} text-right`}>{t("tx_inflow")}</div>
        <div className={`${headCls} text-right`}>{t("tx_balance")}</div>
      </div>

      {txs.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">{t("tx_empty")}</div>}

      {txs.map((tx) =>
        editingId === tx.id ? (
          <div key={tx.id} className={`${gridCls} last:rounded-b-xl border-b border-slate-50 bg-brand-50/50 px-3 py-1.5`} onKeyDown={(e) => e.key === "Enter" && onSaveEdit()}>
            <button onClick={onCancelEdit} className="mx-auto rounded p-1 text-slate-400 hover:bg-slate-200">
              <X size={14} />
            </button>
            <input
              type="date"
              autoFocus
              className="w-full rounded-md border border-brand-300 bg-white px-2 py-1 text-[13px] outline-none"
              value={editForm.date}
              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
            />
            <PayeeSelect
              value={editForm.transferAccountId ? "" : editForm.payeeName}
              transferValue={editForm.transferAccountId}
              excludeAccountId={tx.accountId}
              onChange={(patch) => setEditForm({ ...editForm, ...patch })}
            />
            <CategorySelect value={editForm.categoryId} disabled={!!editForm.transferAccountId} onChange={(v) => setEditForm({ ...editForm, categoryId: v })} />
            <input
              className="w-full rounded-md border border-brand-300 bg-white px-2 py-1 text-[13px] outline-none"
              placeholder={t("tx_memo")}
              value={editForm.memo}
              onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
            />
            <AmountInput value={editForm.outflow} onChange={(v) => setEditForm({ ...editForm, outflow: v, inflow: "" })} placeholder={t("tx_outflow")} />
            <AmountInput value={editForm.inflow} onChange={(v) => setEditForm({ ...editForm, inflow: v, outflow: "" })} placeholder={t("tx_inflow")} />
            <div className="flex justify-end gap-1 pr-1">
              <Btn variant="primary" onClick={onSaveEdit}>
                <Check size={14} />
              </Btn>
              <Btn variant="danger" onClick={() => onDelete(tx.id)}>
                <Trash2 size={13} />
              </Btn>
            </div>
          </div>
        ) : (
          <div
            key={tx.id}
            className={`row-hover group ${gridCls} border-b border-slate-50 px-3 py-[7px] transition-colors last:border-b-0 last:rounded-b-xl hover:bg-slate-50 ${
              tx.reconciled ? "bg-slate-50/40" : ""
            }`}
          >
            <button
              onClick={() => !tx.reconciled && onToggleCleared(tx)}
              title={tx.reconciled ? "reconciled" : tx.cleared ? "cleared" : "uncleared"}
              className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                tx.reconciled
                  ? "bg-emerald-100 text-emerald-600"
                  : tx.cleared
                    ? "text-emerald-500 hover:bg-emerald-50"
                    : "text-slate-200 hover:text-slate-400"
              }`}
            >
              {tx.reconciled ? <Lock size={11} /> : tx.cleared ? <Check size={13} strokeWidth={3} /> : <Circle size={13} />}
            </button>
            <span className="px-2 text-[13px] text-slate-500">{fmtDate(tx.date, lang)}</span>
            {tx.isStart ? (
              <span className="truncate px-2 text-[13px] italic text-slate-400">{t("tx_starting")}</span>
            ) : tx.transferAccountId ? (
              <span className="flex min-w-0 items-center gap-1 truncate px-2 text-[13px] font-medium text-sky-600">
                <ArrowUpRight size={12} className="shrink-0" />
                {lang === "zh" ? `转账 ${tx.otherAccountName}` : `Transfer: ${tx.otherAccountName}`}
              </span>
            ) : (
              <span className="truncate px-2 text-[13px] font-medium text-slate-700">{tx.payeeName || "—"}</span>
            )}
            <span className="truncate px-2 text-[13px] text-slate-500">
              {tx.categoryName ?? (tx.transferAccountId ? "" : <span className="italic text-slate-300">{t("tx_uncategorized")}</span>)}
            </span>
            <span className="truncate px-2 text-[12px] text-slate-400">{tx.memo}</span>
            <span className="num px-2 text-right text-[13px] text-rose-500">{tx.amount < 0 ? fmtMoney(-tx.amount) : ""}</span>
            <span className="num px-2 text-right text-[13px] text-emerald-600">{tx.amount > 0 ? fmtMoney(tx.amount) : ""}</span>
            <div className="relative flex items-center justify-end gap-2 px-2">
              <span className={`num text-[13px] ${tx.balance !== undefined && tx.balance < 0 ? "text-rose-500" : "text-slate-400"}`}>
                {tx.balance !== undefined ? fmtMoney(tx.balance) : ""}
              </span>
              <div className="row-actions absolute -left-16 flex gap-1 rounded-lg border border-slate-100 bg-white p-0.5 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
                {!tx.isStart && (
                  <>
                    <button onClick={() => onStartEdit(tx)} className="rounded-md p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" title={t("common_edit")}>
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => onDelete(tx.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={t("common_delete")}>
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
