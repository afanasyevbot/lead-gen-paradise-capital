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

/**
 * Tolerant parser for Haiku's ICP response.
 *
 * Strategy:
 *  1. Strip markdown code fences
 *  2. Try strict JSON.parse
 *  3. Fall back to extracting `{...}` substring (longest brace-balanced span)
 *  4. Last resort: regex scan for `"match": true|false`
 *
 * Returns null only if no signal can be recovered.
 */
export function parseIcpResponse(raw: string): { match: boolean; reason: string } | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Strict parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.match === "boolean") {
      return { match: parsed.match, reason: String(parsed.reason ?? "") };
    }
  } catch { /* fall through */ }

  // Extract first balanced {...} substring
  const start = cleaned.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, i + 1));
            if (typeof parsed?.match === "boolean") {
              return { match: parsed.match, reason: String(parsed.reason ?? "") };
            }
          } catch { /* fall through to regex */ }
          break;
        }
      }
    }
  }

  // Regex fallback — pick up "match": true|false even from broken JSON
  const m = cleaned.match(/["']?match["']?\s*:\s*(true|false)/i);
  if (m) {
    const reasonMatch = cleaned.match(/["']?reason["']?\s*:\s*"([^"]+)"/);
    return {
      match: m[1].toLowerCase() === "true",
      reason: reasonMatch?.[1] ?? "(extracted from malformed JSON)",
    };
  }

  return null;
}

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

      let result: { match: boolean; reason: string } | null = null;
      let lastResponseText = "";

      // Up to 2 attempts: original prompt, then a retry with a stricter reminder.
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
          const messages: { role: "user" | "assistant"; content: string }[] = [
            { role: "user", content: input },
          ];
          if (attempt === 2) {
            // Steer the retry: pre-fill assistant with `{` so the next token
            // must be a JSON key. Forces structured output even when the model
            // wanted to ramble.
            messages.push({ role: "assistant", content: "{" });
          }

          const response = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 80,
            system: ICP_SCREEN_PROMPT,
            messages,
          });

          let text =
            response.content[0].type === "text" ? response.content[0].text.trim() : "";

          // If we pre-filled "{", prepend it back to the response.
          if (attempt === 2) text = "{" + text;
          lastResponseText = text;

          result = parseIcpResponse(text);
        } catch (err) {
          console.warn(`[ICP_SCREEN] API error attempt ${attempt} for lead ${lead.id}:`, String(err));
          // Don't retry on API errors — those are network/quota, not parse issues.
          if (attempt === 1) {
            setLeadStatus(lead.id, "icp_screen_error");
            errored++;
            break;
          }
        }
      }

      if (result && result.match === true) {
        matched++;
      } else if (result && result.match === false) {
        setLeadStatus(lead.id, "icp_rejected");
        rejected++;
      } else if (lastResponseText) {
        // Both attempts failed to produce parseable JSON — fail closed and
        // log the raw text so we can post-mortem what Haiku actually said.
        console.warn(`[ICP_SCREEN] parse failed for lead ${lead.id}, raw: ${lastResponseText.slice(0, 200)}`);
        setLeadStatus(lead.id, "icp_parse_error");
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
