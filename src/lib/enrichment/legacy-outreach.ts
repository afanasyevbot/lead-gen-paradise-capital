/**
 * Legacy Outreach Generator
 *
 * Creates personalized emails that reference the founder's long-term legacy
 * (based on company age, career signals, and founder profile data) and
 * subtly introduces Paradise Capital as a way to "secure the next phase."
 *
 * This is a PREMIUM outreach tier — only used for leads that have:
 * - Founder profile data (age 55+, or career_stage = "late" / "near_retirement")
 * - High exit-readiness score (7+)
 * - Strong succession or legacy signals
 *
 * The tone is fundamentally different from standard outreach:
 * - Standard: "Hey, I help business owners explore options"
 * - Legacy:   "I've watched what you've built over [X] years, and I think
 *              your story deserves the right ending."
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";
import { buildSystemPrompt } from "./brand-context";

const LEGACY_SYSTEM_PROMPT = `You are Paul Niccum's ghostwriter. You're writing a SPECIAL outreach email for a business owner who has built something significant over decades and may be approaching the question of "what comes next."

This is NOT a standard cold email. This goes to founders who are 55+, have 20+ year businesses, and show signals of thinking about their legacy. These people have seen every sales pitch. They'll delete anything that smells transactional.

PAUL'S LEGACY APPROACH:
Paul believes every founder's exit story matters. He's not buying businesses — he's helping people write the final chapter of something they built from nothing. This is deeply personal work for him.

THE LEGACY EMAIL STRUCTURE:

1. THE LEGACY ACKNOWLEDGMENT (1-2 sentences):
Open by honoring what they built — but make it SPECIFIC. Not "you've built a great business" (generic). Instead:
- "[X] years of building [Business] from [specific origin detail] to what it is today — that's not just a business, that's a life's work."
- "Most [industry] businesses don't make it 5 years. You've been doing this for [X]. That tells me a lot about who you are."
Use the company age, founding story, or industry longevity as the anchor.

2. THE EMPATHY BRIDGE (1-2 sentences):
Show you understand the EMOTIONAL weight of the question, not just the financial one:
- "At some point, every founder starts wondering — not IF they'll move on, but HOW to do it in a way that honors what they've built."
- "The question isn't really about selling. It's about making sure [employees/customers/community] are taken care of after you step back."
If there are succession signals, reference the FEELING not the fact.

3. THE QUIET OFFER (1 sentence):
Position Paradise Capital as a guide, not a buyer:
- "That's exactly the kind of conversation I have with owners like you — no pressure, no timeline, just clarity about your options."
- "I help founders understand what their business is worth and what their options look like — whenever they're ready to think about it."

4. THE PERSONAL CLOSE (1-2 sentences):
Paul makes it human. Reference a shared value or personal connection point:
- If faith signals: "I believe every business owner deserves a partner who respects what they've built, not just what it's worth on paper."
- If community signals: "Your [charity/community thing] tells me you care about more than the bottom line. So do I."
- Default: "I'd be honored to buy you a coffee and hear the story of how you built this."

ONE-TO-ONE RULE: The first line must apply ONLY to this specific person — their business name, founding year, city, specific service, community impact. If it could be sent to 100 owners unchanged, rewrite it.

ANTI-AI RULES — these patterns are banned:
- Openers: "I hope this finds you well," "I wanted to reach out," "I came across," "I noticed that"
- Structures: three-part parallel lists, em-dash clause balancing, stacked compliments before the point, "It's not about X, it's about Y"
- Words: "resonate," "tapestry," "testament," "remarkable," "invaluable," "robust," "transformative," "pivotal," "passionate about," "I'd love to connect"
- Write like a person texting a peer they respect — not like a template

ABSOLUTE RULES:
- Total: 85-110 words. Earn every word — depth justifies length, but brevity earns the read.
- NEVER use: "exit strategy," "maximize value," "strategic acquisition," "unlock value," "liquidity event"
- DO use: "legacy," "life's work," "next chapter," "what you've built," "the right ending"
- If you know the founder's age or career stage, weave it in naturally — NEVER say "since you're nearing retirement"
- Lead with a SIGNAL if one exists (succession news, milestone anniversary, industry movement) — signal-based openers get 3-4x higher reply rates
- Reference SPECIFIC details from their career/business. A 25-year marina owner in Tampa is different from a 30-year HVAC founder in Ohio.
- The email should make the reader feel SEEN, not targeted.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "subject_line": "string — 3-7 words, legacy-themed, personal",
  "email_body": "string — the full email",
  "legacy_angle": "string — the specific legacy detail you anchored on",
  "emotional_hook": "string — the emotional insight you're appealing to",
  "personalization_notes": "string — explain to Paul what specific details you used so he can verify",
  "alternative_subject": "string — second subject line option",
  "follow_up_theme": "string — what the follow-up should reference if no response"
}`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export async function generateLegacyOutreach(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ generated: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_outreach (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      outreach_json TEXT NOT NULL,
      legacy_angle TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Only target leads that qualify for legacy outreach:
  // - Have founder profile data
  // - Age 55+ OR career_stage = "late" / "near_retirement"
  // - Score 7+ OR exit_readiness_boost > 0
  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website, l.city, l.state,
           ed.data as enrichment_json,
           sd.data as scoring_json,
           fp.profile_json as founder_json,
           fp.is_age_55_plus, fp.career_stage, fp.exit_readiness_boost,
           sn.owner_signals, sn.industry_signals,
           ss.linkedin_about,
           si.intro_json as social_intro_json
    FROM leads l
    JOIN founder_profiles fp ON fp.lead_id = l.id
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN scoring_data sd ON sd.lead_id = l.id
    LEFT JOIN succession_news sn ON sn.lead_id = l.id
    LEFT JOIN social_signals ss ON ss.lead_id = l.id
    LEFT JOIN social_intros si ON si.lead_id = l.id
    LEFT JOIN legacy_outreach lo ON lo.lead_id = l.id
    WHERE lo.id IS NULL
      AND (fp.is_age_55_plus = 1 OR fp.career_stage IN ('late', 'near_retirement') OR fp.exit_readiness_boost > 0)
    ORDER BY fp.exit_readiness_boost DESC, fp.is_age_55_plus DESC
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    city: string | null;
    state: string | null;
    enrichment_json: string | null;
    scoring_json: string | null;
    founder_json: string | null;
    is_age_55_plus: number;
    career_stage: string | null;
    exit_readiness_boost: number;
    owner_signals: string | null;
    industry_signals: string | null;
    linkedin_about: string | null;
    social_intro_json: string | null;
  }[];

  const counts = { generated: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const scoring = row.scoring_json ? JSON.parse(row.scoring_json) : {};
    const founder = row.founder_json ? JSON.parse(row.founder_json) : {};
    const ownerSignals = row.owner_signals ? JSON.parse(row.owner_signals) : [];
    const industrySignals = row.industry_signals ? JSON.parse(row.industry_signals) : [];

    try {
      const result = await callAnthropicWithRetry<{
        subject_line: string;
        email_body: string;
        legacy_angle: string;
        [key: string]: unknown;
      }>({
        client,
        maxTokens: 1500,
        system: buildSystemPrompt(LEGACY_SYSTEM_PROMPT),
        userContent: `Write a legacy-themed outreach email for this founder.

LEAD:
Business: ${row.business_name}
Owner: ${enrichment.owner_name || "Business Owner"}
Location: ${row.city || ""}, ${row.state || ""}
Industry: ${enrichment.industry_category || "Unknown"}
Website: ${row.website || ""}
Business Age: ${enrichment.business_age_years || "Unknown"} years
Founded: ${enrichment.founded_year || "Unknown"}

FOUNDER PROFILE:
Is Primary Founder: ${founder.is_primary_founder ? "Yes" : "Unknown"}
Estimated Age: ${founder.estimated_current_age || "Unknown"}
Career Stage: ${founder.career_stage || "Unknown"}
Tenure: ${founder.tenure_years || enrichment.business_age_years || "Unknown"} years
Early Career Signals: ${(founder.early_career_signals || []).join("; ") || "None"}
Retirement Indicators: ${(founder.retirement_indicators || []).join("; ") || "None"}

SCORING:
Exit-readiness Score: ${scoring.score || "Unknown"}/10
Best Angle: ${scoring.best_angle || "Unknown"}
Primary Signals: ${(scoring.primary_signals || []).join(", ") || "Unknown"}

SUCCESSION NEWS (if any):
${ownerSignals.length > 0 ? ownerSignals.map((s: { title: string; keyword_matched: string }) => `- "${s.title}" (matched: ${s.keyword_matched})`).join("\n") : "No succession news found"}

INDUSTRY M&A NEWS (if any):
${industrySignals.length > 0 ? industrySignals.map((s: { title: string; keyword_matched: string }) => `- "${s.title}" (matched: ${s.keyword_matched})`).join("\n") : "No industry M&A news found"}

ENRICHMENT DETAILS:
Owner Personal Details: ${enrichment.owner_personal_details || "None"}
Succession Signals: ${enrichment.succession_signals || "None"}
Unique Hooks: ${JSON.stringify(enrichment.unique_hooks || [])}
Services: ${(enrichment.services_offered || []).join(", ") || "Unknown"}

LINKEDIN ABOUT (if available):
${row.linkedin_about || "(not available)"}`,
      });

      db.prepare(`
        INSERT OR REPLACE INTO legacy_outreach
        (lead_id, outreach_json, legacy_angle, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(row.id, JSON.stringify(result), result.legacy_angle || null);

      counts.generated++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
