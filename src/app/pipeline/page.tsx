"use client";

import { useState, useEffect, useRef } from "react";

interface Job {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { current: number; total: number; stage: string; currentItem: string };
  result?: Record<string, number>;
  error?: string;
  startedAt?: string;
}

interface PipelineSummary {
  pipeline: { total: number; pending: number; scraped: number; enriched: number; scored: number; outreach_generated: number; filtered_out: number; failed: number };
  highlights: { high_score_leads: number; emails_found: number; ready_to_push: number };
  score_distribution: { legacy_tier: number; high_tier: number; seed_tier: number; below_threshold: number };
  this_run_scores: { score_8_plus: number; score_7: number; score_5_6: number; score_below_5: number; total_scored: number; filtered_out: number } | null;
  cost: { total_usd: number; by_stage: Record<string, number>; leads_billed: number };
}

interface ScoredLead {
  id: number;
  business_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  score: number;
  confidence: string;
  recommended_action: string;
  avatar_fit?: string;
  reasoning?: string;
  primary_signals?: string[];
  risk_factors?: string[];
  owner_name?: string;
  estimated_owner_age?: string;
  estimated_revenue_range?: string;
  is_likely_founder?: boolean;
}

const CORE_STAGES = [
  { key: "scrape-websites", label: "Websites", desc: "Scrape lead websites" },
  { key: "linkedin", label: "LinkedIn", desc: "Find owner profiles" },
  { key: "extract", label: "Extract", desc: "Founder + age + revenue signals" },
  { key: "score", label: "Score", desc: "Avatar fit scoring" },
  { key: "emails", label: "Emails", desc: "Find founder emails" },
  { key: "outreach", label: "Outreach", desc: "Tiered emails for Paul" },
];

const ENRICH_STAGES = [
  { key: "extract", label: "Extract", desc: "Founder + age + revenue signals" },
  { key: "score", label: "Score", desc: "Avatar fit scoring" },
  { key: "emails", label: "Emails", desc: "Find founder emails" },
  { key: "outreach", label: "Outreach", desc: "Tiered emails for Paul" },
];

type PipelineMode = "core" | "enrich-only";

const PIPELINE_CONFIGS: { key: PipelineMode; label: string; desc: string; endpoint: string; stages: typeof CORE_STAGES }[] = [
  {
    key: "core",
    label: "Full Pipeline (6 stages)",
    desc: "Scrape websites → LinkedIn → Extract → Score → Emails → Outreach",
    endpoint: "/api/pipeline",
    stages: CORE_STAGES,
  },
  {
    key: "enrich-only",
    label: "Enrich Only (4 stages)",
    desc: "Skip scraping — extract, score, find emails & write outreach for already-scraped leads",
    endpoint: "/api/enrich-only",
    stages: ENRICH_STAGES,
  },
];

