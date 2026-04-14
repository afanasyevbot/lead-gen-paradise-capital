"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface LeadDetail {
  id: number;
  business_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  website: string;
  google_rating: number;
  review_count: number;
  business_types: string;
  enrichment_status: string;
  is_chain: number;
  search_query: string;
  search_location: string;
  scraped: { all_text: string; pages_scraped: number } | null;
  enrichment: Record<string, unknown> | null;
  scoring: {
    score: number;
    confidence: string;
    primary_signals: string[];
    risk_factors: string[];
    recommended_action: string;
    reasoning: string;
    best_angle: string;
    requires_manual_review?: boolean;
    review_reason?: string | null;
  } | null;
  scoringMeta: { score: number; confidence: string; recommended_action: string } | null;
  linkedin: {
    linkedin_url: string | null;
    owner_name: string | null;
    owner_title: string | null;
    headline: string | null;
  } | null;
  outreach: {
    subject_line: string;
    email_body: string;
    personalization_notes: string;
    alternative_subject: string;
    follow_up_angle: string;
    requires_review?: boolean;
    stale_data_warning?: string | null;
    fact_check?: {
      all_claims_verified: boolean;
      unverified_claims: string[];
      risk_level: string;
    } | null;
    tier_used?: string;
    format_style_used?: string;
  } | null;
  followups: {
    follow_up_1: { subject_line: string; email_body: string; days_after_previous: number };
    follow_up_2: { subject_line: string; email_body: string; days_after_previous: number };
  } | null;
  socialIntro: {
    intro_text: string;
    source_used: string;
    specific_reference: string;
    confidence: string;
    notes_for_paul: string;
  } | null;
  socialSignals: {
    linkedin_about: string | null;
    twitter_posts: string | null;
    press_releases: string | null;
  } | null;
  founderProfile: {
    is_primary_founder: number;
    estimated_current_age: number | null;
    career_stage: string | null;
    exit_readiness_boost: number;
    is_age_55_plus: number;
    profile_json: string | null;
  } | null;
  contentHooks: {
    best_subject: string | null;
    hooks_json: string | null;
  } | null;
  successionNews: {
    owner_signals: string | null;
    industry_signals: string | null;
    total_signals: number;
    strongest_signal: string | null;
  } | null;
  legacyOutreach: {
    outreach_json: string | null;
    legacy_angle: string | null;
  } | null;
  successionAudit: {
    audit_json: string | null;
    overall_readiness_score: number | null;
    recommended_tier: string | null;
  } | null;
  tenureLegacyEmail: {
    email_json: string | null;
    tier: string | null;
  } | null;
  costs: {
    total_usd: number;
    by_stage: Record<string, number>;
    rows: Array<{ stage: string; provider: string; input_tokens: number | null; output_tokens: number | null; cost_usd: number; created_at: string }>;
  } | null;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 7 ? "bg-green-600" : score >= 5 ? "bg-yellow-600" : "bg-red-600";
  return (
    <span className={`${color} text-white text-lg font-bold px-3 py-1 rounded-lg`}>
      {score}/10
    </span>
  );
}

