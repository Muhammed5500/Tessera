"use client";

import { useState, type ReactNode } from "react";

/** Kopyala düğmeli kod bloğu. */
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d1015]">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span>{label ?? ""}</span>
        <button
          className="hover:text-text"
          onClick={() => {
            navigator.clipboard?.writeText(children).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <pre className="mono overflow-x-auto p-3 text-xs leading-relaxed text-[#c9d1dc]">{children}</pre>
    </div>
  );
}

/** Sayfa başlığı: başlık + kısa açıklama + sağda isteğe bağlı içerik. */
export function PageHeader({ title, children, right }: { title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {children && <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>}
      </div>
      {right}
    </div>
  );
}

/** Kart içi bölüm başlığı. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-medium">{children}</h2>
      {right}
    </div>
  );
}

export function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function LiveDot({ on = true }: { on?: boolean }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yes opacity-60" />}
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${on ? "bg-yes" : "bg-muted"}`} />
    </span>
  );
}

/** Enstrüman ikonu (BTC/ETH/SOL renkli, diğerleri baş harf). */
export function AssetIcon({ instId, size = 44 }: { instId?: string; size?: number }) {
  const base = instId?.split("-")[0] ?? "";
  const color = base === "BTC" ? "#f7931a" : base === "ETH" ? "#627eea" : base === "SOL" ? "#14f195" : "#3a4350";
  const glyph = base === "BTC" ? "₿" : base === "ETH" ? "Ξ" : base.slice(0, 1) || "?";
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg font-bold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {glyph}
    </span>
  );
}
