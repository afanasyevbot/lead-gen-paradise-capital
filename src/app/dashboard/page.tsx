"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  total: number;
  withWebsite: number;
  noWebsite: number;
  chains: number;
  byStatus: Record<string, number>;
  topStates: Record<string, number>;
  topQueries: Record<string, number>;
  scores: Record<string, number>;
  recent: { id: number; business_name: string; city: string; state: string; enrichment_status: string; updated_at: string }[];
  avgScore: number | null;
  scoreTiers: { high: number; medium: number; low: number; legacy_8_plus: number; legacy_7: number; seed_planter: number; below_threshold: number };
  bySource: Record<string, number>;
  topProspects: { id: number; business_name: string; city: string | null; state: string | null; enrichment_status: string; score: number; confidence: string | null }[];
  withEmail: number;
  emailBreakdown: { website: number; apollo: number; not_found: number };
}

// ── Components ────────────────────────────────────────────────────────────

function HeroCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 relative overflow-hidden">
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-bold ${accent || ""}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--muted)] mt-1.5">{sub}</p>}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 7 ? "bg-green-900 text-green-300" : score >= 4 ? "bg-yellow-900 text-yellow-300" : "bg-red-900 text-red-300";
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    scraped: "bg-blue-900 text-blue-300",
    enriched: "bg-purple-900 text-purple-300",
    scored: "bg-yellow-900 text-yellow-300",
    outreach_generated: "bg-green-900 text-green-300",
    scrape_failed: "bg-red-900/50 text-red-400",
    enrich_failed: "bg-red-900/50 text-red-400",
    score_failed: "bg-red-900/50 text-red-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${colors[status] || "bg-gray-700 text-gray-300"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Cost Estimator ────────────────────────────────────────────────────────

const COSTS = {
  // Anthropic — Haiku for extraction/scoring, Sonnet for outreach only
  claude: { extraction: 0.006, scoring: 0.004, outreach: 0.024 },
  // Email providers — per lookup (after free tier)
  hunter: { perSearch: 0.098, freeTier: 25 },
  apollo: { perCredit: 0.049, freeTier: 50 },
  snov: { perCredit: 0.039, freeTier: 50 },
  zerobounce: { perVerify: 0.008, freeTier: 100 },
};