function MiniScore({ score, label }: { score: number; label: string }) {
  const color = score >= 7 ? "text-green-400" : score >= 5 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="text-center">
      <span className={`text-2xl font-bold ${color}`}>{score}</span>
      <span className="text-[var(--muted)] text-xs">/10</span>
      <p className="text-xs text-[var(--muted)] mt-0.5">{label}</p>
    </div>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
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

function CopyButton({ text }: { text: string }) {
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

function TierBadge({ tier }: { tier: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active_conversation: { bg: "bg-green-900", text: "text-green-300", label: "Active Conversation" },
    warm_introduction: { bg: "bg-blue-900", text: "text-blue-300", label: "Warm Introduction" },
    not_now: { bg: "bg-gray-700", text: "text-gray-300", label: "Not Now" },
  };
  const c = config[tier] || config.not_now;
  return (
    <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded text-xs font-medium`}>{c.label}</span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    not_ready: { bg: "bg-red-900", text: "text-red-300" },
    awakening: { bg: "bg-yellow-900", text: "text-yellow-300" },
    exploring: { bg: "bg-blue-900", text: "text-blue-300" },
    ready: { bg: "bg-green-900", text: "text-green-300" },
    owner_dependent: { bg: "bg-red-900", text: "text-red-300" },
    transitioning: { bg: "bg-yellow-900", text: "text-yellow-300" },
    transferable: { bg: "bg-green-900", text: "text-green-300" },
    under_positioned: { bg: "bg-red-900", text: "text-red-300" },
    moderate: { bg: "bg-yellow-900", text: "text-yellow-300" },
    well_positioned: { bg: "bg-green-900", text: "text-green-300" },
  };
  const c = config[stage] || { bg: "bg-gray-700", text: "text-gray-300" };
  return (
    <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded text-xs`}>
      {stage.replace(/_/g, " ")}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function PushToInstantly({ leadId }: { leadId: number }) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [open, setOpen] = useState(false);

  async function loadCampaigns() {
    setOpen(true);
    try {
      const res = await fetch("/api/instantly/campaigns");
      const data = await res.json();
      if (data.campaigns) setCampaigns(data.campaigns);
      else setResult({ success: false, message: data.error || "Failed to load campaigns" });
    } catch {
      setResult({ success: false, message: "Failed to connect to Instantly" });
    }
  }

  async function push() {
    if (!selectedCampaign) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/instantly/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaign, leadIds: [leadId] }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Pushed to Instantly (${data.leads_pushed} lead)` });
      } else {
        setResult({ success: false, message: data.error || "Push failed" });
      }
    } catch {
      setResult({ success: false, message: "Failed to push" });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button onClick={loadCampaigns} className="px-3 py-1.5 text-xs bg-purple-700 text-white rounded-lg hover:bg-purple-600 transition-colors">
        Push to Instantly
      </button>
    );
  }

  return (
    <div className="bg-purple-950 border border-purple-800 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2">
        <select
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
        >
          <option value="">Select campaign...</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={push}
          disabled={!selectedCampaign || loading}
          className="px-3 py-1.5 text-xs bg-purple-700 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Pushing..." : "Push"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
      </div>
      {result && (
        <p className={`text-xs mt-2 ${result.success ? "text-green-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

interface WaterfallResult {
  providersAttempted: string[];
  providersHit: string[];
  candidates: { email: string; provider: string; verificationStatus: string; confidence: number }[];
  durationMs: number;
}

function LeadActions({ leadId, status, onComplete }: { leadId: number; status: string; onComplete: () => void }) {
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

type Tab = "overview" | "outreach" | "research" | "raw";

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    fetch(`/api/leads/${id}`)
      .then((r) => r.json())
      .then(setLead);
  }, [id]);

  if (!lead) return <p className="text-[var(--muted)]">Loading...</p>;

  const founderData = safeJson(lead.founderProfile?.profile_json);
  const auditData = safeJson(lead.successionAudit?.audit_json);
  const legacyData = safeJson(lead.legacyOutreach?.outreach_json);
  const tenureData = safeJson(lead.tenureLegacyEmail?.email_json);
  const hooksData = safeJson(lead.contentHooks?.hooks_json);
  const twitterPosts = safeJson(lead.socialSignals?.twitter_posts);
  const pressReleases = safeJson(lead.socialSignals?.press_releases);
  const ownerSignals = safeJson(lead.successionNews?.owner_signals);
  const industrySignals = safeJson(lead.successionNews?.industry_signals);

  return (
    <div className="max-w-4xl">
      <Link href="/leads" className="text-sm text-[var(--muted)] hover:text-[var(--fg)] mb-4 inline-block">
        &larr; Back to leads
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{lead.business_name}</h1>
          <p className="text-[var(--muted)]">
            {lead.city}, {lead.state} {lead.zip_code}
          </p>
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline">
              {lead.website}
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lead.successionAudit?.recommended_tier && (
            <TierBadge tier={lead.successionAudit.recommended_tier} />
          )}
          {lead.scoringMeta && <ScoreBadge score={lead.scoringMeta.score} />}
        </div>
      </div>

      {/* Pipeline Actions — run individual stages on this lead */}
      <LeadActions
        leadId={lead.id}
        status={lead.enrichment_status}
        onComplete={() => {
          fetch(`/api/leads/${id}`).then((r) => r.json()).then(setLead);
        }}
      />

      {/* Actions bar */}
      <div className="flex items-center gap-2 mb-4">
        {lead.enrichment && (
          <PushToInstantly leadId={lead.id} />
        )}
        <button
          onClick={async () => {
            if (!confirm("Reset enrichment? This will clear all pipeline data and re-queue this lead.")) return;
            const res = await fetch(`/api/leads/${lead.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reset" }),
            });
            const data = await res.json();
            if (data.success) window.location.reload();
          }}
          className="px-3 py-1.5 text-xs bg-yellow-900 text-yellow-300 rounded-lg hover:bg-yellow-800 transition-colors"
        >
          Reset Pipeline
        </button>
        <button
          onClick={async () => {
            if (!confirm(`Delete "${lead.business_name}" permanently? This cannot be undone.`)) return;
            const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) window.location.href = "/leads";
          }}
          className="px-3 py-1.5 text-xs bg-red-900 text-red-300 rounded-lg hover:bg-red-800 transition-colors"
        >
          Delete Lead
        </button>
      </div>

      {/* Pipeline Cost */}
      {lead.costs && lead.costs.total_usd > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Pipeline Cost</h3>
            <span className="text-sm font-mono font-bold">${lead.costs.total_usd.toFixed(4)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(lead.costs.by_stage).map(([stage, usd]) => (
              <span key={stage} className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 font-mono">
                {stage}: ${(usd as number).toFixed(4)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
        {([
          { key: "overview" as Tab, label: "Overview" },
          { key: "outreach" as Tab, label: "Outreach", count: (lead.outreach ? 1 : 0) + (legacyData ? 1 : 0) + (tenureData ? 1 : 0) },
          { key: "research" as Tab, label: "Research", count: (lead.enrichment ? 1 : 0) + (lead.founderProfile ? 1 : 0) + (auditData ? 1 : 0) },
          { key: "raw" as Tab, label: "Raw Data" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {tab.label}
            {"count" in tab && (tab.count ?? 0) > 0 && (
              <span className="ml-1.5 text-xs bg-[var(--border)] px-1.5 py-0.5 rounded-full">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {activeTab === "overview" && (
        <>
      <Section title="Basic Info">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-[var(--muted)]">Phone:</span> {lead.phone || "—"}</div>
          <div><span className="text-[var(--muted)]">Address:</span> {lead.address || "—"}</div>
          <div><span className="text-[var(--muted)]">Status:</span> {lead.enrichment_status}</div>
          <div><span className="text-[var(--muted)]">Search:</span> {lead.search_query} in {lead.search_location}</div>
          <div><span className="text-[var(--muted)]">Chain:</span> {lead.is_chain ? "Yes" : "No"}</div>
        </div>
      </Section>

      {/* LinkedIn */}
      {lead.linkedin && lead.linkedin.linkedin_url && (
        <Section title="LinkedIn Profile">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--muted)]">Name:</span> {lead.linkedin.owner_name || "—"}</div>
            <div><span className="text-[var(--muted)]">Title:</span> {lead.linkedin.owner_title || "—"}</div>
            <div className="col-span-2"><span className="text-[var(--muted)]">Headline:</span> {lead.linkedin.headline || "—"}</div>
            <div className="col-span-2">
              <span className="text-[var(--muted)]">Profile:</span>{" "}
              <a href={lead.linkedin.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                {lead.linkedin.linkedin_url}
              </a>
            </div>
          </div>
        </Section>
      )}

      {/* Scoring (shown in overview for quick access) */}
      {lead.scoring && (
        <Section title="Exit-Readiness Score">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <ScoreBadge score={lead.scoring.score} />
              <span className="text-[var(--muted)]">Confidence: {lead.scoring.confidence}</span>
              <span className={`px-2 py-0.5 rounded text-xs ${
                lead.scoring.recommended_action === "reach_out_now" ? "bg-green-900 text-green-300" :
                lead.scoring.recommended_action === "reach_out_warm" ? "bg-blue-900 text-blue-300" :
                "bg-gray-700 text-gray-300"
              }`}>
                {lead.scoring.recommended_action.replace(/_/g, " ")}
              </span>
            </div>
            <p>{lead.scoring.reasoning}</p>
            <div><span className="text-[var(--muted)]">Best angle:</span> {lead.scoring.best_angle}</div>
            <div>
              <span className="text-[var(--muted)]">Primary signals:</span>
              <ul className="list-disc list-inside mt-1">
                {lead.scoring.primary_signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            {lead.scoring.risk_factors.length > 0 && (
              <div>
                <span className="text-[var(--muted)]">Risk factors:</span>
                <ul className="list-disc list-inside mt-1">
                  {lead.scoring.risk_factors.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {(lead.scoring?.requires_manual_review || lead.outreach?.requires_review) && (
  <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4 mb-4">
    <h3 className="text-yellow-400 font-semibold text-sm mb-1">Manual Review Required</h3>
    <p className="text-yellow-200/80 text-sm">
      {lead.scoring?.review_reason || "Founder status or age estimate has low confidence. Paul should verify before sending."}
    </p>
    {lead.outreach?.fact_check?.unverified_claims && lead.outreach.fact_check.unverified_claims.length > 0 && (
      <div className="mt-2">
        <p className="text-yellow-300 text-xs font-medium">Unverified claims in email:</p>
        <ul className="text-yellow-200/60 text-xs mt-1 list-disc list-inside">
          {lead.outreach.fact_check.unverified_claims.map((c: string, i: number) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    )}
  </div>
)}

      {lead.outreach?.stale_data_warning && (
  <div className="bg-orange-900/20 border border-orange-700 rounded-xl p-3 mb-4">
    <p className="text-orange-300 text-sm">
      <span className="font-semibold">Stale data notice:</span> {lead.outreach.stale_data_warning}
    </p>
  </div>
)}

      {!lead.enrichment && !lead.scoring && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center mb-4">
          <p className="text-[var(--muted)] mb-2">No enrichment data yet</p>
          <a href="/pipeline" className="text-sm text-[var(--accent)] hover:underline">Run the pipeline to enrich this lead &rarr;</a>
        </div>
      )}
        </>
      )}

      {/* ═══ OUTREACH TAB ═══ */}
      {activeTab === "outreach" && (
        <>
      {!lead.outreach && !legacyData && !tenureData && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center mb-4">
          <p className="text-[var(--muted)] mb-2">No outreach emails generated yet</p>
          <a href="/pipeline" className="text-sm text-[var(--accent)] hover:underline">Run the pipeline to generate outreach &rarr;</a>
        </div>
      )}

      {/* Social Intro */}
      {lead.socialIntro && (
        <Section title="Social Intro (for Paul)" accent="border-l-cyan-500">
          <div className="space-y-3 text-sm">
            <div className="bg-[#1a1a1a] p-4 rounded-lg">
              <p className="italic">&ldquo;{lead.socialIntro.intro_text}&rdquo;</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-[var(--muted)]">Source:</span> {lead.socialIntro.source_used}</div>
              <div><span className="text-[var(--muted)]">Confidence:</span> {lead.socialIntro.confidence}</div>
              <div className="col-span-2"><span className="text-[var(--muted)]">Reference:</span> {lead.socialIntro.specific_reference}</div>
            </div>
            {lead.socialIntro.notes_for_paul && (
              <div className="bg-blue-950 p-3 rounded-lg text-xs">
                <span className="text-blue-400 font-semibold">Notes for Paul: </span>
                {lead.socialIntro.notes_for_paul}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Content Hooks */}
      {hooksData && (
        <Section title="Content Hooks">
          <div className="space-y-3 text-sm">
            {lead.contentHooks?.best_subject && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted)]">Best subject line:</span>
                <strong>&ldquo;{lead.contentHooks.best_subject}&rdquo;</strong>
                <CopyButton text={lead.contentHooks.best_subject} />
              </div>
            )}
            {hooksData.subject_lines?.length > 0 && (
              <div className="space-y-2">
                {hooksData.subject_lines.map((sl: { text: string; hook_type: string; quality: string }, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded ${
                      sl.quality === "A" ? "bg-green-900 text-green-300" :
                      sl.quality === "B" ? "bg-yellow-900 text-yellow-300" :
                      "bg-gray-700 text-gray-300"
                    }`}>{sl.quality}</span>
                    <span>&ldquo;{sl.text}&rdquo;</span>
                    <span className="text-[var(--muted)]">({sl.hook_type})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Standard Outreach */}
      {lead.outreach && (
        <Section title="Outreach Email">
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[var(--muted)]">Subject:</span>{" "}
                <strong>{lead.outreach.subject_line}</strong>
              </div>
              <CopyButton text={`Subject: ${lead.outreach.subject_line}\n\n${lead.outreach.email_body}`} />
            </div>
            <div className="bg-[#1a1a1a] p-4 rounded-lg whitespace-pre-wrap font-mono text-xs">
              {lead.outreach.email_body}
            </div>
            <div><span className="text-[var(--muted)]">Alt subject:</span> {lead.outreach.alternative_subject}</div>
          </div>
        </Section>
      )}

      {/* Legacy Outreach */}
      {legacyData && (
        <Section title="Legacy Outreach" accent="border-l-amber-600">
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[var(--muted)]">Subject:</span>{" "}
                <strong>{legacyData.subject_line}</strong>
              </div>
              <CopyButton text={`Subject: ${legacyData.subject_line}\n\n${legacyData.email_body}`} />
            </div>
            <div className="bg-[#1a1a1a] p-4 rounded-lg whitespace-pre-wrap font-mono text-xs">
              {legacyData.email_body}
            </div>
          </div>
        </Section>
      )}

      {/* Tenure & Legacy Email */}
      {tenureData && (
        <Section title={`Tenure & Legacy Email — ${lead.tenureLegacyEmail?.tier?.replace(/_/g, " ") || ""}`} accent="border-l-emerald-500">
          <div className="space-y-4 text-sm">
            {lead.tenureLegacyEmail?.tier && <TierBadge tier={lead.tenureLegacyEmail.tier} />}
            <div className="flex items-center justify-between mt-2">
              <div>
                <span className="text-[var(--muted)]">Subject:</span>{" "}
                <strong>{tenureData.subject_line}</strong>
              </div>
              <CopyButton text={`Subject: ${tenureData.subject_line}\n\n${tenureData.email_body}`} />
            </div>
            <div className="bg-[#1a1a1a] p-4 rounded-lg whitespace-pre-wrap font-mono text-xs">
              {tenureData.email_body}
            </div>
            {tenureData.follow_up_1 && (
              <div className="border border-[var(--border)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--muted)]">Follow-up 1 — {tenureData.follow_up_1.days_after || 10} days</span>
                  <CopyButton text={`Subject: ${tenureData.follow_up_1.subject_line}\n\n${tenureData.follow_up_1.email_body}`} />
                </div>
                <p className="font-medium text-xs mb-1">{tenureData.follow_up_1.subject_line}</p>
                <div className="bg-[#1a1a1a] p-3 rounded whitespace-pre-wrap font-mono text-xs">{tenureData.follow_up_1.email_body}</div>
              </div>
            )}
            {tenureData.follow_up_2 && (
              <div className="border border-[var(--border)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--muted)]">Follow-up 2 — {tenureData.follow_up_2.days_after || 21} days</span>
                  <CopyButton text={`Subject: ${tenureData.follow_up_2.subject_line}\n\n${tenureData.follow_up_2.email_body}`} />
                </div>
                <p className="font-medium text-xs mb-1">{tenureData.follow_up_2.subject_line}</p>
                <div className="bg-[#1a1a1a] p-3 rounded whitespace-pre-wrap font-mono text-xs">{tenureData.follow_up_2.email_body}</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Standard Follow-ups */}
      {lead.followups && (
        <Section title="Follow-up Sequence">
          <div className="space-y-4 text-sm">
            {[lead.followups.follow_up_1, lead.followups.follow_up_2].map((fu, i) => (
              fu && (
                <div key={i} className="border border-[var(--border)] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[var(--muted)]">
                      Follow-up {i + 1} — {fu.days_after_previous} days after previous
                    </span>
                    <CopyButton text={`Subject: ${fu.subject_line}\n\n${fu.email_body}`} />
                  </div>
                  <p className="font-medium mb-1">{fu.subject_line}</p>
                  <div className="bg-[#1a1a1a] p-3 rounded whitespace-pre-wrap font-mono text-xs">{fu.email_body}</div>
                </div>
              )
            ))}
          </div>
        </Section>
      )}

      {lead.outreach && (
        <Section title="Log Outcome">
          <div className="flex flex-wrap gap-2">
            {["no_response", "opened", "replied_positive", "replied_negative", "meeting_booked", "unsubscribed", "bounced"].map(outcome => (
              <button
                key={outcome}
                onClick={async () => {
                  await fetch("/api/outcomes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      lead_id: lead.id,
                      outcome,
                      tier_used: lead.outreach?.tier_used,
                      score_at_send: lead.scoring?.score,
                    }),
                  });
                  window.location.reload();
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--border)] hover:bg-[#333] transition-colors capitalize"
              >
                {outcome.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </Section>
      )}
        </>
      )}

      {/* ═══ RESEARCH TAB ═══ */}
      {activeTab === "research" && (
        <>
      {/* Enrichment data */}
      {lead.enrichment && (
        <Section title="Enrichment Data">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {Object.entries(lead.enrichment).map(([key, val]) => {
              if (!val || (Array.isArray(val) && val.length === 0)) return null;
              return (
                <div key={key} className={key === "unique_hooks" || key === "services_offered" ? "col-span-2" : ""}>
                  <span className="text-[var(--muted)]">{key.replace(/_/g, " ")}:</span>{" "}
                  {Array.isArray(val) ? (
                    <ul className="list-disc list-inside mt-1">
                      {val.map((v, i) => <li key={i}>{String(v)}</li>)}
                    </ul>
                  ) : (
                    String(val)
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Founder Profile */}
      {lead.founderProfile && (
        <Section title="Founder Profile" accent="border-l-purple-600">
          <div className="grid grid-cols-3 gap-4 text-sm mb-4">
            <div>
              <span className="text-[var(--muted)]">Primary Founder:</span>{" "}
              <span className={lead.founderProfile.is_primary_founder ? "text-green-400" : "text-[var(--muted)]"}>
                {lead.founderProfile.is_primary_founder ? "Yes" : "Unknown"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Est. Age:</span>{" "}
              {lead.founderProfile.estimated_current_age || "—"}
              {lead.founderProfile.is_age_55_plus ? (
                <span className="ml-1 text-xs bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded">55+</span>
              ) : null}
            </div>
            <div>
              <span className="text-[var(--muted)]">Career Stage:</span>{" "}
              {lead.founderProfile.career_stage ? <StageBadge stage={lead.founderProfile.career_stage} /> : "—"}
            </div>
            <div>
              <span className="text-[var(--muted)]">Exit Readiness Boost:</span>{" "}
              <span className={lead.founderProfile.exit_readiness_boost > 0 ? "text-green-400" : lead.founderProfile.exit_readiness_boost < 0 ? "text-red-400" : ""}>
                {lead.founderProfile.exit_readiness_boost > 0 ? "+" : ""}{lead.founderProfile.exit_readiness_boost}
              </span>
            </div>
          </div>
          {founderData && (
            <div className="space-y-2 text-sm">
              {founderData.early_career_signals?.length > 0 && (
                <div>
                  <span className="text-[var(--muted)]">Early career signals:</span>
                  <ul className="list-disc list-inside mt-1 text-xs">
                    {founderData.early_career_signals.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {founderData.retirement_indicators?.length > 0 && (
                <div>
                  <span className="text-[var(--muted)]">Retirement indicators:</span>
                  <ul className="list-disc list-inside mt-1 text-xs">
                    {founderData.retirement_indicators.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {founderData.bio_summary && (
                <div>
                  <span className="text-[var(--muted)]">Bio summary:</span>
                  <p className="text-xs mt-1 text-[var(--fg)]">{founderData.bio_summary}</p>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Succession Readiness Audit */}
      {auditData && (
        <Section title="Succession Readiness Audit" accent="border-l-amber-500">
          <div className="grid grid-cols-4 gap-4 mb-4">
            {auditData.overall_readiness_score && (
              <MiniScore score={auditData.overall_readiness_score} label="Overall Readiness" />
            )}
            {auditData.emotional_readiness?.stage && (
              <div className="text-center">
                <StageBadge stage={auditData.emotional_readiness.stage} />
                <p className="text-xs text-[var(--muted)] mt-1">Emotional</p>
              </div>
            )}
            {auditData.business_structure?.stage && (
              <div className="text-center">
                <StageBadge stage={auditData.business_structure.stage} />
                <p className="text-xs text-[var(--muted)] mt-1">Structure</p>
              </div>
            )}
            {auditData.valuation_positioning?.stage && (
              <div className="text-center">
                <StageBadge stage={auditData.valuation_positioning.stage} />
                <p className="text-xs text-[var(--muted)] mt-1">Valuation</p>
              </div>
            )}
          </div>
          {auditData.paul_summary && (
            <div className="bg-blue-950 border border-blue-900 p-3 rounded-lg text-xs mb-3">
              <span className="text-blue-400 font-semibold">Paul&apos;s Summary: </span>
              {auditData.paul_summary}
            </div>
          )}
          {auditData.opening_angle && (
            <div className="text-sm">
              <span className="text-[var(--muted)]">Opening angle:</span> {auditData.opening_angle}
            </div>
          )}
          {auditData.no_regrets_framing && (
            <div className="text-sm mt-1">
              <span className="text-[var(--muted)]">No Regrets framing:</span> {auditData.no_regrets_framing}
            </div>
          )}
        </Section>
      )}

      {/* Succession News */}
      {lead.successionNews && lead.successionNews.total_signals > 0 && (
        <Section title={`Succession News (${lead.successionNews.total_signals} signals)`} accent="border-l-orange-500">
          <div className="space-y-3 text-sm">
            {ownerSignals?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] mb-1">Owner Exit Signals</h3>
                {ownerSignals.map((s: { title: string; keyword_matched: string; snippet?: string }, i: number) => (
                  <div key={i} className="bg-[#1a1a1a] p-3 rounded mb-2">
                    <p className="text-xs font-medium">{s.title}</p>
                    {s.snippet && <p className="text-xs text-[var(--muted)] mt-1">{s.snippet}</p>}
                    <span className="text-xs bg-orange-900 text-orange-300 px-1.5 py-0.5 rounded mt-1 inline-block">
                      {s.keyword_matched}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {industrySignals?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] mb-1">Industry M&A Trends</h3>
                {industrySignals.map((s: { title: string; keyword_matched: string; snippet?: string }, i: number) => (
                  <div key={i} className="bg-[#1a1a1a] p-3 rounded mb-2">
                    <p className="text-xs font-medium">{s.title}</p>
                    {s.snippet && <p className="text-xs text-[var(--muted)] mt-1">{s.snippet}</p>}
                    <span className="text-xs bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded mt-1 inline-block">
                      {s.keyword_matched}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Social Signals */}
      {lead.socialSignals && (lead.socialSignals.linkedin_about || twitterPosts?.length > 0 || pressReleases?.length > 0) && (
        <Section title="Social Signals">
          <div className="space-y-3 text-sm">
            {lead.socialSignals.linkedin_about && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] mb-1">LinkedIn About</h3>
                <p className="text-xs bg-[#1a1a1a] p-3 rounded">{lead.socialSignals.linkedin_about}</p>
              </div>
            )}
            {twitterPosts?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] mb-1">Twitter/X Posts</h3>
                <ul className="space-y-1">
                  {twitterPosts.slice(0, 5).map((t: { text?: string; title?: string }, i: number) => (
                    <li key={i} className="text-xs bg-[#1a1a1a] p-2 rounded">{t.text || t.title || String(t)}</li>
                  ))}
                </ul>
              </div>
            )}
            {pressReleases?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] mb-1">Press Releases</h3>
                <ul className="space-y-1">
                  {pressReleases.slice(0, 5).map((p: { title?: string; snippet?: string }, i: number) => (
                    <li key={i} className="text-xs bg-[#1a1a1a] p-2 rounded">
                      <p className="font-medium">{p.title}</p>
                      {p.snippet && <p className="text-[var(--muted)] mt-0.5">{p.snippet}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {!lead.enrichment && !lead.founderProfile && !auditData && !lead.successionNews && !lead.socialSignals && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center mb-4">
          <p className="text-[var(--muted)] mb-2">No research data yet</p>
          <a href="/pipeline" className="text-sm text-[var(--accent)] hover:underline">Run the pipeline to enrich this lead &rarr;</a>
        </div>
      )}
        </>
      )}

      {/* ═══ RAW DATA TAB ═══ */}
      {activeTab === "raw" && (
        <>
      {lead.scraped ? (
        <Section title={`Scraped Website Content (${lead.scraped.pages_scraped} pages)`}>
          <div className="max-h-[600px] overflow-auto">
            <pre className="text-xs whitespace-pre-wrap text-[var(--muted)]">
              {lead.scraped.all_text}
            </pre>
          </div>
        </Section>
      ) : (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center mb-4">
          <p className="text-[var(--muted)] mb-2">No scraped data available</p>
          <p className="text-xs text-[var(--muted)]">{lead.website ? "Website has not been scraped yet" : "No website URL on file"}</p>
        </div>
      )}

      {/* Raw enrichment JSON */}
      {lead.enrichment && (
        <Section title="Raw Enrichment JSON">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)] mb-2"
          >
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
          {showRaw && (
            <div className="max-h-96 overflow-auto">
              <pre className="text-xs whitespace-pre-wrap text-[var(--muted)]">
                {JSON.stringify(lead.enrichment, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      )}
        </>
      )}
    </div>
  );
}
