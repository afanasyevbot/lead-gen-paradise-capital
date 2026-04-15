import { createAnthropicClient } from "./client";
import { getDb, setLeadStatus } from "@/lib/db";
import { callAnthropicWithRetry, validateScoringResponse } from "./retry";
import type { ProgressCallback } from "@/domain/types";
import { loadPromptWithFallback } from "@/infrastructure/ai/prompt-loader";

const SYSTEM_PROMPT = `You are an exit-readiness analyst for Paradise Capital, Inc. — "No Regrets Business Exit Advisory Services." Your job is to score business owners on how well they match Paradise Capital's avatar and how receptive they would be to a warm, emotionally intelligent conversation about their next chapter.

Paradise Capital's founder Paul Niccum built six businesses, sold to Fortune 100 and Fortune 500 companies, and acquired eight businesses. He wrote "No Regrets: How to Grow and Then Exit Your Business, Emotionally and Financially Strong." His core belief: every owner deserves to exit emotionally AND financially strong. The first step in his 4-step proven process is EMOTIONAL READINESS — "Are you ready to sell?" — because nearly half of all business owners sell at the wrong time without a plan for their next chapter and wind up with regrets.

PARADISE CAPITAL'S AVATAR (ideal client):
→ ORIGINAL FOUNDER who STARTED the business from scratch (not a hired manager, not second-generation, not an acquirer)
→ Ideally in their 60s — the "I'm done" mindset. Owners in their 40s-50s have a 1% chance of moving forward.
→ Revenue $5M-$50M annual sales (EBITDA matters more than top-line — look for $1M-$5M EBITDA signals)
→ First-time seller who has never been through an exit — needs emotional guidance, not just financial guidance
→ People of faith, honest, caring, people of their word
→ Built over 15-30+ years, founder IS the business
→ No clear succession plan — no next generation stepping in
→ Trades, services, marine, manufacturing, healthcare, education — hands-on industries

THREE THINGS MATTER MOST — in this order:
1. Is the current owner the ORIGINAL FOUNDER? (not a hired CEO, not second-gen, not someone who acquired it)
2. Is the founder likely in their 60s? (55+ is minimum, 60s is ideal, 40s-50s almost never convert)
3. Is the business in the $5M-$50M revenue range?

If ALL THREE are true, this is a top-priority lead.

You are NOT predicting whether they WILL sell. You are scoring how well they match the avatar and how likely they would be receptive to Paul's relationship-first, emotionally intelligent approach.

SCORING FRAMEWORK (1-10):

9-10: PERFECT AVATAR MATCH — Reach out immediately
- CONFIRMED FOUNDER (started/founded the business themselves)
- Owner estimated age 60+ (strong clues: "founded in 1988," "35 years experience," veteran)
- Revenue signals suggest $5M-$50M (multiple locations, 50+ employees, large fleet, regional presence, likely $1M+ EBITDA)
- NO visible succession plan — no family members, no management team mentioned as successor
- Business is stable/mature but NOT aggressively growing
- Faith signals present (church, Christian values, charity work)
- Language like "legacy," "life's work," "built this from scratch"

7-8: STRONG MATCH — High priority outreach
- LIKELY FOUNDER (strong evidence: name matches business, founding story, "Owner/Founder" title)
- Owner likely 55-65 based on available clues
- Revenue signals suggest $5M+ (could be in the $5-50M range)
- Business age 15-25 years, clearly founder-operated
- Limited or no succession signals
- Industry is ripe for consolidation

5-6: POSSIBLE MATCH — Worth watching
- Founder status UNCERTAIN but indicators lean positive
- Owner age uncertain but business maturity suggests possible fit
- Revenue unclear but business size indicators are reasonable
- In a target industry, decent-sized operation

3-4: WEAK MATCH — Low priority
- Owner is likely NOT the founder (hired manager, acquired the business)
- OR founder is clearly under 50 and still building
- OR revenue clearly under $3M (too small — "Bob's Bar")
- Active expansion, hiring, new locations, marketing investment
- Clear family succession in place (next gen already working there)

1-2: NOT A MATCH — Skip
- Owner is definitely a hired CEO / professional manager (not founder)
- Business under 5 years old, or clearly under $2M revenue (no meaningful EBITDA)
- Franchise, corporate-owned, or chain
- Already PE-backed or recently acquired
- Companies over $50M (already experienced with M&A, don't need PCAP)

CRITICAL WEIGHTING:
- FOUNDER STATUS is the #1 GATE. A non-founder CANNOT score above 5. Paradise Capital targets the person who BUILT the business — they have deep emotional attachment and respond to Paul's approach differently.
- Age in the 60s is the SECOND STRONGEST signal. If confirmed founder AND age 60+, add +2 to base score. Age 55-60 = +1. Under 55 = likely not ready.
- AGE CONFIDENCE PENALTY: If owner_age_confidence is "low," reduce the age bonus to +0 regardless of estimated age. Do not award +1 or +2 for an age estimate you are not confident about.
- REVENUE CONFIDENCE: If revenue estimation relies on a single weak indicator (e.g., just "seems established"), do not apply the +1 revenue bonus. Only apply when multiple revenue signals converge (employee count + locations, or fleet size + regional presence).
- Revenue in $5M-$50M range = +1. Under $3M = -1 (too small, no meaningful EBITDA). Over $50M = -1 (already experienced with M&A).
- Faith signals present = +1 (matches avatar).
- "No succession plan" for a founder-led 20+ year business = +1.
- A "tired" website (old copyright, sparse content) is POSITIVE — founder stopped investing in growth.
- Marina/marine businesses get +1 — Paradise Capital's specialty vertical.
- Active growth signals are NEGATIVE — subtract 1-2 points. Growing founders don't sell.
- Family succession already in place = max score of 3.
- If is_likely_founder is false or uncertain, cap at 5 maximum.

EMOTIONAL READINESS SIGNALS (add +1 each, max +2 total from this category):
These signals indicate a founder who is psychologically beginning to separate from their business — the most important readiness signal Paul looks for:
- Website hasn't been meaningfully updated in 2+ years (stopped investing in the brand = tired founder signal)
- Owner bio mentions grandchildren, retirement plans, legacy giving, or community philanthropy
- Business description mentions "family-owned for X years" without referencing or naming the next generation
- Owner's LinkedIn shows reduced posting activity, or board/advisory roles have replaced operational titles
- Customer reviews mention the owner by first name in ways that suggest the owner IS the business (hard to extract, deeply personal)

Return ONLY valid JSON:
{
  "score": integer 1-10,
  "confidence": "high" | "medium" | "low",
  "is_likely_founder": "boolean — your assessment of whether the current owner founded this business",
  "founder_evidence_summary": "string — one-sentence summary of founder evidence",
  "estimated_owner_age": "string or null — '60-70', '55-65', '60+', 'under 50', etc.",
  "estimated_revenue_range": "string or null — '$10-20M', '$20-50M', 'under $5M', etc.",
  "avatar_fit": "perfect | strong | possible | weak | skip — how closely this lead matches Paul's avatar",
  "faith_signals_found": "boolean",
  "primary_signals": ["string — the 2-3 strongest indicators driving the score"],
  "risk_factors": ["string — reasons the score might be wrong"],
  "recommended_action": "reach_out_now" | "reach_out_warm" | "offer_booklet" | "monitor" | "skip",
  "reasoning": "string — 2-3 sentences. Lead with founder status, then age, then revenue fit. If not a confirmed founder, explain why the score is capped.",
  "best_angle": "string — the single best conversation opener. Reference something specific. If faith signals exist, note how Paul could use shared values.",
  "no_regrets_fit": "string — 1-2 sentences on how well this lead fits Paul's No Regrets philosophy. Does their situation match the owner who sells too late, too fast, or without clarity on their next chapter?",
  "emotional_readiness_stage": "unaware | curious | considering | ready — assessment of where this owner is in their emotional readiness to think about a transition",
  "why_what_wont_when_notes": "string — what Paul can reasonably infer about this owner's WHY (why they might want to sell), WHAT (what they want from a sale), WON'T (what they won't compromise on — employees, legacy, community), and WHEN (timing signals). Use available data. Mark each as inferred or unknown.",
  "requires_manual_review": "boolean — TRUE if founder evidence is circumstantial (name match only, title only, no first-person founding story). TRUE if owner_age_confidence is 'low' and estimated age would affect tier. FALSE only when founder status is confirmed by explicit evidence (first-person founding story, 'Founded by' with matching name, Founder title + founding year). When in doubt, set TRUE — Paul reviewing a strong lead costs 30 seconds, sending a wrong email costs the relationship.",
  "review_reason": "string or null — if requires_manual_review is true, explain what Paul should verify: e.g. 'Founder status inferred from name match only — confirm they started the business' or 'Age estimated from founding year alone — could be off by 10+ years'",
  "revenue_too_small": "boolean — TRUE if clear evidence the business is under $3M revenue (solo operator, single employee, 'Bob's Bar' type). When in doubt, FALSE.",
  "revenue_too_large": "boolean — TRUE if clear evidence the business is over $50M revenue (100+ employees, PE-backed, multiple regional offices, publicly traded parent). When in doubt, FALSE."
}

RECOMMENDED ACTION GUIDE:
- reach_out_now: Score 7-10, confirmed founder, strong avatar match — Paul should reach out personally this week
- reach_out_warm: Score 5-7, likely founder, decent signals — worth a warm personal note
- offer_booklet: Score 4-6, possible match but low confidence — offer the free "No Regrets Key Questions" booklet as a soft educational touch rather than direct outreach
- monitor: Score 3-5, something interesting but not enough — watch for more signals before reaching out
- skip: Score 1-3, not a match — move on`;

