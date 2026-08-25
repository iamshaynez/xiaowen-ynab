import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { fmtMoney, fmtMonth, parseAmountToCents } from "../format";
import type { BudCategory, BudGroup, BudgetData } from "../types";
import { Btn, Field, Modal, Spinner, inputCls } from "../components/ui";

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("collapsedGroups") || "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      localStorage.setItem("collapsedGroups", JSON.stringify(next));
      return next;
    });
  };
  return { collapsed, toggle };
}

type Selection = { kind: "rta" } | { kind: "cat"; cat: BudCategory; groupId: string } | null;

export function BudgetPage() {
  const { boot, t, lang, refreshBoot, toast } = useApp();
  const [month, setMonth] = useState<string>("");
  const [data, setData] = useState<BudgetData | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ catId: string; value: string } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [addOpen, setAddOpen] = useState<"group" | "category" | null>(null);
  const [addGroupId, setAddGroupId] = useState<string>("");
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState<{ kind: "group" | "category"; id: string; name: string } | null>(null);
  const { collapsed, toggle } = useCollapsedGroups();
  const rtaMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!month && boot) setMonth(boot.currentMonth);
  }, [boot, month]);

  const load = useCallback(async (m: string) => {
    setData(await api.budget(m));
  }, []);

  useEffect(() => {
    if (month) load(month).catch(() => toast(t("common_error"), "err"));
  }, [month, load, t, toast]);

  useEffect(() => {
    const h = () => setGroupMenu(null);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  if (!boot || !data) return <Spinner />;

  const isCurrent = data.month === boot.currentMonth;
  const canNext = data.month < data.maxMonth;
  const canPrev = data.months.length === 0 || data.month > data.months[0];
  const allCats = data.groups.flatMap((g) => g.categories.map((c) => ({ c, g })));
  const overspentCats = allCats.filter(({ c }) => c.available < 0);

  const apply = (d: BudgetData) => setData(d);
  const commitAssign = async (catId: string, value: string) => {
    setEditing(null);
    const cents = parseAmountToCents(value);
    if (cents == null || cents < 0) return;
    apply(await api.assign(data.month, catId, cents));
  };

  const emptyStart = boot.accounts.length === 0 && data.months.length === 1 && data.incomeThisMonth === 0;
  if (emptyStart) return <EmptyStart />;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-6 pb-3 pt-4">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => canPrev && setMonth(shiftMonth(data.month, -1))}
                disabled={!canPrev}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm disabled:opacity-30"
              >
                <ChevronLeft size={17} />
              </button>
              <div className="min-w-[128px] text-center text-sm font-semibold text-slate-800">
                {fmtMonth(data.month, lang)}
              </div>
              <button
                onClick={() => canNext && setMonth(shiftMonth(data.month, 1))}
                disabled={!canNext}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm disabled:opacity-30"
              >
                <ChevronRight size={17} />
              </button>
              {!isCurrent && (
                <button
                  onClick={() => setMonth(boot.currentMonth)}
                  className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-white"
                >
                  {lang === "zh" ? "今" : "Today"}
                </button>
              )}
            </div>

            {/* RTA */}
            <div className="relative" ref={rtaMenuRef}>
              <button
                onClick={() =>
                  setSel(sel?.kind === "rta" ? null : { kind: "rta" })
                }
                className={`group flex items-baseline gap-2 rounded-xl px-4 py-2 shadow-sm transition-all ${
                  data.readyToAssign < 0
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-gradient-to-r from-brand-600 to-brand-500 text-white hover:brightness-110"
                } ${sel?.kind === "rta" ? "ring-2 ring-offset-2 ring-brand-300" : ""}`}
              >
                <span className="text-xs font-medium opacity-90">{t("budget_rta")}</span>
                <span className="num text-lg font-bold">{fmtMoney(data.readyToAssign)}</span>
                <ChevronDown size={14} className="self-center opacity-70" />
              </button>
              {sel?.kind === "rta" && (
                <div className="anim-pop absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-slate-100 bg-white p-3 shadow-pop">
                  <div className="space-y-1.5 text-[13px]">
                    <div className="flex justify-between text-slate-500">
                      <span>{t("budget_incomeThisMonth")}</span>
                      <b className="num text-emerald-600">{fmtMoney(data.incomeThisMonth)}</b>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>{t("budget_assignedTotal")}</span>
                      <b className="num text-slate-700">{fmtMoney(data.assignedTotal)}</b>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-1.5 text-slate-500">
                      <span>{t("rep_aom")}</span>
                      <b className="num text-slate-700">{data.ageOfMoney}d</b>
                    </div>
                  </div>
                  <Btn variant="primary" className="mt-3 w-full" onClick={() => api.autoAssign(data.month).then(apply).then(() => toast(t("budget_autoAssign") + " ✓"))}>
                    <Sparkles size={14} /> {t("budget_autoAssign")}
                  </Btn>
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {overspentCats.length > 0 && (
                <Btn variant="danger" onClick={() => setCoverOpen(true)}>
                  <AlertTriangle size={14} />
                  {t("budget_overspent")} {fmtMoney(Math.abs(data.overspentTotal))}
                </Btn>
              )}
              <Btn onClick={() => setMoveOpen(true)}>
                <ArrowRightLeft size={14} />
                {t("budget_moveMoney")}
              </Btn>
              <Btn onClick={() => { setAddGroupId(""); setAddOpen("group"); }} title={t("budget_addGroup")}>
                <Plus size={14} />
                <span className="hidden xl:inline">{t("budget_addGroup")}</span>
              </Btn>
              <Btn variant="primary" onClick={() => { setAddGroupId(""); setAddOpen("category"); }} title={t("budget_addCategory")}>
                <Plus size={14} />
                <span className="hidden xl:inline">{t("budget_addCategory")}</span>
              </Btn>
            </div>
          </div>

          {!isCurrent && data.month > boot.currentMonth && (
            <div className="border-t border-amber-100 bg-amber-50 px-6 py-1.5 text-xs text-amber-700">
              {t("budget_futureHint")}
            </div>
          )}
          {data.uncategorizedCount > 0 && (
            <a href="#/accounts" className="block border-t border-amber-100 bg-amber-50 px-6 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
              <AlertTriangle size={12} className="mr-1 inline" />
              {t("budget_uncategorized", { n: data.uncategorizedCount })}
              <span className="ml-2 underline">{t("budget_goResolve")} →</span>
            </a>
          )}

          {/* Column headers */}
          <div className="grid grid-cols-[minmax(200px,1fr)_120px_120px_140px] gap-x-2 px-6 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 max-md:grid-cols-[minmax(140px,1fr)_84px_84px_96px]">
            <div>{t("nav_budget").toUpperCase()}</div>
            <div className="text-right">{t("budget_assignCol")}</div>
            <div className="text-right">{t("budget_activityCol")}</div>
            <div className="text-right">{t("budget_availableCol")}</div>
          </div>
        </div>

        {/* Table body */}
        <div className="flex-1 space-y-4 px-3 py-4">
          {data.groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={g}
              collapsed={collapsed.includes(g.id)}
              onToggle={() => toggle(g.id)}
              selection={sel}
              onSelect={setSel}
              editing={editing}
              setEditing={setEditing}
              onCommitAssign={commitAssign}
              onMenu={(e, id) => {
                e.stopPropagation();
                setGroupMenu({ id, x: e.clientX, y: e.clientY });
                setAddGroupId(id);
              }}
              onQuickAdd={() => {
                setAddOpen("category");
                setAddGroupId(g.id);
              }}
            />
          ))}
        </div>
      </div>

      {/* Inspector */}
      {sel && (
        <Inspector
          sel={sel}
          data={data}
          onClose={() => setSel(null)}
          onApply={apply}
          onCover={() => setCoverOpen(true)}
          onMove={() => setMoveOpen(true)}
          onRename={(id, name) => setRenameOpen({ kind: "category", id, name })}
          onDeleteCat={async (id) => {
            if (!confirm(t("confirm_deleteCat"))) return;
            try {
              await api.deleteCategory(id);
              setSel(null);
              await Promise.all([load(data.month), refreshBoot()]);
              toast("OK");
            } catch {
              toast(t("account_deleteWarn"), "err");
            }
          }}
        />
      )}

      {moveOpen && (
        <MoveMoneyModal
          data={data}
          onClose={() => setMoveOpen(false)}
          onDone={(d) => {
            apply(d);
            setMoveOpen(false);
          }}
        />
      )}
      {coverOpen && (
        <CoverModal
          data={data}
          initialCatId={sel?.kind === "cat" && sel.cat.available < 0 ? sel.cat.id : undefined}
          onClose={() => setCoverOpen(false)}
          onDone={(d) => {
            apply(d);
            setCoverOpen(false);
          }}
        />
      )}
      {addOpen && (
        <AddModal
          kind={addOpen}
          groups={boot.groups}
          initialGroupId={addGroupId}
          onClose={() => setAddOpen(null)}
          onDone={async () => {
            setAddOpen(null);
            await Promise.all([load(data.month), refreshBoot()]);
          }}
        />
      )}
      {groupMenu?.id !== undefined && groupMenu.id !== "__root__" && (
        <div
          className="anim-pop fixed z-50 w-40 rounded-xl border border-slate-100 bg-white py-1 shadow-pop"
          style={{ left: Math.min(groupMenu.x, window.innerWidth - 170), top: groupMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const grp = boot.groups.find((g) => g.id === groupMenu.id);
            if (!grp) return null;
            return (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setRenameOpen({ kind: "group", id: grp.id, name: grp.name });
                    setGroupMenu(null);
                  }}
                >
                  <Pencil size={13} /> {t("budget_rename")}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setAddOpen("category");
                    setGroupMenu(null);
                  }}
                >
                  <Plus size={13} /> {t("budget_addCategory")}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50"
                  onClick={async () => {
                    setGroupMenu(null);
                    try {
                      await api.deleteGroup(grp.id);
                      await Promise.all([load(data.month), refreshBoot()]);
                    } catch {
                      toast(lang === "zh" ? "分组不为空" : "Group is not empty", "err");
                    }
                  }}
                >
                  <Trash2 size={13} /> {t("budget_delete")}
                </button>
              </>
            );
          })()}
        </div>
      )}
      {renameOpen && (
        <RenameModal
          kind={renameOpen.kind}
          name={renameOpen.name}
          onClose={() => setRenameOpen(null)}
          onSave={async (name) => {
            if (renameOpen.kind === "group") await api.renameGroup(renameOpen.id, name);
            else await api.renameCategory(renameOpen.id, name);
            setRenameOpen(null);
            await Promise.all([load(data.month), refreshBoot()]);
          }}
        />
      )}
    </div>
  );
}

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function statusOf(c: BudCategory): "overspent" | "partial" | "funded" | "plain" | "income" {
  if (c.available < 0) return "overspent";
  if (c.goal && c.need && c.goal.type === "monthly" && c.goal.target > 0) {
    return c.assigned >= c.goal.target ? "funded" : "partial";
  }
  if (c.goal && c.need) return c.need.need <= 0 ? "funded" : c.assigned > 0 ? "partial" : "plain";
  return "plain";
}

