import { ScoreBadge } from "./badges";
import { Section } from "./Section";
import type { LeadDetail } from "../_lib/types";

export function OverviewTab({ lead }: { lead: LeadDetail }) {
  return (
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
  );
}
