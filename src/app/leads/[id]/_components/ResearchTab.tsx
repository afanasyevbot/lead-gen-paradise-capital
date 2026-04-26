import { MiniScore, StageBadge } from "./badges";
import { Section } from "./Section";
import type { LeadDetail } from "../_lib/types";

interface ResearchTabProps {
  lead: LeadDetail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  founderData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ownerSignals: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  industrySignals: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  twitterPosts: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pressReleases: any;
}

export function ResearchTab({ lead, founderData, auditData, ownerSignals, industrySignals, twitterPosts, pressReleases }: ResearchTabProps) {
  return (
    <>
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
  );
}