function CostEstimator({ stats }: { stats: Stats }) {
  const enriched = (stats.byStatus["enriched"] || 0) + (stats.byStatus["scored"] || 0) + (stats.byStatus["outreach_generated"] || 0);
  const scored = (stats.byStatus["scored"] || 0) + (stats.byStatus["outreach_generated"] || 0);
  const outreach = stats.byStatus["outreach_generated"] || 0;
  const emailsFound = stats.withEmail;

  // Claude costs (actual usage based on pipeline stage reached)
  const claudeExtract = enriched * COSTS.claude.extraction;
  const claudeScore = scored * COSTS.claude.scoring;
  const claudeOutreach = outreach * COSTS.claude.outreach;
  const claudeTotal = claudeExtract + claudeScore + claudeOutreach;

  // Email API costs (waterfall — only called if prior step failed)
  // Assume website scraper gets ~40%, rest hit APIs in order
  const apiNeeded = Math.max(0, emailsFound - Math.round(emailsFound * 0.4));
  const hunterHits = Math.min(apiNeeded, COSTS.hunter.freeTier);
  const hunterOverage = Math.max(0, apiNeeded - COSTS.hunter.freeTier);
  const apolloHits = Math.min(Math.max(0, apiNeeded - hunterHits), COSTS.apollo.freeTier);
  const apolloOverage = Math.max(0, apiNeeded - hunterHits - COSTS.apollo.freeTier);
  const snovOverage = Math.max(0, apiNeeded - hunterHits - apolloHits - COSTS.snov.freeTier);
  const zbOverage = Math.max(0, emailsFound - COSTS.zerobounce.freeTier);

  const emailApiCost =
    hunterOverage * COSTS.hunter.perSearch +
    apolloOverage * COSTS.apollo.perCredit +
    snovOverage * COSTS.snov.perCredit +
    zbOverage * COSTS.zerobounce.perVerify;

  const totalCost = claudeTotal + emailApiCost;

  // Free tier headroom
  const hunterUsed = Math.min(emailsFound, COSTS.hunter.freeTier);
  const apolloUsed = Math.min(Math.max(0, emailsFound - hunterUsed), COSTS.apollo.freeTier);
  const zbUsed = Math.min(emailsFound, COSTS.zerobounce.freeTier);

  const rows = [
    { label: "Claude — Extraction", count: enriched, unit: "leads", cost: claudeExtract, note: `$${COSTS.claude.extraction}/lead` },
    { label: "Claude — Scoring", count: scored, unit: "leads", cost: claudeScore, note: `$${COSTS.claude.scoring}/lead` },
    { label: "Claude — Outreach", count: outreach, unit: "leads", cost: claudeOutreach, note: `$${COSTS.claude.outreach}/lead` },
    { label: "Hunter.io", count: hunterUsed, unit: `/ ${COSTS.hunter.freeTier} free`, cost: hunterOverage * COSTS.hunter.perSearch, note: hunterOverage > 0 ? `${hunterOverage} paid` : "within free tier" },
    { label: "Apollo.io", count: apolloUsed, unit: `/ ${COSTS.apollo.freeTier} free`, cost: apolloOverage * COSTS.apollo.perCredit, note: apolloOverage > 0 ? `${apolloOverage} paid` : "within free tier" },
    { label: "ZeroBounce", count: zbUsed, unit: `/ ${COSTS.zerobounce.freeTier} free`, cost: zbOverage * COSTS.zerobounce.perVerify, note: zbOverage > 0 ? `${zbOverage} paid` : "within free tier" },
  ];

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold">Estimated API Costs</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Based on current pipeline progress</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-400">${totalCost.toFixed(2)}</p>
          <p className="text-xs text-[var(--muted)]">total so far</p>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-1.5 border-t border-[var(--border)] first:border-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm truncate">{row.label}</span>
              <span className="text-xs text-[var(--muted)] shrink-0">{row.count} {row.unit}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <span className="text-xs text-[var(--muted)]">{row.note}</span>
              <span className={`text-sm font-mono w-14 text-right ${row.cost === 0 ? "text-green-400" : "text-[var(--fg)]"}`}>
                {row.cost === 0 ? "free" : `$${row.cost.toFixed(2)}`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Projection */}
      {stats.total > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--muted)]">Full pipeline projection</p>
            <p className="text-xs text-[var(--muted)]">(all {stats.total} leads fully processed)</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">
              ~${(stats.total * (COSTS.claude.extraction + COSTS.claude.scoring + COSTS.claude.outreach)).toFixed(2)}
            </p>
            <p className="text-xs text-[var(--muted)]">Claude only · email APIs extra</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--muted)] border-t-[var(--accent)] rounded-full" />
      </div>
    );
  }

  const pipelineReady = (stats.byStatus["scored"] || 0) + (stats.byStatus["outreach_generated"] || 0);
  const outreachReady = stats.byStatus["outreach_generated"] || 0;

  // ── Zero-state welcome screen ──
  if (stats.total === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Welcome to Paradise Capital</h1>
          <p className="text-[var(--muted)]">M&A Lead Intelligence — Find founder-led businesses approaching exit</p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8">
          <h2 className="text-lg font-semibold mb-4">Get Started</h2>
          <div className="space-y-4">
            <Link href="/scrape" className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors group no-underline">
              <div className="w-10 h-10 bg-blue-900 rounded-lg flex items-center justify-center text-blue-400 text-lg shrink-0">1</div>
              <div>
                <p className="font-medium group-hover:text-[var(--accent)] transition-colors">Scrape Google Maps</p>
                <p className="text-sm text-[var(--muted)]">Find local businesses by industry and location — marine, HVAC, plumbing, etc.</p>
              </div>
            </Link>
            <Link href="/upload" className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors group no-underline">
              <div className="w-10 h-10 bg-purple-900 rounded-lg flex items-center justify-center text-purple-400 text-lg shrink-0">2</div>
              <div>
                <p className="font-medium group-hover:text-[var(--accent)] transition-colors">Upload CSV from Apollo</p>
                <p className="text-sm text-[var(--muted)]">Import leads from Apollo.io free tier exports or any standard CSV file.</p>
              </div>
            </Link>
            <Link href="/pipeline" className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors group no-underline">
              <div className="w-10 h-10 bg-green-900 rounded-lg flex items-center justify-center text-green-400 text-lg shrink-0">3</div>
              <div>
                <p className="font-medium group-hover:text-[var(--accent)] transition-colors">Run the Pipeline</p>
                <p className="text-sm text-[var(--muted)]">Enrich leads with AI — extract signals, score exit-readiness, generate personalized outreach.</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Funnel stages
  const emailsFound = stats.withEmail;
  const funnel = [
    { label: "Scraped", count: stats.byStatus["scraped"] || 0, color: "bg-blue-500" },
    { label: "Enriched", count: stats.byStatus["enriched"] || 0, color: "bg-purple-500" },
    { label: "Emails Found", count: emailsFound, color: "bg-cyan-500" },
    { label: "Scored", count: stats.byStatus["scored"] || 0, color: "bg-yellow-500" },
    { label: "Outreach", count: outreachReady, color: "bg-green-500" },
  ];
  const maxFunnel = Math.max(...funnel.map((f) => f.count), 1);

  // Score tier data
  const hasTiers = stats.scoreTiers.legacy_8_plus + stats.scoreTiers.legacy_7 + stats.scoreTiers.seed_planter + stats.scoreTiers.below_threshold > 0;
  const tierTotal = stats.scoreTiers.legacy_8_plus + stats.scoreTiers.legacy_7 + stats.scoreTiers.seed_planter + stats.scoreTiers.below_threshold;

  // Source labels
  const sourceLabels: Record<string, string> = { google_maps: "Google Maps", apollo: "Apollo.io" };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Deal Flow</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Paradise Capital Lead Intelligence</p>
      </div>

      {/* Row 1: Hero Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <HeroCard
          label="Total Prospects"
          value={stats.total}
          sub={Object.entries(stats.bySource).map(([s, c]) => `${c} ${sourceLabels[s] || s}`).join(" / ")}
        />
        <HeroCard
          label="Pipeline Ready"
          value={pipelineReady}
          sub={pipelineReady > 0 ? "Scored or outreach written" : "Run pipeline to score leads"}
          accent={pipelineReady > 0 ? "text-blue-400" : ""}
        />
        <HeroCard
          label="Avg Exit Score"
          value={stats.avgScore !== null ? stats.avgScore.toFixed(1) : "--"}
          sub={stats.avgScore !== null
            ? (stats.avgScore >= 7 ? "Strong exit signals" : stats.avgScore >= 4 ? "Moderate signals" : "Low signals")
            : "No scores yet"}
          accent={stats.avgScore !== null
            ? (stats.avgScore >= 7 ? "text-green-400" : stats.avgScore >= 4 ? "text-yellow-400" : "text-red-400")
            : "text-[var(--muted)]"}
        />
        <HeroCard
          label="Outreach Ready"
          value={outreachReady}
          sub={stats.withEmail > 0
            ? `${stats.withEmail} emails found (${stats.emailBreakdown.website} website, ${stats.emailBreakdown.apollo} Apollo)`
            : "Emails found after pipeline runs"}
          accent={outreachReady > 0 ? "text-green-400" : ""}
        />
      </div>

      {/* Row 2: Deal Flow Funnel */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Deal Flow Funnel</h2>
          <span className="text-xs text-[var(--muted)]">{stats.total} total prospects</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {funnel.map((stage, i) => (
            <div key={stage.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--muted)]">{stage.label}</span>
                <span className="text-sm font-bold">{stage.count}</span>
              </div>
              <div className="h-8 bg-[var(--bg)] rounded-lg overflow-hidden relative">
                <div
                  className={`h-full ${stage.color} rounded-lg transition-all duration-500`}
                  style={{ width: `${Math.max((stage.count / maxFunnel) * 100, stage.count > 0 ? 8 : 0)}%` }}
                />
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">
                {stats.total > 0 ? Math.round((stage.count / stats.total) * 100) : 0}% of total
              </p>
              {i < funnel.length - 1 && (
                <div className="hidden lg:block absolute right-0 top-1/2 text-[var(--muted)]" />
              )}
            </div>
          ))}
        </div>
        {/* Pending + failed summary */}
        <div className="flex gap-4 mt-3 pt-3 border-t border-[var(--border)]">
          <span className="text-xs text-[var(--muted)]">
            Pending: <span className="font-mono">{stats.byStatus["pending"] || 0}</span>
          </span>
          {(stats.byStatus["scrape_failed"] || 0) + (stats.byStatus["enrich_failed"] || 0) + (stats.byStatus["score_failed"] || 0) > 0 && (
            <span className="text-xs text-red-400">
              Failed: <span className="font-mono">
                {(stats.byStatus["scrape_failed"] || 0) + (stats.byStatus["enrich_failed"] || 0) + (stats.byStatus["score_failed"] || 0)}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Row 3: Score Tiers + Lead Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Score Distribution */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4">Exit-Readiness Scores</h2>
          {hasTiers ? (
            <div className="space-y-4">
              {/* 8-10 Legacy */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <span className="text-sm">8–10 · Legacy Tier</span>
                  </div>
                  <span className="text-sm font-bold text-green-400">{stats.scoreTiers.legacy_8_plus}</span>
                </div>
                <div className="h-5 bg-[var(--bg)] rounded overflow-hidden">
                  <div className="h-full bg-green-500/40 rounded" style={{ width: `${(stats.scoreTiers.legacy_8_plus / tierTotal) * 100}%` }} />
                </div>
              </div>
              {/* 7 Legacy */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    <span className="text-sm">7 · Legacy Tier</span>
                  </div>
                  <span className="text-sm font-bold text-green-300">{stats.scoreTiers.legacy_7}</span>
                </div>
                <div className="h-5 bg-[var(--bg)] rounded overflow-hidden">
                  <div className="h-full bg-green-400/30 rounded" style={{ width: `${(stats.scoreTiers.legacy_7 / tierTotal) * 100}%` }} />
                </div>
              </div>
              {/* 5-6 Seed Planter */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <span className="text-sm">5–6 · Seed Planter</span>
                  </div>
                  <span className="text-sm font-bold text-yellow-400">{stats.scoreTiers.seed_planter}</span>
                </div>
                <div className="h-5 bg-[var(--bg)] rounded overflow-hidden">
                  <div className="h-full bg-yellow-500/40 rounded" style={{ width: `${(stats.scoreTiers.seed_planter / tierTotal) * 100}%` }} />
                </div>
              </div>
              {/* Below threshold */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-sm">&lt;5 · Below Threshold</span>
                  </div>
                  <span className="text-sm font-bold text-red-400">{stats.scoreTiers.below_threshold}</span>
                </div>
                <div className="h-5 bg-[var(--bg)] rounded overflow-hidden">
                  <div className="h-full bg-red-500/40 rounded" style={{ width: `${(stats.scoreTiers.below_threshold / tierTotal) * 100}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-[var(--muted)] text-sm mb-3">No leads scored yet</p>
              <Link href="/pipeline" className="text-sm text-[var(--accent)] hover:underline">
                Run the pipeline to score exit-readiness &rarr;
              </Link>
            </div>
          )}
        </div>

        {/* Lead Sources */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4">Lead Sources</h2>

          {/* Source breakdown */}
          <div className="mb-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-2">By Source</p>
            {Object.entries(stats.bySource).map(([source, count]) => (
              <div key={source} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${source === "apollo" ? "bg-purple-400" : "bg-blue-400"}`} />
                  <span className="text-sm">{sourceLabels[source] || source}</span>
                </div>
                <span className="text-sm font-mono text-[var(--muted)]">{count}</span>
              </div>
            ))}
          </div>

          {/* Top states */}
          <div className="mb-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-2">Top Markets</p>
            {Object.entries(stats.topStates).slice(0, 5).map(([state, count]) => (
              <div key={state} className="flex items-center justify-between py-1">
                <span className="text-sm">{state}</span>
                <span className="text-sm font-mono text-[var(--muted)]">{count}</span>
              </div>
            ))}
          </div>

          {/* Top queries */}
          {Object.keys(stats.topQueries).length > 0 && (
            <div>
              <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-2">Industries</p>
              {Object.entries(stats.topQueries).slice(0, 5).map(([query, count]) => (
                <div key={query} className="flex items-center justify-between py-1">
                  <span className="text-sm truncate mr-2">{query}</span>
                  <span className="text-sm font-mono text-[var(--muted)]">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Cost Estimator */}
      <CostEstimator stats={stats} />

      {/* Row 5: Top Prospects + Pipeline Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Prospects */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              {stats.topProspects.length > 0 ? "Top Prospects" : "Recent Activity"}
            </h2>
            <Link href="/leads" className="text-xs text-[var(--accent)] hover:underline">
              View all &rarr;
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                {stats.topProspects.length > 0 && <th className="pb-2 w-10">Score</th>}
                <th className="pb-2">Business</th>
                <th className="pb-2">Location</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(stats.topProspects.length > 0 ? stats.topProspects : stats.recent).map((lead) => (
                <tr key={lead.id} className="border-t border-[var(--border)]">
                  {"score" in lead && (
                    <td className="py-2.5">
                      <ScoreBadge score={lead.score} />
                    </td>
                  )}
                  <td className="py-2.5">
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.business_name}
                    </Link>
                  </td>
                  <td className="py-2.5 text-[var(--muted)]">
                    {lead.city}{lead.state ? `, ${lead.state}` : ""}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={lead.enrichment_status} />
                  </td>
                </tr>
              ))}
              {stats.topProspects.length === 0 && stats.recent.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-[var(--muted)]">
                    No leads yet — <Link href="/scrape" className="text-[var(--accent)] hover:underline">start scraping</Link> or{" "}
                    <Link href="/upload" className="text-[var(--accent)] hover:underline">upload a CSV</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pipeline Status */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Pipeline Status</h2>
            <Link href="/pipeline" className="text-xs text-[var(--accent)] hover:underline">
              Run pipeline &rarr;
            </Link>
          </div>
          <div className="space-y-2.5">
            {[
              { key: "pending", label: "Pending", color: "bg-gray-500" },
              { key: "scraped", label: "Websites Scraped", color: "bg-blue-500" },
              { key: "enriched", label: "Data Extracted", color: "bg-purple-500" },
              { key: "scored", label: "Exit-Readiness Scored", color: "bg-yellow-500" },
              { key: "outreach_generated", label: "Outreach Written", color: "bg-green-500" },
              { key: "scrape_failed", label: "Scrape Failed", color: "bg-red-500" },
              { key: "enrich_failed", label: "Enrichment Failed", color: "bg-red-500" },
              { key: "score_failed", label: "Scoring Failed", color: "bg-red-500" },
            ].filter(({ key }) => (stats.byStatus[key] || 0) > 0).map(({ key, label, color }) => {
              const count = stats.byStatus[key] || 0;
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{label}</span>
                    <span className="text-sm font-mono">
                      {count} <span className="text-[var(--muted)]">({Math.round(pct)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
