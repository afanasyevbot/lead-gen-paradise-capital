"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ScoreBadge, TierBadge } from "./_components/badges";
import { PushToInstantly } from "./_components/PushToInstantly";
import { LeadActions } from "./_components/LeadActions";
import { OverviewTab } from "./_components/OverviewTab";
import { OutreachTab } from "./_components/OutreachTab";
import { ResearchTab } from "./_components/ResearchTab";
import { RawTab } from "./_components/RawTab";
import { safeJson } from "./_lib/safe-json";
import type { LeadDetail } from "./_lib/types";

type Tab = "overview" | "outreach" | "research" | "raw";

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<LeadDetail | null>(null);
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

      <LeadActions
        leadId={lead.id}
        status={lead.enrichment_status}
        onComplete={() => {
          fetch(`/api/leads/${id}`).then((r) => r.json()).then(setLead);
        }}
      />

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

      {activeTab === "overview" && <OverviewTab lead={lead} />}
      {activeTab === "outreach" && (
        <OutreachTab lead={lead} legacyData={legacyData} tenureData={tenureData} hooksData={hooksData} />
      )}
      {activeTab === "research" && (
        <ResearchTab
          lead={lead}
          founderData={founderData}
          auditData={auditData}
          ownerSignals={ownerSignals}
          industrySignals={industrySignals}
          twitterPosts={twitterPosts}
          pressReleases={pressReleases}
        />
      )}
      {activeTab === "raw" && <RawTab lead={lead} />}
    </div>
  );
}