const pillCls: Record<string, string> = {
  overspent: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  funded: "bg-emerald-100 text-emerald-700",
  plain: "",
  income: "",
};

function goalPct(c: BudCategory): number | null {
  if (!c.goal) return null;
  if (c.goal.type === "monthly" && c.goal.target > 0) return Math.min((c.assigned / c.goal.target) * 100, 100);
  if (c.goal.type === "targetBalance" && c.goal.target > 0) return Math.min((Math.max(c.available, 0) / c.goal.target) * 100, 100);
  if (c.goal.type === "targetByDate" && c.need) return Math.min((c.assigned / Math.max(c.need.need, 1)) * 100, 100);
  return null;
}

function GroupBlock({
  group,
  collapsed,
  onToggle,
  selection,
  onSelect,
  editing,
  setEditing,
  onCommitAssign,
  onMenu,
  onQuickAdd,
}: {
  group: BudGroup;
  collapsed: boolean;
  onToggle: () => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  editing: { catId: string; value: string } | null;
  setEditing: (e: { catId: string; value: string } | null) => void;
  onCommitAssign: (catId: string, v: string) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
  onQuickAdd: () => void;
}) {
  const { t, lang } = useApp();
  const cats = group.categories;
  const totals = cats.reduce(
    (acc, c) => ({
      assigned: acc.assigned + c.assigned,
      activity: acc.activity + c.activity,
      available: acc.available + c.available,
    }),
    { assigned: 0, activity: 0, available: 0 }
  );
  const groupName = group.virtual ? (lang === "zh" ? "信用卡还款" : "Credit Card Payments") : group.name;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <header
        className="grid cursor-pointer grid-cols-[minmax(200px,1fr)_120px_120px_140px] items-center gap-x-2 bg-slate-50/80 px-3 py-2 transition-colors hover:bg-slate-100/80 max-md:grid-cols-[minmax(140px,1fr)_84px_84px_96px]"
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5 pl-1 text-[13px] font-bold text-slate-700">
          <span className={`text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`}>›</span>
          {groupName}
          {!group.virtual && (
            <button
              className="ml-1 rounded p-0.5 text-slate-300 transition-colors hover:bg-slate-200 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                onMenu(e, group.id);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        <div className="num text-right text-[13px] font-semibold text-slate-500">{fmtMoney(totals.assigned)}</div>
        <div className="num text-right text-[13px] font-semibold text-slate-500">{fmtMoney(totals.activity)}</div>
        <div className="num text-right text-[13px] font-bold text-slate-600">{fmtMoney(totals.available)}</div>
      </header>
      {!collapsed && (
        <div className="border-t border-slate-100">
          {cats.map((c) => (
            <Row
              key={c.id}
              cat={c}
              selected={selection?.kind === "cat" && selection.cat.id === c.id}
              onSelect={() => onSelect({ kind: "cat", cat: c, groupId: group.id })}
              editing={editing?.catId === c.id ? editing.value : null}
              onStartEdit={() => setEditing({ catId: c.id, value: (c.assigned / 100).toString() })}
              onChange={(v) => setEditing({ catId: c.id, value: v })}
              onCancelEdit={() => setEditing(null)}
              onCommit={(v) => onCommitAssign(c.id, v)}
            />
          ))}
          {!group.virtual && (
            <button
              onClick={onQuickAdd}
              className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-50 hover:text-brand-600"
            >
              <Plus size={12} /> {t("budget_addCategory")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  cat,
  selected,
  onSelect,
  editing,
  onStartEdit,
  onChange,
  onCancelEdit,
  onCommit,
}: {
  cat: BudCategory;
  selected: boolean;
  onSelect: () => void;
  editing: string | null;
  onStartEdit: () => void;
  onChange: (v: string) => void;
  onCancelEdit: () => void;
  onCommit: (v: string) => void;
}) {
  const st = statusOf(cat);
  const pct = goalPct(cat);
  const activityPositive = cat.activity > 0;

  return (
    <div
      onClick={onSelect}
      className={`row-hover relative grid cursor-pointer grid-cols-[minmax(200px,1fr)_120px_120px_140px] items-center gap-x-2 border-b border-slate-50 px-3 py-[7px] text-[13px] transition-colors last:border-b-0 max-md:grid-cols-[minmax(140px,1fr)_84px_84px_96px] ${
        selected ? "bg-brand-50/80" : "hover:bg-slate-50"
      }`}
    >
      {pct != null && pct > 0 && (
        <div
          className="absolute bottom-0 left-0 h-[3px] rounded-full bg-gradient-to-r transition-all"
          style={{
            width: `${pct}%`,
            background: pct >= 100 ? "#10b981" : "linear-gradient(90deg,#f59e0b,#fbbf24)",
          }}
        />
      )}
      <div className="truncate pl-4 font-medium text-slate-700">{cat.name}</div>
      <div className="text-right" onClick={(e) => e.stopPropagation()}>
        {editing != null ? (
          <input
            autoFocus
            className="cell-input"
            value={editing}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onCommit(editing)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit(editing);
              if (e.key === "Escape") onCancelEdit();
            }}
          />
        ) : (
          <button
            onClick={onStartEdit}
            className={`num w-full rounded-md px-2 py-1 text-right text-[13px] transition-colors hover:bg-brand-50 ${
              cat.assigned === 0 ? "text-slate-300 hover:text-brand-500" : "font-medium text-slate-700"
            }`}
          >
            {cat.assigned === 0 ? "–" : fmtMoney(cat.assigned)}
          </button>
        )}
      </div>
      <div className={`num px-2 text-right text-[13px] ${activityPositive ? "text-emerald-600" : "text-slate-500"}`}>
        {cat.activity === 0 ? "–" : fmtMoney(cat.activity)}
      </div>
      <div className="flex justify-end px-1">
        <span
          className={`num rounded-md px-2 py-1 text-[13px] font-semibold ${
            st === "overspent"
              ? `${pillCls.overspent}`
              : st === "partial"
                ? `${pillCls.partial}`
                : st === "funded"
                  ? `${pillCls.funded}`
                  : cat.available < 0
                    ? ""
                    : "text-slate-700"
          }`}
        >
          {fmtMoney(cat.available)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ Inspector ------------------------------ */

function Inspector({
  sel,
  data,
  onClose,
  onApply,
  onCover,
  onMove,
  onRename,
  onDeleteCat,
}: {
  sel: Exclude<Selection, null>;
  data: BudgetData;
  onClose: () => void;
  onApply: (d: BudgetData) => void;
  onCover: () => void;
  onMove: () => void;
  onRename: (id: string, name: string) => void;
  onDeleteCat: (id: string) => void;
}) {
  const { t, lang, toast } = useApp();
  const [custom, setCustom] = useState("");

  const cat = sel.kind === "cat" ? sel.cat : null;
  const assign = async (cents: number) => {
    if (!cat) return;
    onApply(await api.assign(data.month, cat.id, cents));
    toast(fmtMoney(cents) + " ✓");
  };

  const goalForm = useMemo(() => {
    if (!cat?.goal) return { type: "", target: "", date: "" };
    return {
      type: cat.goal.type,
      target: cat.goal.target ? (cat.goal.target / 100).toString() : "",
      date: cat.goal.target_month ?? "",
    };
  }, [cat?.goal]);
  const [gf, setGf] = useState(goalForm);
  useEffect(() => setGf(goalForm), [goalForm]);

  return (
    <aside key={cat?.id ?? "rta"} className="anim-slide sticky top-0 hidden h-full w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 lg:block">
      {sel.kind === "rta" ? (
        <>
          <SectionTitle icon={<Coins size={15} />} title={t("inspector_readyToAssign")} onClose={onClose} />
          <div className={`num mt-3 text-3xl font-bold ${data.readyToAssign < 0 ? "text-rose-600" : "text-brand-600"}`}>
            {fmtMoney(data.readyToAssign)}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {lang === "zh"
              ? "这是尚未分配任何任务的钱。YNAB 第一法则：给每一块钱一个任务，把它分配到下面的分类里。"
              : "This is money with no job yet. Rule one: give every dollar a job by assigning it below."}
          </p>
          <Btn variant="primary" className="mt-4 w-full" onClick={() => api.autoAssign(data.month).then(onApply)}>
            <Sparkles size={14} /> {t("budget_autoAssign")}
          </Btn>
          <Btn className="mt-2 w-full" onClick={onMove}>
            <ArrowRightLeft size={14} /> {t("budget_moveMoney")}
          </Btn>
        </>
      ) : cat ? (
        <>
          <SectionTitle
            icon={<Target size={15} />}
            title={cat.name ?? ""}
            onClose={onClose}
            actions={
              <>
                <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => cat.name && onRename(cat.id, cat.name)}>
                  <Pencil size={13} />
                </button>
                <button className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onDeleteCat(cat.id)}>
                  <Trash2 size={13} />
                </button>
              </>
            }
          />

          <div
            className={`mt-3 rounded-xl p-3 ${
              cat.available < 0 ? "bg-rose-50" : "bg-slate-50"
            }`}
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("inspector_available")}</div>
            <div className={`num mt-0.5 text-3xl font-bold ${cat.available < 0 ? "text-rose-600" : "text-slate-800"}`}>
              {fmtMoney(cat.available)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{t("inspector_leftover")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <span className="text-slate-400">{t("inspector_assigned")}: </span>
                <b className="num text-slate-600">{fmtMoney(cat.assigned)}</b>
              </div>
              <div>
                <span className="text-slate-400">{t("inspector_activity")}: </span>
                <b className={`num ${cat.activity > 0 ? "text-emerald-600" : "text-slate-600"}`}>{fmtMoney(cat.activity)}</b>
              </div>
            </div>
          </div>

          {cat.available < 0 && (
            <Btn variant="danger" className="mt-3 w-full" onClick={onCover}>
              <AlertTriangle size={14} /> {t("budget_cover")} ({fmtMoney(Math.abs(cat.available))})
            </Btn>
          )}
          <Btn className="mt-2 w-full" onClick={onMove}>
            <ArrowRightLeft size={14} /> {t("inspector_moveBtn")}
          </Btn>

          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inspector_quickAssign")}</div>
            <div className="space-y-1.5">
              {cat.need != null && cat.need.need > 0 && (
                <QuickBtn label={t("inspector_needTarget", { amt: fmtMoney(cat.need.need) })} onClick={() => assign(cat.need!.need)} />
              )}
              <QuickBtn label={t("inspector_lastMonth", { amt: fmtMoney(cat.lastAssigned) })} onClick={() => assign(cat.lastAssigned)} />
              {cat.avgSpend > 0 && (
                <QuickBtn label={t("inspector_avgSpend", { amt: fmtMoney(cat.avgSpend) })} onClick={() => assign(cat.avgSpend)} />
              )}
              <div className="flex gap-1.5 pt-1">
                <input
                  className={inputCls + " num"}
                  placeholder={t("inspector_custom")}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const cents = parseAmountToCents(custom);
                      if (cents != null && cents >= 0) assign(cents).then(() => setCustom(""));
                    }
                  }}
                />
                <Btn
                  variant="primary"
                  onClick={() => {
                    const cents = parseAmountToCents(custom);
                    if (cents != null && cents >= 0) assign(cents).then(() => setCustom(""));
                  }}
                >
                  ✓
                </Btn>
              </div>
            </div>
          </div>

          {!cat.id.startsWith("cc:") && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <GoalEditor
                cat={cat}
                gf={gf}
                setGf={setGf}
                lang={lang}
                t={t}
                onSave={async () => {
                  if (!gf.type) return;
                  const cents = parseAmountToCents(gf.target || "0");
                  if (cents == null) return;
                  await api.setGoal(cat.id, {
                    type: gf.type as "monthly" | "targetBalance" | "targetByDate",
                    target: cents,
                    targetMonth: gf.date || null,
                  });
                  onApply(await api.budget(data.month));
                  toast("✓");
                }}
                onClear={async () => {
                  await api.clearGoal(cat.id);
                  onApply(await api.budget(data.month));
                }}
              />
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
}

function SectionTitle({
  icon,
  title,
  onClose,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="-mx-1 flex items-center gap-2 px-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{title}</h3>
      {actions}
      <button onClick={onClose} className="rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
        ✕
      </button>
    </div>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-[13px] font-medium text-slate-600 shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
    >
      {label}
    </button>
  );
}

function GoalEditor({
  cat,
  gf,
  setGf,
  t,
  onSave,
  onClear,
}: {
  cat: BudCategory;
  gf: { type: string; target: string; date: string };
  setGf: (g: { type: string; target: string; date: string }) => void;
  lang: string;
  t: (k: never) => string;
  onSave: () => void;
  onClear: () => void;
}) {
  const showTarget = gf.type !== "";
  const showDate = gf.type === "targetByDate";
  const pct =
    cat.goal?.type === "monthly" && cat.goal.target > 0
      ? Math.min((cat.assigned / cat.goal.target) * 100, 100)
      : cat.goal?.type === "targetBalance" && cat.goal.target > 0
        ? Math.min((Math.max(cat.available, 0) / cat.goal.target) * 100, 100)
        : null;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inspector_goal" as never)}</div>
        {cat.goal && (
          <button onClick={onClear} className="text-[11px] font-medium text-rose-500 hover:underline">
            {t("inspector_clearGoal" as never)}
          </button>
        )}
      </div>
      {pct != null && (
        <div className="mb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      <Field label={t("inspector_goalType" as never)}>
        <select className={inputCls} value={gf.type} onChange={(e) => setGf({ ...gf, type: e.target.value })}>
          <option value="">—</option>
          <option value="monthly">{t("inspector_monthly" as never)}</option>
          <option value="targetBalance">{t("inspector_targetBalance" as never)}</option>
          <option value="targetByDate">{t("inspector_targetByDate" as never)}</option>
        </select>
      </Field>
      {showTarget && (
        <Field label={t("inspector_goalAmount" as never)}>
          <input className={inputCls + " num"} value={gf.target} onChange={(e) => setGf({ ...gf, target: e.target.value })} placeholder="0.00" />
        </Field>
      )}
      {showDate && (
        <Field label={t("inspector_goalDate" as never)}>
          <input type="date" className={inputCls} value={gf.date} onChange={(e) => setGf({ ...gf, date: e.target.value })} />
        </Field>
      )}
      {(showTarget || cat.goal) && (
        <Btn variant="primary" className="mt-1 w-full" onClick={onSave}>
          {t("common_save" as never)}
        </Btn>
      )}
    </>
  );
}

/* ------------------------------ Modals ------------------------------ */

function MoveMoneyModal({ data, onClose, onDone }: { data: BudgetData; onClose: () => void; onDone: (d: BudgetData) => void }) {
  const { t, lang, toast } = useApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const opts = data.groups.flatMap((g) => [
    <optgroup key={g.id} label={g.virtual ? (lang === "zh" ? "信用卡还款" : "Credit Card Payments") : g.name}>
      {g.categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} — {fmtMoney(Math.max(c.available, 0))}
        </option>
      ))}
    </optgroup>,
  ]);

  return (
    <Modal title={t("move_title")} onClose={onClose}>
      <Field label={t("move_from")}>
        <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">—</option>
          {opts}
        </select>
      </Field>
      <Field label={t("move_to")}>
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {opts}
        </select>
      </Field>
      <Field label={t("move_amount")}>
        <input autoFocus className={inputCls + " num"} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </Field>
      <Btn
        variant="primary"
        className="w-full"
        onClick={async () => {
          const cents = parseAmountToCents(amount);
          if (!from || !to || from === to || !cents || cents <= 0) return;
          onDone(await api.moveMoney(data.month, from, to, cents));
          toast("✓");
        }}
      >
        <ArrowRightLeft size={14} /> {t("move_confirm")}
      </Btn>
    </Modal>
  );
}

function CoverModal({
  data,
  initialCatId,
  onClose,
  onDone,
}: {
  data: BudgetData;
  initialCatId?: string;
  onClose: () => void;
  onDone: (d: BudgetData) => void;
}) {
  const { t, lang } = useApp();
  const overspent = data.groups.flatMap((g) => g.categories).filter((c) => c.available < 0);
  const [catId, setCatId] = useState(initialCatId ?? overspent[0]?.id ?? "");
  const [fromId, setFromId] = useState<string>("rta");
  const donors = data.groups.flatMap((g) => g.categories).filter((c) => c.available > 0 && c.id !== catId);
  const catName = data.groups.flatMap((g) => g.categories).find((c) => c.id === catId)?.name ?? "";

  return (
    <Modal title={t("cover_title")} onClose={onClose}>
      {overspent.length === 0 ? (
        <p className="text-sm text-slate-500">{lang === "zh" ? "当前没有超支的分类。" : "Nothing is overspent right now."}</p>
      ) : (
        <>
          {overspent.length > 1 && (
            <Field label={t("budget_overspent")}>
              <select className={inputCls} value={catId} onChange={(e) => setCatId(e.target.value)}>
                {overspent.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({fmtMoney(c.available)})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="mb-3 text-[13px] leading-relaxed text-slate-500">
            {t("cover_intro", { name: catName, amount: fmtMoney(Math.abs(overspent.find((c) => c.id === catId)?.available ?? 0)) })}
          </p>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {data.readyToAssign > 0 && (
              <DonorOption
                active={fromId === "rta"}
                label={t("cover_useRta")}
                sub={fmtMoney(data.readyToAssign)}
                onClick={() => setFromId("rta")}
              />
            )}
            {donors.map((c) => (
              <DonorOption key={c.id} active={fromId === c.id} label={c.name ?? ""} sub={fmtMoney(c.available)} onClick={() => setFromId(c.id)} />
            ))}
          </div>
          <Btn
            variant="primary"
            className="mt-4 w-full"
            onClick={async () => {
              if (!catId || !fromId) return;
              onDone(await api.coverOverspending(data.month, catId, fromId));
            }}
          >
            {t("inspector_coverBtn")}
          </Btn>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {lang === "zh" ? "第三法则：灵活应变，随时调整预算。" : "Rule three: roll with the punches."}
          </p>
        </>
      )}
    </Modal>
  );
}

function DonorOption({ active, label, sub, onClick }: { active: boolean; label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-all ${
        active ? "border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-300" : "border-slate-200 text-slate-600 hover:border-slate-300"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="num ml-2 shrink-0 text-slate-400">{sub}</span>
    </button>
  );
}

function AddModal({
  kind,
  groups,
  initialGroupId,
  onClose,
  onDone,
}: {
  kind: "group" | "category";
  groups: { id: string; name: string }[];
  initialGroupId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useApp();
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(initialGroupId || groups[0]?.id || "");

  return (
    <Modal title={kind === "group" ? t("budget_addGroup") : t("budget_addCategory")} onClose={onClose}>
      <Field label={t("budget_name")}>
        <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {kind === "category" && (
        <Field label={lang === "zh" ? "所属分组" : "Group"}>
          <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Btn
        variant="primary"
        className="w-full"
        onClick={async () => {
          if (!name.trim()) return;
          if (kind === "group") await api.addGroup(name.trim());
          else await api.addCategory(groupId, name.trim());
          await onDone();
        }}
      >
        <Plus size={14} /> {t("common_add")}
      </Btn>
    </Modal>
  );
}

function RenameModal({ name: init, onClose, onSave }: { kind: string; name: string; onClose: () => void; onSave: (n: string) => void }) {
  const { t } = useApp();
  const [name, setName] = useState(init);
  return (
    <Modal title={t("budget_rename")} onClose={onClose}>
      <Field label={t("budget_name")}>
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
        />
      </Field>
      <Btn variant="primary" className="w-full" onClick={() => name.trim() && onSave(name.trim())}>
        {t("common_save")}
      </Btn>
    </Modal>
  );
}

function EmptyStart() {
  const { t, refreshBoot, toast } = useApp();
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <div className="anim-pop max-w-lg text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-xl shadow-brand-600/25">
          <CalendarDays size={30} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{t("empty_welcomeTitle")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-500">{t("empty_welcomeDesc")}</p>
        <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3 text-left">
          {[t("rule1"), t("rule2"), t("rule3"), t("rule4")].map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-medium text-slate-600 shadow-sm">
              <span className="mr-1.5 font-bold text-brand-500">{i + 1}</span>
              {r}
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Btn
            variant="primary"
            onClick={async () => {
              try {
                await api.loadDemo();
                await refreshBoot();
                location.reload();
              } catch {
                toast(t("common_error"), "err");
              }
            }}
          >
            <Sparkles size={14} /> {t("empty_loadDemo")}
          </Btn>
          <Btn onClick={() => location.reload()}>{t("empty_startFresh")}</Btn>
        </div>
      </div>
    </div>
  );
}
