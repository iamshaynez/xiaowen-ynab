import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useApp } from "../store";
import { parseAmountToCents, todayIso } from "../format";
import type { CategoryGroup } from "../types";

export interface FormState {
  date: string;
  payeeName: string;
  transferAccountId: string;
  categoryId: string;
  memo: string;
  inflow: string;
  outflow: string;
}

export const emptyForm = (): FormState => ({
  date: todayIso(),
  payeeName: "",
  transferAccountId: "",
  categoryId: "",
  memo: "",
  inflow: "",
  outflow: "",
});

export function formAmount(f: FormState): number | null {
  const inf = parseAmountToCents(f.inflow) ?? 0;
  const outf = parseAmountToCents(f.outflow) ?? 0;
  const v = inf - outf;
  return v === 0 ? null : v;
}

/* ------------------------- Payee selector ------------------------- */

export function PayeeSelect({
  value,
  transferValue,
  onChange,
  excludeAccountId,
}: {
  value: string;
  transferValue: string;
  onChange: (patch: { payeeName?: string; transferAccountId?: string }) => void;
  excludeAccountId?: string;
}) {
  const { boot } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const others = (boot?.accounts ?? []).filter((a) => a.id !== excludeAccountId && !a.closed);
  const payees = boot?.payees ?? [];
  const q = value.toLowerCase();
  const filteredPayees = payees.filter((p) => p.toLowerCase().includes(q)).slice(0, 8);
  const filteredAccounts = others.filter((a) => !q || a.name.toLowerCase().includes(q));

  const selectedTransfer = others.find((a) => a.id === transferValue);

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none transition-colors placeholder:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
        placeholder={selectedTransfer ? `→ ${selectedTransfer.name}` : ""}
        value={value}
        onChange={(e) => onChange({ payeeName: e.target.value, transferAccountId: "" })}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="anim-pop absolute left-0 top-full z-40 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-slate-100 bg-white py-1 shadow-pop">
          {filteredAccounts.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">转账 / Transfer</div>
              {filteredAccounts.map((a) => (
                <button
                  key={a.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-brand-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ transferAccountId: a.id, payeeName: "" });
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                >
                  {a.on_budget ? <ArrowUpRight size={13} className="text-sky-500" /> : <ArrowDownLeft size={13} className="text-violet-500" />}
                  {a.name}
                </button>
              ))}
            </>
          )}
          {filteredPayees.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">收款方 / Payees</div>
              {filteredPayees.map((p) => (
                <button
                  key={p}
                  className="w-full px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-brand-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ payeeName: p, transferAccountId: "" });
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                >
                  {p}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------- Category select ------------------------- */

export function CategorySelect({
  value,
  onChange,
  disabled,
  compact = true,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { boot, t } = useApp();
  const groups = (boot?.groups ?? []).filter((g) => g.categories.length > 0);
  const incomeFirst = [...groups.filter((g) => g.is_income), ...groups.filter((g) => !g.is_income)];
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${compact ? "max-w-[150px] truncate" : ""} w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none transition-colors disabled:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100`}
    >
      <option value="">{t("tx_uncategorized")}</option>
      {incomeFirst.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// 计算默认收入来源分类：优先「其他收入」，否则收入组的第一个分类。
export function defaultIncomeCategory(groups: CategoryGroup[]): string {
  const income = groups.filter((g) => g.is_income).flatMap((g) => g.categories);
  return income.find((c) => c.name === "其他收入")?.id ?? income[0]?.id ?? "";
}

export function incomeCategoryIds(groups: CategoryGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.is_income).flatMap((g) => g.categories.map((c) => c.id)));
}

export function AmountInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-[13px] num outline-none transition-colors placeholder:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
