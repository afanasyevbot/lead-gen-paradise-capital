"use client";

import { useEffect, useState, useCallback } from "react";

interface StageCoverage {
  name: string;
  have: number;
  eligible: number;
  pct: number;
  warn: boolean;
}

interface HealthResponse {
  total_leads: number;
  stages: StageCoverage[];
  funnel: {
    scored: number;
    outreach_generated: number;
    outreach_failed: number;
    conversion_pct: number;
    stuck_in_scored: number;
  };
  attention: {
    noisy_names: number;
    stale_scrape_failed: number;
    unverified_founders: number;
    low_conf_high_score: number;
    emails_not_found: number;
    email_miss_rate: number;
  };
  byStatus: Record<string, number>;
}

function pctLabel(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function CoverageBar({ s }: { s: StageCoverage }) {
  const tone = s.warn ? "bg-red-500" : s.pct > 0.85 ? "bg-green-500" : "bg-yellow-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-semibold capitalize">{s.name}</span>
        <span className="tabular-nums text-[var(--muted)]">
          {s.have}/{s.eligible} · {pctLabel(s.pct)}
        </span>
      </div>
      <div className="w-full bg-[var(--border)] rounded-full h-1.5">
        <div className={`${tone} h-1.5 rounded-full transition-all`}
             style={{ width: `${Math.min(100, s.pct * 100)}%` }} />
      </div>
    </div>
  );
}

export default function PipelineHealth() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/pipeline/health");
      if (!r.ok) {
        setError(`Health endpoint returned ${r.status}: ${await r.text().catch(() => "")}`);
        return;
      }
      setData(await r.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAction(action: string, label: string) {
    setActionMsg(`Running ${label}…`);
    try {
      const r = await fetch("/api/pipeline/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      setActionMsg(`${label}: ${j.affected ?? 0} lead(s) affected`);
      await load();
    } catch (e) {
      setActionMsg(`${label} failed: ${String(e)}`);
    }
  }

  if (error) {
    return (
      <div className="border border-red-800 rounded-lg bg-red-950/40 p-4 mb-6 text-xs text-red-300">
        <div className="font-semibold mb-1">Pipeline Health unavailable</div>
        <div className="font-mono text-[11px] break-all">{error}</div>
        <button onClick={load} className="mt-2 underline">Retry</button>
      </div>
    );
  }
  if (!data) return <div className="text-xs text-[var(--muted)] mb-6">Loading pipeline health…</div>;

  const attentionTotal =
    data.attention.noisy_names +
    data.attention.stale_scrape_failed +
    data.attention.unverified_founders +
    data.attention.low_conf_high_score;

  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--card)] p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">Pipeline Health</h2>
        <button onClick={load}
          className="text-xs text-[var(--muted)] hover:text-[var(--fg)] underline">
          Refresh
        </button>
      </div>

      {/* Stage coverage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {data.stages.map((s) => <CoverageBar key={s.name} s={s} />)}
      </div>

      {/* Funnel */}
      <div className="border-t border-[var(--border)] pt-3 mb-4">
        <div className="text-xs font-semibold mb-2">Outreach Funnel</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="tabular-nums">
            <strong className="text-yellow-400">{data.funnel.scored}</strong> stuck in scored
          </span>
          <span className="text-[var(--muted)]">→</span>
          <span className="tabular-nums">
            <strong className="text-green-400">{data.funnel.outreach_generated}</strong> outreach
          </span>
          <span className="text-[var(--muted)]">·</span>
          <span className="tabular-nums text-[var(--muted)]">
            {pctLabel(data.funnel.conversion_pct)} conversion
          </span>
          {data.funnel.outreach_failed > 0 && (
            <>
              <span className="text-[var(--muted)]">·</span>
              <span className="tabular-nums text-red-400">
                {data.funnel.outreach_failed} failed
              </span>
            </>
          )}
        </div>
      </div>

      {/* Attention queue */}
      {attentionTotal > 0 && (
        <div className="border-t border-[var(--border)] pt-3 mb-4">
          <div className="text-xs font-semibold mb-2">
            Attention Required <span className="text-red-400">({attentionTotal})</span>
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-xs">
            {data.attention.noisy_names > 0 && (
              <div>🚨 Parse-failure names: <span className="tabular-nums">{data.attention.noisy_names}</span></div>
            )}
            {data.attention.stale_scrape_failed > 0 && (
              <div>⏰ Stale scrape fails (&gt;7d): <span className="tabular-nums">{data.attention.stale_scrape_failed}</span></div>
            )}
            {data.attention.unverified_founders > 0 && (
              <div>❓ Unverified founder claims: <span className="tabular-nums">{data.attention.unverified_founders}</span></div>
            )}
            {data.attention.low_conf_high_score > 0 && (
              <div>🤔 Low-conf high-score: <span className="tabular-nums">{data.attention.low_conf_high_score}</span></div>
            )}
            {data.attention.email_miss_rate > 0.5 && (
              <div className="col-span-2">
                📧 Email miss rate: <span className="tabular-nums text-red-400">{pctLabel(data.attention.email_miss_rate)}</span>
                {" "}({data.attention.emails_not_found} not found)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin actions */}
      <div className="border-t border-[var(--border)] pt-3">
        <div className="text-xs font-semibold mb-2">Admin Actions</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => runAction("backfill_linkedin", "LinkedIn backfill")}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--card)]">
            Backfill LinkedIn
          </button>
          <button onClick={() => runAction("retry_scrape_failed", "Retry stale scrape fails")}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--card)]">
            Retry stale scrape_failed
          </button>
          <button onClick={() => runAction("rescan_emails", "Rescan scraped content for emails")}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--card)]">
            Rescan emails
          </button>
          <button onClick={() => runAction("delete_noisy", "Delete noisy leads")}
            className="text-xs px-3 py-1.5 rounded border border-red-800 hover:border-red-500 bg-[var(--card)] text-red-300">
            Delete noisy leads
          </button>
        </div>
        {actionMsg && <div className="text-xs text-[var(--muted)] mt-2">{actionMsg}</div>}
      </div>
    </div>
  );
}
