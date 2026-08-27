import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Hourglass, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { fmtMoney, fmtMonthShort } from "../format";
import type { ReportsData } from "../types";
import { Spinner } from "../components/ui";

const PALETTE = ["#6a63f0", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#84cc16", "#14b8a6", "#f97316"];

export function ReportsPage() {
  const { lang, t } = useApp();
  const [data, setData] = useState<ReportsData | null>(null);

  useEffect(() => {
    api.reports(12).then(setData).catch(() => {});
  }, []);

  if (!data) return <Spinner />;

  const nw = data.netWorth.map((p) => ({
    ...p,
    label: fmtMonthShort(p.month, lang),
    liabilitiesAbs: Math.abs(p.liabilities),
  }));
  const ie = data.months.map((m, i) => ({
    label: fmtMonthShort(m, lang),
    income: data.income[i].value / 100,
    expense: data.expense[i].value / 100,
    _income: data.income[i].value,
    _expense: data.expense[i].value,
  }));
  const pie = data.breakdown.filter((b) => b.value > 0).map((b) => ({ name: b.name, value: b.value / 100, _raw: b.value }));
  const cur = data.income[data.income.length - 1];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t("nav_reports")}</h1>
        <span className="text-xs text-slate-400">{t("rep_months", { n: 12 })}</span>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Scale size={13} /> {t("rep_now")}
          </div>
          <div className={`num mt-2 text-2xl font-bold ${data.netWorthNow < 0 ? "text-rose-600" : "text-slate-900"}`}>
            {fmtMoney(data.netWorthNow)}
          </div>
          <div className="mt-1.5 flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-emerald-600">
              <TrendingUp size={12} /> {t("rep_assets")} {fmtMoney(data.totalAssets)}
            </span>
            <span className="flex items-center gap-1 text-rose-500">
              <TrendingDown size={12} /> {t("rep_liabilities")} {fmtMoney(data.totalLiabilities)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Hourglass size={13} /> {t("rep_aom")}
          </div>
          <div className="num mt-2 text-2xl font-bold text-slate-900">{t("rep_aomDays", { n: data.ageOfMoney })}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t("rep_aomDesc")}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <TrendingUp size={13} /> {t("rep_income")} ({fmtMonthShort(cur?.month ?? "", lang)})
          </div>
          <div className="num mt-2 text-2xl font-bold text-emerald-600">{fmtMoney(cur?.value ?? 0)}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {lang === "zh" ? "所有预算内账户的本月流入。" : "Total inflows to on-budget accounts this month."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Net worth */}
        <Card title={t("rep_netWorth")}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={nw} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6a63f0" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#6a63f0" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={70}
                tickFormatter={(v: number) => compactMoney(v)} />
              <Tooltip content={<MoneyTooltip />} cursor={{ stroke: "#c7d2fe" }} formatter={(v: number | string) => [fmtMoney(Number(v) * 100), t("rep_net")]} />
              <Area type="monotone" dataKey="net" stroke="#6a63f0" strokeWidth={2.5} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Income vs Expense */}
        <Card title={t("rep_incomeExpense")}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={70}
                tickFormatter={(v: number) => compactMoney(v * 100)} />
              <Tooltip content={<IETooltip />} cursor={{ fill: "rgba(106,99,240,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name={t("rep_income")} fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="expense" name={t("rep_expense")} fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Breakdown donut */}
        <Card title={t("rep_breakdown")}>
          {pie.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="flex items-center">
              <ResponsiveContainer width="55%" height={250}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                    {pie.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip total={pie.reduce((s, p) => s + p.value, 0)} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="max-h-[250px] flex-1 space-y-1 overflow-y-auto pr-1">
                {pie.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-slate-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="min-w-0 flex-1 truncate text-slate-600">{p.name}</span>
                    <span className="num font-medium text-slate-700">{fmtMoney(p._raw)}</span>
                    <span className="num w-10 text-right text-[11px] text-slate-400">
                      {Math.round((p._raw / pie.reduce((s, x) => s + x._raw, 0)) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Top payees */}
        <Card title={t("rep_topPayees")}>
          {data.topPayees.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-2 pt-1">
              {data.topPayees.map((p, i) => {
                const max = data.topPayees[0]?.value || 1;
                const pct = Math.max((p.value / max) * 100, 4);
                return (
                  <div key={i} className="group relative overflow-hidden rounded-lg bg-slate-50/80 px-3 py-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-100 to-brand-50 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className="truncate pr-3 text-[13px] font-medium text-slate-700">{p.name}</span>
                      <span className="num text-[13px] font-semibold text-brand-700">{fmtMoney(p.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Income sources */}
        <Card title={t("rep_incomeSources")}>
          {data.incomeSources.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-2 pt-1">
              {data.incomeSources.map((p, i) => {
                const max = data.incomeSources[0]?.value || 1;
                const pct = Math.max((p.value / max) * 100, 4);
                return (
                  <div key={i} className="group relative overflow-hidden rounded-lg bg-emerald-50/60 px-3 py-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-100 to-transparent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className="truncate pr-3 text-[13px] font-medium text-slate-700">{p.name}</span>
                      <span className="num text-[13px] font-semibold text-emerald-700">{fmtMoney(p.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
      <h2 className="mb-3 text-[13px] font-bold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

function EmptyChart() {
  return <div className="flex h-[220px] items-center justify-center text-sm text-slate-300">—</div>;
}

function compactMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? "-" : ""}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${v < 0 ? "-" : ""}${Math.round(abs / 10_000)}w`;
  if (abs >= 1000) return `${v < 0 ? "-" : ""}${(abs / 1000).toFixed(0)}k`;
  return String(Math.round(v));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MoneyTooltip(props: any) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-0.5 font-semibold text-slate-600">{label}</div>
      <div className="num font-bold text-brand-600">{fmtMoney(Number(payload[0].value) * 100)}</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IETooltip(props: any) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-semibold text-slate-600">{label}</div>
      {payload.map((p: { dataKey?: string; value?: number; name?: string }, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span style={{ color: p.dataKey === "income" ? "#10b981" : "#f43f5e" }}>{p.name}</span>
          <span className="num font-medium text-slate-700">{fmtMoney(Number(p.value) * 100)}</span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltip({ active, payload, total }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="font-semibold text-slate-600">{p.name}</div>
      <div className="num text-slate-800">{fmtMoney(Math.round(p.value * 100))}</div>
      <div className="num text-[11px] text-slate-400">{Math.round((p.value / total) * 100)}%</div>
    </div>
  );
}