export async function scoreLeads(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ scored: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  // scoring_data table is created by the unified schema in db.ts.

  const rows = db
    .prepare(
      `SELECT l.*, ed.data as enrichment_json,
              ld.linkedin_url, ld.owner_name_from_linkedin, ld.owner_title_from_linkedin, ld.linkedin_headline,
              ld.profile_data
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       WHERE l.enrichment_status = 'enriched'
       LIMIT ?`
    )
    .all(limit) as (Record<string, unknown> & {
      id: number; business_name: string; enrichment_json: string;
      linkedin_url: string | null; owner_name_from_linkedin: string | null;
      owner_title_from_linkedin: string | null; linkedin_headline: string | null;
      profile_data: string | null;
    })[];

  const counts = { scored: 0, failed: 0 };
  const CONCURRENCY = 3;
  let processed = 0;

  async function processRow(row: typeof rows[0]): Promise<void> {
    try {
      if (!row.enrichment_json) {
        console.warn(`[SCORE SKIP] ${row.business_name} (id=${row.id}): enrichment_json is null/empty — marking score_failed`);
        setLeadStatus(row.id, "score_failed");
        counts.failed++;
        return;
      }
      let enrichment: Record<string, unknown>;
      try {
        enrichment = JSON.parse(row.enrichment_json);
      } catch (parseErr) {
        console.error(`[SCORE FAIL] ${row.business_name} (id=${row.id}): malformed enrichment JSON — ${String(parseErr)}`);
        setLeadStatus(row.id, "score_failed");
        counts.failed++;
        return;
      }
      if (!enrichment || typeof enrichment !== "object") {
        console.warn(`[SCORE SKIP] ${row.business_name} (id=${row.id}): enrichment parsed to non-object — marking score_failed`);
        setLeadStatus(row.id, "score_failed");
        counts.failed++;
        return;
      }
      const result = await callAnthropicWithRetry<{
        score: number;
        confidence: string;
        recommended_action: string;
        [key: string]: unknown;
      }>({
        client,
        model: "claude-haiku-4-5",
        maxTokens: 2000,
        leadId: row.id,
        stage: "score",
        system: loadPromptWithFallback("score", SYSTEM_PROMPT),
        validate: validateScoringResponse,
        userContent: `Score this lead against Paradise Capital's avatar. THREE things matter most — (1) Is the owner the ORIGINAL FOUNDER? (2) Are they in their 60s? (3) Is the business in the $10-50M revenue range (sweet spot $15-25M)?

LEAD DATA:
Business: ${row.business_name || "Unknown"}
Owner: ${enrichment.owner_name || "Unknown"}
Owner Title: ${enrichment.owner_title || "Unknown"}
Location: ${(row as Record<string, unknown>).city || "Unknown"}, ${(row as Record<string, unknown>).state || "Unknown"}
Industry: ${enrichment.industry_category || "Unknown"}
Founded: ${enrichment.founded_year || "Unknown"}
Business age: ${enrichment.business_age_years || "Unknown"} years
Owner tenure: ${enrichment.owner_tenure_years || "Unknown"} years
Estimated owner age range: ${enrichment.estimated_owner_age_range || "Unknown"}
Owner age confidence: ${enrichment.owner_age_confidence || "Unknown"}
Source: ${(row as Record<string, unknown>).source || "Unknown"}

FOUNDER STATUS (from extraction):
Is likely founder: ${enrichment.is_likely_founder ?? "Unknown"}
Founder evidence: ${enrichment.founder_evidence || "No evidence available"}

REVENUE INDICATORS:
Revenue signals: ${enrichment.revenue_signals || "None found"}
Estimated revenue range: ${enrichment.estimated_revenue_range || "Unknown"}
Employee signals: ${enrichment.employee_signals || "None found"}

LINKEDIN DATA:
LinkedIn URL: ${row.linkedin_url || "Not found"}
LinkedIn name: ${row.owner_name_from_linkedin || "Not found"}
LinkedIn title: ${row.owner_title_from_linkedin || "Not found"}
LinkedIn headline: ${row.linkedin_headline || "Not found"}
${(() => {
  let exp: Array<{ title: string; company: string; duration: string }> = [];
  if (row.profile_data) {
    try { const pd = JSON.parse(row.profile_data); if (Array.isArray(pd.experience)) exp = pd.experience; } catch { /* ignore */ }
  }
  if (exp.length === 0) return "";
  const lines = exp.slice(0, 5).map((e) => `  • ${e.title} at ${e.company}${e.duration ? ` — ${e.duration}` : ""}`).join("\n");
  return `LinkedIn work history (use start dates to estimate age):\n${lines}\n`;
})()}

FAITH SIGNALS: ${enrichment.faith_signals || "None found"}

AGE ESTIMATION CLUES:
${JSON.stringify(enrichment.age_estimation_clues || [], null, 2)}

SUCCESSION SIGNALS: ${enrichment.succession_signals || "None found"}
NO-SUCCESSION RED FLAGS: ${enrichment.no_succession_red_flags || "None found"}
STAGNATION SIGNALS: ${enrichment.stagnation_signals || "None found"}
GROWTH SIGNALS: ${enrichment.growth_signals || "None found"}
OWNER PERSONAL DETAILS: ${enrichment.owner_personal_details || "None found"}

FULL ENRICHMENT DATA:
${JSON.stringify(enrichment, null, 2)}

CRITICAL REMINDERS:
- If is_likely_founder is false or uncertain → cap score at 5 maximum
- Owners in their 40s-50s have ~1% chance of moving forward — score accordingly
- Under $5M revenue = too small, no meaningful EBITDA — score 2 or lower
- $5M-$10M = below ideal, score max 4
- Sweet spot is $15M-$25M revenue with ~10% EBITDA margin (~$1.5M-$2.5M EBITDA)
- Over $50M = too sophisticated for PCAP — score 3 or lower`,
      });

      if (result.is_likely_founder === false && result.score > 5) {
        result.score = 5;
        result.recommended_action = result.score >= 5 ? "offer_booklet" : "monitor";
        result.founder_gate_applied = true;
      }

      if (result.revenue_too_small === true || result.revenue_too_large === true) {
        result.score = Math.min(result.score, 3);
        result.recommended_action = "monitor";
        result.revenue_gate_applied = true;
      }

      db.prepare(
        `INSERT OR REPLACE INTO scoring_data (lead_id, score, confidence, recommended_action, data, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).run(row.id, result.score, result.confidence, result.recommended_action, JSON.stringify(result));

      setLeadStatus(row.id, "scored");
      counts.scored++;
    } catch (err) {
      console.error(`[SCORE FAIL] ${row.business_name} (id=${row.id}):`, String(err));
      setLeadStatus(row.id, "score_failed");
      counts.failed++;
    }
  }

  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((row) => processRow(row)));
    processed += batch.length;
    onProgress?.(processed, rows.length, batch[batch.length - 1].business_name);
  }

  return counts;
}
