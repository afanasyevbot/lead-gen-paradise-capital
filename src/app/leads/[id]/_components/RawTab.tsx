"use client";

import { useState } from "react";
import { Section } from "./Section";
import type { LeadDetail } from "../_lib/types";

export function RawTab({ lead }: { lead: LeadDetail }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
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
  );
}