function SummaryStat({ label, value, tone, hint }: { label: string; value: number; tone: "green" | "yellow" | "red" | "neutral"; hint?: string }) {
  const toneClass = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
    neutral: "text-[var(--fg)]",
  }[tone];
  const dimmed = value === 0 ? "opacity-40" : "";
  return (
    <div className={`flex flex-col ${dimmed}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-[var(--muted)]">{label}</span>
        <span className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</span>
      </div>
      {hint && <span className="text-[10px] text-[var(--muted)] italic">{hint}</span>}
    </div>
  );
}

const TIER_COLORS: Record<string, { text: string; bg: string }> = {
  "green-400": { text: "text-green-400", bg: "bg-green-400" },
  "green-300": { text: "text-green-300", bg: "bg-green-300" },
  "yellow-400": { text: "text-yellow-400", bg: "bg-yellow-400" },
  "gray-500": { text: "text-gray-500", bg: "bg-gray-500" },
};

function ScoreTier({ label, sublabel, count, total, color }: { label: string; sublabel: string; count: number; total: number; color: keyof typeof TIER_COLORS }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const c = TIER_COLORS[color];
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className={c.text}>
          <strong>{label}</strong> <span className="text-[var(--muted)] text-xs">· {sublabel}</span>
        </span>
        <span className="tabular-nums">
          <strong>{count}</strong> <span className="text-[var(--muted)] text-xs">({pct}%)</span>
        </span>
      </div>
      <div className="w-full bg-[var(--border)] rounded-full h-1">
        <div className={`${c.bg} h-1 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StageBox({ stage, isActive, isDone }: { stage: { key: string; label: string; desc: string }; isActive: boolean; isDone: boolean }) {
  return (
    <div
      className={`p-3 rounded-lg border text-center text-xs ${
        isActive
          ? "border-[var(--accent)] bg-blue-950"
          : isDone
          ? "border-green-800 bg-green-950"
          : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <p className="font-semibold text-sm">{stage.label}</p>
      <p className="text-[var(--muted)] text-[10px] mt-0.5">{stage.desc}</p>
      {isActive && <p className="text-[var(--accent)] mt-1 animate-pulse text-[10px]">Running...</p>}
      {isDone && <p className="text-green-400 mt-1 text-[10px]">Done</p>}
    </div>
  );
}

export default function PipelinePage() {
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [limit, setLimit] = useState(50);
  const [minScore, setMinScore] = useState(5);
  const [mode, setMode] = useState<PipelineMode>("core");
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [scoredLeads, setScoredLeads] = useState<ScoredLead[]>([]);
  const [scoredLeadsState, setScoredLeadsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [scoredLeadsError, setScoredLeadsError] = useState<string | null>(null);
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const [xrayReset, setXrayReset] = useState<number | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function resetXrayLeads() {
    const r = await fetch("/api/leads?action=reset-xray", { method: "PATCH" });
    const { reset } = await r.json();
    setXrayReset(reset);
  }

  const config = PIPELINE_CONFIGS.find((c) => c.key === mode)!;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function runPipeline() {
    setRunning(true);
    setJob(null);
    setSummary(null);
    setScoredLeads([]);
    setScoredLeadsState("idle");
    setScoredLeadsError(null);
    setExpandedLead(null);

    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit, minScore }),
    });
    const body = await res.json();

    if (!res.ok) {
      setRunning(false);
      const msg = body?.error ?? `Error ${res.status}`;
      if (res.status === 409) setLockError(msg);
      setJob({ id: "", status: "failed", progress: { current: 0, total: 0, stage: "", currentItem: "" }, error: msg, startedAt: undefined });
      return;
    }
    setLockError(null);

    const { jobId } = body;

    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) {
        // Job not found or server error — stop polling gracefully
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        return;
      }
      const j: Job = await r.json();
      setJob(j);
      if (j.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        // Fetch meaningful summary after completion — pass job start time for cost scoping
        const since = encodeURIComponent(j.startedAt ?? "");
        fetch(`/api/pipeline/summary?since=${since}`)
          .then((r) => r.json())
          .then(setSummary)
          .catch(() => {});
        const scoredCount = j.result?.scored ?? 0;
        // Always fetch — even if scored=0, we want to show the most recent
        // scored leads (useful for enrich-only re-runs). Fallback to 20.
        const fetchLimit = scoredCount > 0 ? scoredCount : 20;
        setScoredLeadsState("loading");
        fetch(`/api/pipeline/scored-leads?limit=${fetchLimit}`)
          .then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
            return r.json();
          })
          .then((d) => {
            const leads = (d.leads ?? []) as ScoredLead[];
            setScoredLeads([...leads].sort((a, b) => b.score - a.score));
            setScoredLeadsState("loaded");
          })
          .catch((err) => {
            setScoredLeadsError(err instanceof Error ? err.message : String(err));
            setScoredLeadsState("error");
          });
      }
    }, 2000);
  }

  const activeStageIdx = job?.progress.stage
    ? config.stages.findIndex((s) => {
        const stageText = job.progress.stage.toLowerCase();
        const keyBase = s.key.split("-")[0];
        // Match "emails" key to "Finding founder emails" stage text
        return stageText.includes(keyBase) || (keyBase === "emails" && stageText.includes("email"));
      })
    : -1;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Enrichment Pipeline</h1>
      <p className="text-sm text-[var(--muted)] mb-6">
        Find founders matching Paul&apos;s avatar: original founder, 60s, $5-50M revenue, people of faith.
      </p>

      {/* Pipeline mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {PIPELINE_CONFIGS.map((pc) => (
          <button
            key={pc.key}
            onClick={() => !running && setMode(pc.key)}
            disabled={running}
            className={`p-4 rounded-lg border text-left text-sm transition-colors ${
              mode === pc.key
                ? "border-[var(--accent)] bg-blue-950"
                : "border-[var(--border)] bg-[var(--card)] hover:border-[#555]"
            } disabled:opacity-50`}
          >
            <p className="font-semibold">{pc.label}</p>
            <p className="text-xs text-[var(--muted)] mt-1">{pc.desc}</p>
          </button>
        ))}
      </div>

      {/* Stage visualization */}
      <div className="flex gap-2 mb-6">
        {config.stages.map((stage, i) => (
          <div key={stage.key} className="flex-1 relative">
            <StageBox
              stage={stage}
              isActive={running && i === activeStageIdx}
              isDone={job?.status === "completed" || (running && i < activeStageIdx)}
            />
            {i < config.stages.length - 1 && (
              <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs z-10">&rarr;</div>
            )}
          </div>
        ))}
      </div>

      {/* Info box when no job has run */}
      {!job && !running && (
        <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 mb-6 text-sm">
          <p className="font-medium text-[var(--fg)] mb-2">How it works</p>
          <ul className="text-[var(--muted)] space-y-1 text-xs">
            <li><strong>Website Scrape</strong> &mdash; pulls homepage + about page text (free, no API cost)</li>
            <li><strong>LinkedIn</strong> &mdash; finds owner profile via Google search (free, confirms founder title)</li>
            <li><strong>Extract</strong> &mdash; AI reads website + LinkedIn to detect founder status, age, revenue, faith signals</li>
            <li><strong>Emails</strong> &mdash; finds founder emails from website data + Apollo.io API</li>
            <li><strong>Score</strong> &mdash; AI scores against Paul&apos;s avatar (founder gate, age 60s, $5-50M revenue)</li>
            <li><strong>Outreach</strong> &mdash; AI writes tiered emails in Paul&apos;s voice (Legacy for 7+, Seed Planter for 5-6)</li>
          </ul>
          <div className="flex gap-3 mt-3 flex-wrap items-center">
            <a href="/scrape" className="text-[var(--accent)] hover:underline text-xs">Scrape leads &rarr;</a>
            <a href="/upload" className="text-[var(--accent)] hover:underline text-xs">Upload CSV &rarr;</a>
          </div>
          <div className="flex gap-3 mt-3 flex-wrap items-center">
            <button
              onClick={async () => { const r = await fetch("/api/leads?action=reset-all-failed", { method: "PATCH" }); const d = await r.json(); setXrayReset(d.reset); }}
              className="px-3 py-1.5 bg-red-900/50 text-red-300 border border-red-700/50 rounded-lg text-xs font-medium hover:bg-red-900"
            >
              Re-run all failed
            </button>
            <span className="text-[var(--muted)] text-xs">or individually:</span>
            <button
              onClick={async () => { const r = await fetch("/api/leads?action=reset-xray", { method: "PATCH" }); const d = await r.json(); setXrayReset(d.reset); }}
              className="text-yellow-400 hover:underline text-xs"
            >X-Ray</button>
            <button
              onClick={async () => { const r = await fetch("/api/leads?action=reset-scrape-failed", { method: "PATCH" }); const d = await r.json(); setXrayReset(d.reset); }}
              className="text-orange-400 hover:underline text-xs"
            >Scrape failed</button>
            <button
              onClick={async () => { const r = await fetch("/api/leads?action=reset-enrich-failed", { method: "PATCH" }); const d = await r.json(); setXrayReset(d.reset); }}
              className="text-red-400 hover:underline text-xs"
            >Extract failed</button>
            {xrayReset !== null && (
              <span className="text-green-400 text-xs">{xrayReset} leads re-queued ✓</span>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4 mb-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm text-[var(--muted)] mb-1">Leads per stage</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              disabled={running}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm text-[var(--muted)] mb-1">Min score for outreach</label>
            <input
              type="number"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              min={1}
              max={10}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              disabled={running}
            />
          </div>
        </div>

        {lockError && (
          <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3 text-sm">
            <p className="text-red-300 mb-2">{lockError}</p>
            <button
              onClick={async () => {
                await fetch("/api/pipeline", { method: "DELETE" });
                setLockError(null);
              }}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded text-xs font-medium"
            >
              Force Clear Lock &amp; Try Again
            </button>
          </div>
        )}

        <button
          onClick={runPipeline}
          disabled={running}
          className="w-full px-4 py-3 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Pipeline Running..." : `Run ${config.label}`}
        </button>

        <p className="text-xs text-[var(--muted)] text-center">
          ~3 AI calls per lead + email lookup &bull; {mode === "core" ? "Website + LinkedIn scraping included" : "Skips scraping, processes already-scraped leads"}
        </p>
      </div>

      {/* Progress */}
      {job && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              {job.status === "running" ? job.progress.stage : job.status === "completed" ? "Pipeline Complete!" : "Pipeline Failed"}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${
              job.status === "running" ? "bg-blue-900 text-blue-300" :
              job.status === "completed" ? "bg-green-900 text-green-300" :
              "bg-red-900 text-red-300"
            }`}>
              {job.status}
            </span>
          </div>

          {job.status === "running" && (
            <>
              {job.progress.total > 0 && (
                <div className="w-full bg-[var(--border)] rounded-full h-1.5 mb-2">
                  <div
                    className="bg-[var(--accent)] h-1.5 rounded-full transition-all"
                    style={{ width: `${(job.progress.current / job.progress.total) * 100}%` }}
                  />
                </div>
              )}
              {job.progress.currentItem && (
                <p className="text-xs text-[var(--muted)] mb-2">
                  Processing: {job.progress.currentItem}
                </p>
              )}
            </>
          )}

          {job.status === "completed" && job.result && (
            <div className="mt-4 space-y-4">
              {/* ═══ RUN SUMMARY ═══ */}
              <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4">
                <p className="text-xs font-semibold text-[var(--muted)] mb-3 uppercase tracking-wide">Run Summary</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <SummaryStat label="ICP screen rejected" value={job.result.icp_rejected ?? 0} tone="yellow" />
                  <SummaryStat label="ICP screen passed" value={job.result.icp_matched ?? 0} tone="green" />
                  <SummaryStat label="Websites scraped" value={job.result.websites_scraped ?? 0} tone="neutral" />
                  <SummaryStat label="X-Ray LinkedIn only" value={job.result.xray_linkedin_only ?? 0} tone="yellow" hint="no website → unscorable" />
                  <SummaryStat label="Scored" value={job.result.scored ?? 0} tone="green" />
                  <SummaryStat label="Score failed" value={job.result.score_failed ?? 0} tone="red" />
                  <SummaryStat label="Emails found" value={job.result.emails_found ?? 0} tone="green" />
                  <SummaryStat label="Emails not found" value={job.result.emails_not_found ?? 0} tone="yellow" />
                  <SummaryStat label="Outreach written" value={job.result.outreach_generated ?? 0} tone="green" />
                </div>
              </div>

              {/* ═══ SCORE DISTRIBUTION (this run) ═══ */}
              {summary?.this_run_scores && summary.this_run_scores.total_scored > 0 && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4">
                  <p className="text-xs font-semibold text-[var(--muted)] mb-3 uppercase tracking-wide">
                    Score Distribution — {summary.this_run_scores.total_scored} scored this run
                  </p>
                  <div className="space-y-2 text-sm">
                    <ScoreTier label="8–10 · Legacy tier" sublabel="email waterfall auto" count={summary.this_run_scores.score_8_plus} total={summary.this_run_scores.total_scored} color="green-400" />
                    <ScoreTier label="7 · Legacy tier" sublabel="email waterfall auto" count={summary.this_run_scores.score_7} total={summary.this_run_scores.total_scored} color="green-300" />
                    <ScoreTier label="5–6 · Seed Planter" sublabel="find email manually" count={summary.this_run_scores.score_5_6} total={summary.this_run_scores.total_scored} color="yellow-400" />
                    <ScoreTier label="<5 · Below threshold" sublabel="no outreach" count={summary.this_run_scores.score_below_5} total={summary.this_run_scores.total_scored} color="gray-500" />
                  </div>
                </div>
              )}

              {/* ═══ PER-LEAD BREAKDOWN ═══ */}
              <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                <p className="text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">
                  Lead Scores ({scoredLeads.length}) {scoredLeadsState === "loading" && "— loading..."}
                </p>
                {scoredLeadsState === "loading" && scoredLeads.length === 0 && (
                  <p className="text-xs text-[var(--muted)]">Fetching per-lead scores...</p>
                )}
                {scoredLeadsState === "error" && (
                  <p className="text-xs text-red-400">Failed to load scores: {scoredLeadsError}</p>
                )}
                {scoredLeadsState === "loaded" && scoredLeads.length === 0 && (
                  <p className="text-xs text-yellow-400">
                    No scored leads returned from API. (scored={job.result?.scored ?? 0})
                  </p>
                )}
                {scoredLeads.length > 0 && (
                  <div className="space-y-1">
                    {scoredLeads.map((lead) => {
                      const isExpanded = expandedLead === lead.id;
                      const scoreColor =
                        lead.score >= 8 ? "text-green-400" :
                        lead.score === 7 ? "text-green-300" :
                        lead.score >= 5 ? "text-yellow-400" :
                        "text-[var(--muted)]";
                      const actionLabel: Record<string, string> = {
                        reach_out_now: "Reach out now",
                        reach_out_warm: "Reach out warm",
                        offer_booklet: "Offer booklet",
                        monitor: "Monitor",
                        skip: "Skip",
                      };
                      return (
                        <div key={lead.id} className="border border-[var(--border)] rounded-lg overflow-hidden">
                          <button
                            onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                          >
                            <span className={`text-lg font-bold tabular-nums w-6 shrink-0 ${scoreColor}`}>
                              {lead.score}
                            </span>
                            <span className="flex-1 text-sm font-medium truncate">{lead.business_name}</span>
                            {lead.city && (
                              <span className="text-xs text-[var(--muted)] shrink-0">{lead.city}{lead.state ? `, ${lead.state}` : ""}</span>
                            )}
                            <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                              lead.score >= 8 ? "bg-green-900/60 text-green-400" :
                              lead.score >= 7 ? "bg-green-900/40 text-green-300" :
                              lead.score >= 5 ? "bg-yellow-900/50 text-yellow-400" :
                              "bg-[var(--border)] text-[var(--muted)]"
                            }`}>
                              {lead.score}/10
                            </span>
                            <span className="text-[var(--muted)] text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-[var(--border)] space-y-2 text-xs">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
                                {lead.owner_name && <span><strong className="text-[var(--fg)]">Owner:</strong> {lead.owner_name}</span>}
                                {lead.estimated_owner_age && <span><strong className="text-[var(--fg)]">Age:</strong> {lead.estimated_owner_age}</span>}
                                {lead.estimated_revenue_range && <span><strong className="text-[var(--fg)]">Revenue:</strong> {lead.estimated_revenue_range}</span>}
                                {lead.is_likely_founder !== undefined && (
                                  <span><strong className="text-[var(--fg)]">Founder:</strong> {lead.is_likely_founder ? "Yes" : "No"}</span>
                                )}
                                <span><strong className="text-[var(--fg)]">Action:</strong> {actionLabel[lead.recommended_action] ?? lead.recommended_action}</span>
                                {lead.avatar_fit && <span><strong className="text-[var(--fg)]">Fit:</strong> {lead.avatar_fit}</span>}
                              </div>
                              {lead.primary_signals && lead.primary_signals.length > 0 && (
                                <div>
                                  <p className="text-green-400 font-medium mb-0.5">Signals</p>
                                  <ul className="space-y-0.5 text-[var(--muted)]">
                                    {lead.primary_signals.map((s, i) => <li key={i}>+ {s}</li>)}
                                  </ul>
                                </div>
                              )}
                              {lead.risk_factors && lead.risk_factors.length > 0 && (
                                <div>
                                  <p className="text-yellow-400 font-medium mb-0.5">Risk factors</p>
                                  <ul className="space-y-0.5 text-[var(--muted)]">
                                    {lead.risk_factors.map((r, i) => <li key={i}>− {r}</li>)}
                                  </ul>
                                </div>
                              )}
                              {lead.reasoning && (
                                <p className="text-[var(--muted)] italic">{lead.reasoning}</p>
                              )}
                              {lead.website && (
                                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline block">
                                  {lead.website}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Cost summary for this run */}
              {summary?.cost && summary.cost.total_usd > 0 && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">
                    Run Cost — ${summary.cost.total_usd.toFixed(4)} total
                  </p>
                  <div className="space-y-1 text-xs">
                    {Object.entries(summary.cost.by_stage)
                      .sort(([, a], [, b]) => b - a)
                      .map(([stage, cost]) => (
                        <div key={stage} className="flex justify-between text-sm">
                          <span className="text-[var(--muted)] capitalize">{stage.replace(/-/g, " ")}</span>
                          <span className="tabular-nums">${(cost as number).toFixed(4)}</span>
                        </div>
                      ))}
                    {summary.cost.leads_billed > 0 && (
                      <p className="text-[var(--muted)] pt-1 border-t border-[var(--border)] mt-1">
                        ~${(summary.cost.total_usd / summary.cost.leads_billed).toFixed(4)}/lead across {summary.cost.leads_billed} leads
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Overall DB summary */}
              {summary && (
                <>
                  <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                    <p className="text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">All leads ({summary.pipeline.total} total)</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-[var(--muted)]">Pending</span><span>{summary.pipeline.pending}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--muted)]">Scraped</span><span>{summary.pipeline.scraped}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--muted)]">Enriched</span><span>{summary.pipeline.enriched}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--muted)]">Scored</span><span>{summary.pipeline.scored}</span></div>
                      <div className="flex justify-between"><span className="text-green-400">Outreach written</span><span>{summary.pipeline.outreach_generated}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--muted)]">Filtered out</span><span>{summary.pipeline.filtered_out}</span></div>
                      <div className="flex justify-between"><span className="text-red-400">Failed</span><span>{summary.pipeline.failed}</span></div>
                    </div>
                  </div>

                  {summary.highlights.ready_to_push > 0 && (
                    <a
                      href="/instantly"
                      className="block w-full text-center px-4 py-2.5 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Push {summary.highlights.ready_to_push} leads to Instantly &rarr;
                    </a>
                  )}
                </>
              )}
            </div>
          )}

          {job.status === "completed" && !summary && (
            <p className="text-xs text-[var(--muted)] mt-3">Loading summary...</p>
          )}

          {job.error && <p className="text-sm text-red-400 mt-2">{job.error}</p>}
        </div>
      )}
    </div>
  );
}
