"use client";

import { useState } from "react";

interface WaterfallResult {
  providersAttempted: string[];
  providersHit: string[];
  candidates: { email: string; provider: string; verificationStatus: string; confidence: number }[];
  durationMs: number;
}

export function LeadActions({ leadId, status, onComplete }: { leadId: number; status: string; onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallResult | null>(null);

  async function runAction(action: string) {
    setRunning(action);
    setResult(null);
    setWaterfall(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        if (action === "find-email" && data.waterfall) {
          setWaterfall(data.waterfall);
          const msg = data.email
            ? `Found: ${data.email} (via ${data.source})`
            : "No verified email found";
          setResult({ success: !!data.email, message: msg });
        } else {
          const msgs: Record<string, string> = {
            linkedin: `LinkedIn — ${data.found || 0} found`,
            extract: `Extracted — ${data.enriched || 0} enriched`,
            score: `Scored — ${data.scored || 0} scored`,
            outreach: `Outreach — ${data.generated || 0} generated`,
          };
          setResult({ success: true, message: msgs[action] || "Done" });
        }
        onComplete();
      } else {
        setResult({ success: false, message: data.error || "Failed" });
      }
    } catch {
      setResult({ success: false, message: "Request failed" });
    } finally {
      setRunning(null);
    }
  }

  const providerLabels: Record<string, string> = {
    website: "Website (Claude extraction)",
    hunter: "Hunter.io",
    apollo: "Apollo.io",
    snov: "Snov.io",
    dropcontact: "Dropcontact",
  };

  const verificationColors: Record<string, string> = {
    valid: "text-green-400",
    catch_all: "text-yellow-400",
    unknown: "text-[var(--muted)]",
    risky: "text-orange-400",
    invalid: "text-red-400",
    unverified: "text-[var(--muted)]",
  };

  const actions = [
    { key: "linkedin", label: "LinkedIn", icon: "🔗", desc: "Find owner/founder profile via Google — tenure & title insights", needs: "scraped", color: "bg-blue-800 hover:bg-blue-700" },
    { key: "extract", label: "Extract", icon: "🔍", desc: "AI reads website + LinkedIn", needs: "scraped", color: "bg-purple-800 hover:bg-purple-700" },
    { key: "find-email", label: "Find Email", icon: "📧", desc: "Waterfall: Website → Hunter → Apollo → Snov", needs: "enriched", color: "bg-cyan-800 hover:bg-cyan-700" },
    { key: "score", label: "Score", icon: "📊", desc: "Avatar fit scoring", needs: "enriched", color: "bg-yellow-800 hover:bg-yellow-700" },
    { key: "outreach", label: "Outreach", icon: "✉️", desc: "Generate Paul's email", needs: "scored", color: "bg-green-800 hover:bg-green-700" },
  ];

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 mb-4">
      <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">Run Pipeline Stage</h3>
      <div className="flex gap-2 flex-wrap">
        {actions.map((a) => (
          <button
            key={a.key}
            onClick={() => runAction(a.key)}
            disabled={running !== null}
            className={`${a.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5`}
            title={a.desc}
          >
            <span>{a.icon}</span>
            {running === a.key ? `Running...` : a.label}
          </button>
        ))}
      </div>

      {/* Email waterfall results */}
      {waterfall && (
        <div className="mt-3 bg-[var(--bg)] rounded-lg p-3 border border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Email Waterfall</span>
            <span className="text-xs text-[var(--muted)]">{waterfall.durationMs}ms</span>
          </div>
          <div className="space-y-1.5">
            {waterfall.providersAttempted.map((provider) => {
              const hit = waterfall.providersHit.includes(provider);
              const candidate = waterfall.candidates.find((c) => c.provider === provider);
              return (
                <div key={provider} className="flex items-center gap-2 text-xs">
                  <span className={`w-4 text-center ${hit ? "text-green-400" : "text-red-400"}`}>
                    {hit ? "✓" : "✗"}
                  </span>
                  <span className="w-32 truncate">{providerLabels[provider] || provider}</span>
                  {candidate ? (
                    <>
                      <span className="font-mono text-green-400 truncate max-w-[180px]">{candidate.email}</span>
                      <span className={`${verificationColors[candidate.verificationStatus] || "text-[var(--muted)]"}`}>
                        {candidate.verificationStatus}
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">no result</span>
                  )}
                </div>
              );
            })}
          </div>
          {waterfall.providersAttempted.length === 0 && (
            <p className="text-xs text-[var(--muted)]">No providers configured — add API keys to .env.local</p>
          )}
        </div>
      )}

      {result && !waterfall && (
        <p className={`text-xs mt-2 ${result.success ? "text-green-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}
      {result && waterfall && (
        <p className={`text-xs mt-2 ${result.success ? "text-green-400" : "text-yellow-400"}`}>
          {result.message}
        </p>
      )}
      <p className="text-xs text-[var(--muted)] mt-2">
        Run individual stages on this lead. Current status: <strong>{status}</strong>
      </p>
    </div>
  );
}
