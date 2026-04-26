"use client";

import { useState } from "react";

export function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  const borderClass = accent
    ? `border-l-4 ${accent}`
    : "border border-[var(--border)]";
  return (
    <div className={`bg-[var(--card)] ${borderClass} rounded-xl p-5 mb-4`}>
      <h2 className="text-sm font-semibold mb-3 text-[var(--muted)] uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="px-2 py-1 text-xs bg-[var(--border)] rounded hover:bg-[#333] transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
