import { useState } from "react";
import { Lock } from "lucide-react";
import { useApp } from "../store";
import { Btn, inputCls } from "../components/ui";

export function LoginPage() {
  const { t, login } = useApp();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await login(password);
    } catch {
      setError(t("login_invalid"));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-card">
          <div className="mb-1 flex items-center gap-2 text-brand-600">
            <Lock size={18} />
            <h1 className="text-lg font-semibold text-slate-900">{t("login_title")}</h1>
          </div>
          <p className="mb-5 text-xs leading-relaxed text-slate-400">{t("login_desc")}</p>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("login_password")}</span>
            <input
              type="password"
              autoFocus
              className={inputCls}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              aria-label={t("login_password")}
            />
          </label>

          {error && <p className="mb-3 text-xs font-medium text-rose-600">{error}</p>}

          <Btn type="submit" variant="primary" disabled={!password || busy} className="w-full">
            {busy ? t("login_checking") : t("login_button")}
          </Btn>
        </div>
      </form>
    </div>
  );
}
