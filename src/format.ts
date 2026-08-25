import type { Lang } from "./i18n";

let currencySymbol = "¥";
export function setCurrencySymbol(s: string) {
  currencySymbol = s || "¥";
}

export function fmtMoney(cents: number, opts?: { sign?: boolean }): string {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : opts?.sign ? "+" : ""}${currencySymbol}${str}`;
}

export function fmtMoneyShort(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 100000000) return `${cents < 0 ? "-" : ""}${currencySymbol}${(abs / 100000000).toFixed(1)}亿`;
  if (abs >= 10000000) return `${cents < 0 ? "-" : ""}${currencySymbol}${(abs / 1000000).toFixed(0)}M`;
  if (abs >= 1000000) return `${cents < 0 ? "-" : ""}${currencySymbol}${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 100000) return `${cents < 0 ? "-" : ""}${currencySymbol}${Math.round(abs / 100000)}万`.replace("万", "万");
  return fmtMoney(cents);
}

export function fmtMonth(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, 1));
}

export function fmtMonthShort(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
  }).format(new Date(y, m - 1, 1));
}

export function fmtDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang === "zh") return `${Number(m)}月${Number(d)}日`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseAmountToCents(input: string): number | null {
  const s = input.replace(/[,，\s¥$￥]/g, "");
  if (!s || !/^-?\d*(\.\d*)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
}
