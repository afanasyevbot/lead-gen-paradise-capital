import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { getDb, setLeadStatus } from "@/lib/db";
import { createAnthropicClient } from "@/lib/enrichment/client";

/**
 * Stage 00b — Haiku ICP Screen (~$0.0006/lead)
 *
 * Runs AFTER website scraping, BEFORE expensive extraction.
 * Uses claude-haiku for a fast yes/no ICP match — saves ~$0.015/lead
 * on leads that would fail extraction anyway.
 *
 * ICP: Founder-owned, $5M-$50M revenue, trades/services/manufacturing,
 * owner likely 55+, no clear succession plan.
 */

const ICP_SCREEN_PROMPT = `You are screening business leads for Paradise Capital, a boutique M&A advisory firm that works with founder-owned businesses ($10M-$50M revenue, sweet spot $15M-$25M) helping founders aged late 50s to mid-60s exit emotionally and financially strong.

Respond with ONLY valid JSON: {"match": true/false, "reason": "one sentence"}

ICP MATCH = true if ALL of:
- Appears to be a founder-owned, founder-operated business (not a franchise, chain, PE-backed, or corporate subsidiary)
- Industry has a clear PE or strategic buyer universe: manufacturing, fabrication, distribution, logistics, professional services, consulting, marketing/advertising, staffing, IT services, printing, trades (HVAC, plumbing, roofing, electrical, landscaping, pest control, waste, marine, auto body), or similar B2B businesses
- Business appears established (10+ years) and large enough to have $1M+ EBITDA ($10M+ revenue signals: multiple employees, regional presence, fleet, facilities)
- Owner appears to be the original founder, likely in their 50s-60s

ICP MATCH = false if ANY of:
- Clearly a franchise, national chain, or corporate subsidiary
- Obvious micro-business or solo operator (under $5M revenue signals)
- Industry is: retail, restaurant, bar, cafe, food service, healthcare (medical/dental/therapy), real estate brokerage, consumer personal services (salons, spas), funeral services, or structurally declining (print media, video rental)
- Clearly PE-backed, recently acquired, or already through an exit
- Owner is clearly a hired professional manager or second-generation, not the original founder`;

export const icpScreenStage: PipelineStage = {
  name: "icp-screen",
  description: "Haiku ICP screening",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const db = getDb();
    const client = createAnthropicClient();

    // Runs on leads that passed scraping
    const leads = db
      .prepare(
        `SELECT l.id, l.business_name, l.address, l.google_rating,
                l.review_count, l.business_types, l.website,
                sc.all_text as website_content
         FROM leads l
         LEFT JOIN scraped_content sc ON sc.lead_id = l.id
         WHERE l.enrichment_status = 'scraped'
         LIMIT ?`
      )
      .all(ctx.limit) as {
        id: number;
        business_name: string;
        address: string | null;
        google_rating: number | null;
        review_count: number;
        business_types: string | null;
        website: string | null;
        website_content: string | null;
      }[];

    let matched = 0;
    let rejected = 0;
    let errored = 0;

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      ctx.onItemProgress(i + 1, leads.length, lead.business_name);

      // Build compact description — keep token count low
      const websiteSnippet = lead.website_content
        ? lead.website_content.slice(0, 600)
        : null;

      const input = [
        `Business: ${lead.business_name}`,
        lead.address ? `Address: ${lead.address}` : null,
        lead.business_types ? `Category: ${lead.business_types}` : null,
        lead.review_count ? `Reviews: ${lead.review_count} (${lead.google_rating ?? "n/a"} stars)` : null,
        lead.website ? `Website: ${lead.website}` : "No website",
        websiteSnippet ? `Website excerpt: ${websiteSnippet}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const response = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 80,
          system: ICP_SCREEN_PROMPT,
          messages: [{ role: "user", content: input }],
        });

        const text =
          response.content[0].type === "text" ? response.content[0].text.trim() : "";

        let result: { match: boolean; reason: string } | null = null;
        try {
          result = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
        } catch {
          result = null;
        }

        if (result && result.match === true) {
          // Keep as 'scraped' — extract stage picks it up
          matched++;
        } else if (result && result.match === false) {
          setLeadStatus(lead.id, "icp_rejected");
          rejected++;
        } else {
          // Fail CLOSED — we don't know, mark for manual review rather than
          // spending extraction budget on something Haiku couldn't classify.
          setLeadStatus(lead.id, "icp_parse_error");
          errored++;
        }
      } catch (err) {
        // API error — fail closed too. Otherwise transient outages silently
        // pass through everything and burn the extraction budget.
        console.warn(`[ICP_SCREEN] API error for lead ${lead.id}:`, String(err));
        setLeadStatus(lead.id, "icp_screen_error");
        errored++;
      }
    }

    return {
      icp_matched: matched,
      icp_rejected: rejected,
      icp_screen_errors: errored,
    };
  },
};
