import { useEffect, useRef, useState } from "react";

let mermaidReady: Promise<{ render: (id: string, code: string) => Promise<{ svg: string }> }> | null = null;

async function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      return m.default as unknown as { render: (id: string, code: string) => Promise<{ svg: string }> };
    });
  }
  return mermaidReady;
}

let seq = 0;

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getMermaid()
      .then((m) => m.render(`mermaid-${++seq}`, chart.trim()))
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-100 bg-white p-3">
      {error ? <pre className="text-xs text-rose-500">{error}</pre> : <div ref={ref} />}
    </div>
  );
}
