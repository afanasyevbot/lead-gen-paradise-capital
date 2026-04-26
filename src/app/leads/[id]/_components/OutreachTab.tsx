import { TierBadge } from "./badges";
import { Section, CopyButton } from "./Section";
import type { LeadDetail } from "../_lib/types";

interface OutreachTabProps {
  lead: LeadDetail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  legacyData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenureData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooksData: any;
}

export function OutreachTab({ lead, legacyData, tenureData, hooksData }: OutreachTabProps) {
  return (
    <>
      {!lead.outreach && !legacyData && !tenureData && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center mb-4">
          <p className="text-[var(--muted)] mb-2">No outreach emails generated yet</p>
          <a href="/pipeline" className="text-sm text-[var(--accent)] hover:underline">Run the pipeline to generate outreach &rarr;</a>
        </div>
      )}

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
  );
}
