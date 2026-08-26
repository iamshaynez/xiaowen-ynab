import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Circle,
  ListChecks,
  Lock,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { fmtDate, fmtMoney } from "../format";
import { Btn, Spinner } from "../components/ui";
import { AmountInput, CategorySelect, PayeeSelect, emptyForm, formAmount, type FormState } from "../components/txEdit";
import type { Tx } from "../types";

const PAGE_SIZE = 200;

/** 解析 hash 路由中的查询参数，如 #/transactions?filter=uncategorized */
function hashQuery(): URLSearchParams {
  const h = window.location.hash || "";
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

export function TransactionsPage() {
  const { boot, t, lang, refreshBoot, toast } = useApp();

  const [onlyUncat, setOnlyUncat] = useState(() => hashQuery().get("filter") === "uncategorized");
  const [accFilter, setAccFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ txs: Tx[]; total: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const reqSeq = useRef(0);

  // 搜索防抖
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const filters = useMemo(
    () => ({ search: search || undefined, uncategorized: onlyUncat || undefined, accountId: accFilter || undefined }),
    [search, onlyUncat, accFilter]
  );

  const mergeLoaded = useCallback((next: Tx[], total: number) => {
    setData({ txs: next, total });
    setSelected((sel) => {
      const ids = new Set(next.map((x) => x.id));
      const kept = [...sel].filter((id) => ids.has(id));
      return kept.length === sel.size ? sel : new Set(kept);
    });
  }, []);

  useEffect(() => {
    const seq = ++reqSeq.current;
    api.transactions({ ...filters, limit: PAGE_SIZE }).then((r) => {
      if (seq === reqSeq.current) mergeLoaded(r.transactions, r.total);
    }).catch(() => {});
  }, [filters, mergeLoaded]);

  const loadMore = async () => {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.transactions({ ...filters, limit: PAGE_SIZE, offset: data.txs.length });
      setData((d) => (d ? { txs: [...d.txs, ...r.transactions], total: r.total } : d));
    } finally {
      setLoadingMore(false);
    }
  };

  const reload = async () => {
    const r = await api.transactions({ ...filters, limit: PAGE_SIZE });
    mergeLoaded(r.transactions, r.total);
    await refreshBoot();
  };

  function accountName(tx: Tx): string {
    return tx.account_name ?? boot?.accounts.find((a) => a.id === tx.accountId)?.name ?? "";
  }

  async function deleteTx(id: string) {
    if (!confirm(t("confirm_deleteTx"))) return;
    try {
      await api.deleteTx(id);
      setEditingId(null);
      await reload();
    } catch {
      toast(t("common_error"), "err");
    }
  }

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allPageSelected = !!data && data.txs.length > 0 && data.txs.every((x) => selected.has(x.id));
  const toggleSelectAll = () =>
    setSelected((s) => {
      if (!data) return s;
      if (data.txs.every((x) => s.has(x.id))) {
        const n = new Set(s);
        data.txs.forEach((x) => n.delete(x.id));
        return n;
      }
      const n = new Set(s);
      data.txs.forEach((x) => n.add(x.id));
      return n;
    });

  const changeCategory = async (tx: Tx, categoryId: string) => {
    try {
      await api.setTxCategory(tx.id, categoryId || null);
      await reload();
    } catch {
      toast(t("common_error"), "err");
    }
  };

  const applyBulk = async (categoryId: string | null) => {
    if (selected.size === 0) return;
    try {
      const r = await api.bulkSetCategory([...selected], categoryId);
      setSelected(new Set());
      setBulkCat("");
      await reload();
      toast(t("txp_bulkDone", { n: r.changed }));
    } catch {
      toast(t("common_error"), "err");
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(t("txp_bulkDeleteConfirm", { n: selected.size }))) return;
    try {
      const r = await api.bulkDeleteTx([...selected]);
      setSelected(new Set());
      setEditingId(null);
      await reload();
      toast(t("txp_bulkDone", { n: r.changed }));
    } catch {
      toast(t("common_error"), "err");
    }
  };

  const startEdit = (tx: Tx) => {
    setEditingId(tx.id);
    setEditForm({
      date: tx.date,
      payeeName: tx.transferAccountId ? "" : tx.payeeName ?? "",
      transferAccountId: tx.transferAccountId ?? "",
      categoryId: tx.categoryId ?? "",
      memo: tx.memo ?? "",
      inflow: tx.amount > 0 ? (tx.amount / 100).toString() : "",
      outflow: tx.amount < 0 ? (-tx.amount / 100).toString() : "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const tx = data?.txs.find((x) => x.id === editingId);
    const amount = formAmount(editForm);
    if (!tx || !amount) return;
    try {
      await api.updateTx(editingId, {
        accountId: tx.accountId,
        date: editForm.date,
        payeeName: editForm.transferAccountId ? "" : editForm.payeeName,
        transferAccountId: editForm.transferAccountId || undefined,
        categoryId: editForm.transferAccountId ? undefined : editForm.categoryId || undefined,
        memo: editForm.memo,
        amount,
      });
      setEditingId(null);
      await reload();
    } catch {
      toast(t("common_error"), "err");
    }
  };

  if (!boot || !data) return <Spinner />;

  const accounts = boot.accounts.filter((a) => !a.closed);
  const uncategorizedShown = onlyUncat ? data.total : data.txs.filter((x) => !x.categoryId && !x.transferAccountId).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 pb-4 pt-5 shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ListChecks size={20} className="text-brand-600" />
            {t("txp_title")}
          </h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
            {t("txp_subtitle", { total: data.total })}
          </span>
          {uncategorizedShown > 0 && (
            <button
              onClick={() => setOnlyUncat(!onlyUncat)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                onlyUncat ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              <AlertTriangle size={11} />
              {t("budget_uncategorized", { n: uncategorizedShown })}
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={"pl-8 " + searchCls} placeholder={t("txp_search")} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          {searchInput && (
            <button onClick={() => setSearchInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-300 hover:text-slate-500">
              <X size={13} />
            </button>
          )}
        </div>
        <select className={searchCls + " w-auto"} value={accFilter} onChange={(e) => setAccFilter(e.target.value)} aria-label={t("txp_account")}>
          <option value="">{t("txp_allAccounts")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setOnlyUncat(!onlyUncat)}
          className={`rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
            onlyUncat ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {t("txp_onlyUncategorized")}
        </button>
        <span className="ml-auto text-xs text-slate-400">{t("txp_showing", { shown: data.txs.length, total: data.total })}</span>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="anim-pop mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2">
          <span className="text-[13px] font-semibold text-brand-700">{t("txp_selected", { n: selected.size })}</span>
          <div className="w-48">
            <CategorySelect value={bulkCat} onChange={setBulkCat} />
          </div>
          <Btn variant="primary" disabled={!bulkCat} onClick={() => applyBulk(bulkCat)}>
            <Check size={14} /> {t("txp_bulkCategorize")}
          </Btn>
          <Btn variant="danger" onClick={() => applyBulk(null)}>
            <X size={14} /> {t("txp_bulkClear")}
          </Btn>
          <Btn variant="danger" onClick={bulkDelete}>
            <Trash2 size={14} /> {t("txp_bulkDelete")}
          </Btn>
          <Btn variant="ghost" onClick={() => setSelected(new Set())}>
            {t("common_cancel")}
          </Btn>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-10 pt-3">
        <div className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-card">
          <div className={`${gridCls} border-b border-slate-100 bg-slate-50/80`}>
            <div className="px-2">
              <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} title={t("txp_selectAll")} className="accent-brand-600" />
            </div>
            <div className={headCls}>{t("tx_status")}</div>
            <div className={headCls}>{t("tx_date")}</div>
            <div className={headCls}>{t("txp_account")}</div>
            <div className={headCls}>{t("tx_payee")}</div>
            <div className={headCls}>{t("tx_category")}</div>
            <div className={headCls}>{t("tx_memo")}</div>
            <div className={`${headCls} text-right`}>{t("tx_outflow")}</div>
            <div className={`${headCls} text-right`}>{t("tx_inflow")}</div>
            <div className={headCls}></div>
          </div>

          {data.txs.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">{t("txp_noResults")}</div>}

          {data.txs.map((tx) =>
            editingId === tx.id ? (
              <div key={tx.id} className={`${gridCls} border-b border-slate-50 bg-brand-50/50 px-3 py-1.5`} onKeyDown={(e) => e.key === "Enter" && saveEdit()}>
                <div />
                <button onClick={() => setEditingId(null)} className="mx-auto rounded p-1 text-slate-400 hover:bg-slate-200">
                  <X size={14} />
                </button>
                <input
                  type="date"
                  autoFocus
                  className={editInputCls}
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                />
                <span className="truncate px-2 text-[13px] text-slate-500">{accountName(tx)}</span>
                <PayeeSelect
                  value={editForm.transferAccountId ? "" : editForm.payeeName}
                  transferValue={editForm.transferAccountId}
                  onChange={(patch) => setEditForm({ ...editForm, ...patch })}
                />
                <CategorySelect value={editForm.categoryId} disabled={!!editForm.transferAccountId} onChange={(v) => setEditForm({ ...editForm, categoryId: v })} />
                <input className={editInputCls} placeholder={t("tx_memo")} value={editForm.memo} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} />
                <AmountInput value={editForm.outflow} onChange={(v) => setEditForm({ ...editForm, outflow: v, inflow: "" })} placeholder={t("tx_outflow")} />
                <AmountInput value={editForm.inflow} onChange={(v) => setEditForm({ ...editForm, inflow: v, outflow: "" })} placeholder={t("tx_inflow")} />
                <div className="flex justify-end gap-1 pr-1">
                  <Btn variant="primary" onClick={saveEdit}>
                    <Check size={14} />
                  </Btn>
                  <Btn variant="danger" onClick={() => deleteTx(tx.id)}>
                    <Trash2 size={13} />
                  </Btn>
                </div>
              </div>
            ) : (
              <div
                key={tx.id}
                className={`row-hover group ${gridCls} border-b border-slate-50 px-3 py-[7px] transition-colors last:border-b-0 hover:bg-slate-50 ${
                  selected.has(tx.id) ? "bg-brand-50/60" : ""
                }`}
              >
                <div className="px-2">
                  <input type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSel(tx.id)} className="accent-brand-600" />
                </div>
                <button
                  onClick={async () => {
                    if (tx.reconciled) return;
                    await api.setTxStatus(tx.id, tx.cleared === 1 ? 0 : 1);
                    await reload();
                  }}
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
                <span className="truncate px-2 text-[12px] text-slate-400">{accountName(tx)}</span>
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
                {tx.transferAccountId || tx.isStart ? (
                  <span className="truncate px-2 text-[13px] text-slate-400">{tx.categoryName ?? ""}</span>
                ) : (
                  <CategorySelect value={tx.categoryId ?? ""} onChange={(v) => changeCategory(tx, v)} />
                )}
                <span className="truncate px-2 text-[12px] text-slate-400">{tx.memo}</span>
                <span className="num px-2 text-right text-[13px] text-rose-500">{tx.amount < 0 ? fmtMoney(-tx.amount) : ""}</span>
                <span className="num px-2 text-right text-[13px] text-emerald-600">{tx.amount > 0 ? fmtMoney(tx.amount) : ""}</span>
                <div className="relative flex items-center justify-end pr-1">
                  {!tx.isStart && (
                    <div className="row-actions absolute -left-16 flex gap-1 rounded-lg border border-slate-100 bg-white p-0.5 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
                      <button onClick={() => startEdit(tx)} className="rounded-md p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" title={t("common_edit")}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteTx(tx.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={t("common_delete")}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {data.txs.length < data.total && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Btn onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t("common_loading") : t("txp_loadMore")}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- styles ------------------------- */

const gridCls =
  "grid grid-cols-[24px_34px_100px_110px_minmax(130px,1fr)_minmax(140px,1fr)_minmax(80px,1fr)_88px_88px_64px] items-center gap-x-1";
const headCls = "px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400";
const searchCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const editInputCls = "w-full rounded-md border border-brand-300 bg-white px-2 py-1 text-[13px] outline-none";
