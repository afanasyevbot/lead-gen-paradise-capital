/**
 * Tenure & Legacy Email Generator
 *
 * A chained prompt system that:
 * 1. Takes the Succession Readiness Audit output as context
 * 2. Takes ALL lead enrichment data
 * 3. Generates a personalized email using the "No Regrets" framework
 *
 * This is the FINAL output in the prompt chain:
 *   Lead Data → Enrichment → Scoring → Founder Profile → Succession Audit → THIS
 *
 * Each email is tailored to where the founder sits in their exit journey
 * (from the audit's emotional readiness rating) and uses the specific
 * "No Regrets" framing recommended by the audit.
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";
import { buildSystemPrompt } from "./brand-context";

const TENURE_LEGACY_INSTRUCTIONS = `You are writing the FINAL outreach email for Paul Niccum. This is the culmination of Paradise Capital's entire enrichment pipeline — you have MORE context about this business owner than any cold emailer in history. Use it wisely.

## EMAIL TIERS (based on Succession Audit recommendation)

### TIER 1: "ACTIVE CONVERSATION" — The Legacy Letter
For owners rated "ready" or "exploring" with score 8+.
This is Paul's most personal email. 90-110 words — earned with depth, not padded for length.

Structure:
1. THE WITNESS STATEMENT (2 sentences): Paul acknowledges what they built as someone who has built AND sold businesses himself. Reference SPECIFIC details — years, origin story, community impact. This must feel like Paul spent an hour learning about them.

2. THE SHARED EXPERIENCE (2 sentences): Paul shares a BRIEF, relevant moment from his own journey. "When I sold my first business, the hardest part wasn't the numbers — it was imagining what Monday morning would look like." This is NOT about Paul, it's about creating trust through vulnerability.

3. THE "NO REGRETS" BRIDGE (1-2 sentences): Position the conversation as being about "No Regrets" — not about selling. "I wrote a book called 'No Regrets' because I believe every owner deserves to leave on their own terms. I'd love to share a copy with you — no strings."

4. THE HUMAN CLOSE (1 sentence): Make it easy to respond. "I'll be in [their city] next month. Coffee's on me."

### TIER 2: "WARM INTRODUCTION" — The Seed Planter
For owners rated "awakening" with score 5-7.
70-90 words. Lower pressure, higher curiosity.

Structure:
1. THE SPECIFIC NOTICE (1-2 sentences): Reference something real — their founding story, a community award, an industry milestone. Show you actually looked.

2. THE INDUSTRY CONTEXT (1-2 sentences): Reference a REAL industry trend or news item if available. "I've been watching the [industry] space — a lot of owners who built what you have in the [decade] are starting to think about what's next."

3. THE SOFT PLANT (1-2 sentences): Don't ask for a meeting. Offer value. "I help business owners understand their options — even if 'next' is five years away. Sometimes just knowing your number changes how you think about Monday morning."

4. THE OPEN DOOR (1 sentence): "No agenda. When you're curious, I'm here."

### TIER 3: "NOT NOW" — The Long Game Touch
For owners rated "not_ready" with score 3-5.
60-80 words. Pure value, zero ask.

Structure:
1. THE GENUINE COMPLIMENT (1 sentence): Reference something specific and true.
2. THE VALUE DROP (1-2 sentences): Share an insight relevant to their industry or situation. "Owners in [industry] who do [specific thing] tend to be worth 20-30% more when they're eventually ready to explore options."
3. THE NON-ASK (1 sentence): "Just thought you'd find that interesting. All the best — Paul"

## ONE-TO-ONE PERSONALIZATION — NON-NEGOTIABLE
The first line must apply ONLY to this specific person. Business name, founding year, city, specific service, a community they serve — something real. If it could be sent to 100 owners unchanged, rewrite it.

## ANTI-AI WRITING RULES — BANNED
- Openers: "I hope this finds you well," "I wanted to reach out," "I came across," "I noticed that," any "I" + filler verb opener
- Structures: three-part parallel lists, em-dash clause balancing, stacked compliments before the point, "It's not about X, it's about Y," rhetorical questions you immediately answer
- Words: "resonate," "tapestry," "testament," "remarkable," "invaluable," "robust," "transformative," "pivotal," "compelling," "passionate about," "I'd love to connect"
- Write like a person texting a peer they respect — short, direct, real. Incomplete thoughts are fine. Not every sentence needs to be a full thought.

## SUBJECT LINE RULES
- If content hooks are available, use the BEST hook as the subject line
- If social intro is available, use the social reference as the subject line
- If neither: use a legacy-themed subject that references their tenure
- NEVER: "Quick question," "Opportunity," "Your business"
- 3-8 words maximum

## OUTPUT FORMAT — return ONLY valid JSON:
{
  "tier": "active_conversation" | "warm_introduction" | "not_now",
  "subject_line": "string",
  "email_body": "string",
  "alternative_subject": "string",
  "personalization_depth": "deep" | "moderate" | "light",
  "no_regrets_element": "string — which 'No Regrets' principle this email anchors on",
  "emotional_appeal": "string — the primary emotion being addressed (legacy, fear, pride, curiosity, relief)",
  "follow_up_1": {
    "days_after": 4,
    "subject_line": "string — RE: original subject (same thread)",
    "email_body": "string — 50-70 words, financial angle: cost of no plan",
    "value_add": "string — what financial reality this surfaces"
  },
  "follow_up_2": {
    "days_after": 12,
    "subject_line": "string — fresh subject, new thread",
    "email_body": "string — 40-55 words, gracious permanent close",
    "value_add": "string — how friction is removed"
  },
  "notes_for_paul": "string — what Paul should know before sending, including any risks or sensitivities"
}`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export async function generateTenureLegacyEmails(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ generated: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenure_legacy_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      tier TEXT NOT NULL,
      email_json TEXT NOT NULL,
      subject_line TEXT,
      emotional_appeal TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Get leads with succession audits that don't have tenure/legacy emails yet
  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website, l.city, l.state,
           ed.data as enrichment_json,
           sd.data as scoring_json,
           sa.audit_json,
           sa.recommendation,
           fp.profile_json as founder_json,
           si.intro_json as social_intro_json,
           ck.hooks_json as content_hooks_json,
           sn.owner_signals, sn.industry_signals
    FROM leads l
    JOIN succession_audits sa ON sa.lead_id = l.id
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN scoring_data sd ON sd.lead_id = l.id
    LEFT JOIN founder_profiles fp ON fp.lead_id = l.id
    LEFT JOIN social_intros si ON si.lead_id = l.id
    LEFT JOIN content_hooks ck ON ck.lead_id = l.id
    LEFT JOIN succession_news sn ON sn.lead_id = l.id
    LEFT JOIN tenure_legacy_emails tle ON tle.lead_id = l.id
    WHERE tle.id IS NULL
    ORDER BY sa.readiness_score DESC
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    city: string | null;
    state: string | null;
    enrichment_json: string | null;
    scoring_json: string | null;
    audit_json: string | null;
    recommendation: string | null;
    founder_json: string | null;
    social_intro_json: string | null;
    content_hooks_json: string | null;
    owner_signals: string | null;
    industry_signals: string | null;
  }[];

  const counts = { generated: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const scoring = row.scoring_json ? JSON.parse(row.scoring_json) : {};
    const audit = row.audit_json ? JSON.parse(row.audit_json) : {};
    const founder = row.founder_json ? JSON.parse(row.founder_json) : {};
    const socialIntro = row.social_intro_json ? JSON.parse(row.social_intro_json) : null;
    const contentHooks = row.content_hooks_json ? JSON.parse(row.content_hooks_json) : null;
    const ownerSignals = row.owner_signals ? JSON.parse(row.owner_signals) : [];
    const industrySignals = row.industry_signals ? JSON.parse(row.industry_signals) : [];

    try {
      const result = await callAnthropicWithRetry<{
        tier: string;
        subject_line: string;
        email_body: string;
        emotional_appeal: string;
        [key: string]: unknown;
      }>({
        client,
        maxTokens: 2000,
        system: buildSystemPrompt(TENURE_LEGACY_INSTRUCTIONS),
        userContent: `Generate a Tenure & Legacy email for this lead using the full enrichment chain.

═══════════════════════════════════════════════════════
LEAD OVERVIEW
═══════════════════════════════════════════════════════
Business: ${row.business_name}
Owner: ${enrichment.owner_name || "Business Owner"}
Location: ${row.city || ""}, ${row.state || ""}
Industry: ${enrichment.industry_category || "Unknown"}
Website: ${row.website || ""}
Founded: ${enrichment.founded_year || "Unknown"}
Business Age: ${enrichment.business_age_years || "Unknown"} years

═══════════════════════════════════════════════════════
SUCCESSION READINESS AUDIT (from previous prompt in chain)
═══════════════════════════════════════════════════════
Overall Readiness Score: ${audit.overall_readiness_score || "N/A"}/10
Recommendation: ${audit.action_plan?.recommendation || row.recommendation || "warm_introduction"}
Paul's Summary: ${audit.paul_summary || "N/A"}

Emotional Readiness: ${audit.emotional_readiness?.rating || "unknown"}
- Evidence: ${(audit.emotional_readiness?.evidence || []).join("; ") || "None"}
- Identity Insight: ${audit.emotional_readiness?.identity_insight || "Unknown"}
- Emotional Risk: ${audit.emotional_readiness?.emotional_risk || "Unknown"}

Business Structure: ${audit.business_structure?.rating || "unknown"}
- Key Vulnerability: ${audit.business_structure?.key_vulnerability || "Unknown"}

Valuation: ${audit.valuation_positioning?.rating || "unknown"}
- Value Driver: ${audit.valuation_positioning?.value_driver || "Unknown"}

Recommended Opening Angle: ${audit.action_plan?.opening_angle || "N/A"}
Emotional Lead: ${audit.action_plan?.emotional_lead || "N/A"}
No Regrets Framing: ${audit.action_plan?.no_regrets_framing || "N/A"}

═══════════════════════════════════════════════════════
FOUNDER PROFILE
═══════════════════════════════════════════════════════
Primary Founder: ${founder.is_primary_founder ? "Yes" : "Unknown"}
Estimated Age: ${founder.estimated_current_age || "Unknown"}
Career Stage: ${founder.career_stage || "Unknown"}
Tenure: ${founder.tenure_years || enrichment.business_age_years || "Unknown"} years
Retirement Indicators: ${(founder.retirement_indicators || []).join("; ") || "None"}

═══════════════════════════════════════════════════════
ENRICHMENT DETAILS
═══════════════════════════════════════════════════════
Succession Signals: ${enrichment.succession_signals || "None"}
Stagnation Signals: ${enrichment.stagnation_signals || "None"}
Growth Signals: ${enrichment.growth_signals || "None"}
Revenue Signals: ${enrichment.revenue_signals || "None"}
Owner Personal Details: ${enrichment.owner_personal_details || "None"}
Unique Hooks: ${JSON.stringify(enrichment.unique_hooks || [])}
Services: ${(enrichment.services_offered || []).join(", ") || "Unknown"}

═══════════════════════════════════════════════════════
SCORING CONTEXT
═══════════════════════════════════════════════════════
Exit Score: ${scoring.score || "N/A"}/10
Best Angle: ${scoring.best_angle || "N/A"}
Primary Signals: ${(scoring.primary_signals || []).join(", ") || "N/A"}

═══════════════════════════════════════════════════════
AVAILABLE PERSONALIZATION ASSETS
═══════════════════════════════════════════════════════
${socialIntro ? `Social Intro (pre-generated): ${socialIntro.intro_text}\nSource: ${socialIntro.source_used} — "${socialIntro.specific_reference}"` : "No social intro available"}

${contentHooks ? `Content Hook Subjects:\n${(contentHooks.hooks || []).map((h: { subject_line: string; source_content: string; quality: string }) => `- "${h.subject_line}" (${h.quality}) — based on: "${h.source_content}"`).join("\n")}` : "No content hooks available"}

${ownerSignals.length > 0 ? `Succession News:\n${ownerSignals.map((s: { title: string; keyword_matched: string }) => `- "${s.title}" (${s.keyword_matched})`).join("\n")}` : "No succession news"}

${industrySignals.length > 0 ? `Industry M&A News:\n${industrySignals.map((s: { title: string; keyword_matched: string }) => `- "${s.title}" (${s.keyword_matched})`).join("\n")}` : "No industry news"}`,
      });

      db.prepare(`
        INSERT OR REPLACE INTO tenure_legacy_emails
        (lead_id, tier, email_json, subject_line, emotional_appeal, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        result.tier || "warm_introduction",
        JSON.stringify(result),
        result.subject_line || null,
        result.emotional_appeal || null,
      );

      counts.generated++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
