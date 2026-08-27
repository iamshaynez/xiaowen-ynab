import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-navy-950/40 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={`anim-pop max-h-[85vh] w-full ${width} overflow-y-auto rounded-2xl bg-white shadow-pop`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Btn({
  children,
  variant = "default",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  const styles = {
    default:
      "bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 shadow-sm",
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export function Spinner() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
    </div>
  );
}
