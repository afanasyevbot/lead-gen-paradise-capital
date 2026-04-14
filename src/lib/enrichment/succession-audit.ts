/**
 * Succession Readiness Audit
 *
 * Runs each lead through Paradise Capital's 4-step framework:
 * 1. Emotional Readiness — Is the owner ready to imagine life after?
 * 2. Business Structure — Can the business run without the owner?
 * 3. Valuation Positioning — Is the business positioned for maximum value?
 * 4. Action Planning — What's the realistic timeline and next step?
 *
 * This is a CHAINED prompt that takes ALL enrichment data (enrichment,
 * scoring, founder profile, social signals, succession news) and produces
 * a structured audit that feeds into the outreach generator.
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";
import { buildSystemPrompt } from "./brand-context";

const AUDIT_INSTRUCTIONS = `You are conducting a "Succession Readiness Audit" for a business owner based on Paradise Capital's 4-step framework. You are analyzing ALL available data about this lead to assess where they are in their exit journey — even if they don't know they're on one yet.

This is NOT a scoring exercise. This is a NARRATIVE assessment that Paul can use to:
1. Decide whether to reach out
2. Know exactly what to say
3. Understand the owner's emotional state
4. Position Paradise Capital's value precisely

## AUDIT FRAMEWORK

### 1. EMOTIONAL READINESS (Rate: Not Ready / Awakening / Exploring / Ready)
Analyze signals that suggest the owner is emotionally processing the idea of moving on:
- "Legacy" language on website or LinkedIn = Awakening
- Active growth language, new hires, expansion = Not Ready
- Stagnation signals, outdated website, no recent activity = Exploring (often unconsciously)
- Direct succession mentions, "next chapter," reduced involvement = Ready
- Faith/community focus shifting from business to personal = Awakening to Exploring

Key insight Paul needs: "What is this owner's IDENTITY beyond the business?"

### 2. BUSINESS STRUCTURE (Rate: Owner-Dependent / Transitioning / Transferable)
Analyze whether the business could survive an ownership change:
- Solo operator, owner IS the brand = Owner-Dependent
- Has key employees, some delegation visible = Transitioning
- Management team in place, processes documented, scalable = Transferable
- High customer concentration or relationship-dependent revenue = Owner-Dependent risk

Key insight Paul needs: "What would need to change before this business could be sold?"

### 3. VALUATION POSITIONING (Rate: Under-positioned / Moderate / Well-positioned)
Analyze the business's attractiveness to potential buyers:
- Revenue signals: fleet size, customers served, locations, employee count
- Growth trajectory: expanding vs. plateauing vs. declining
- Market position: niche dominance, awards, reputation, Google rating
- Risk factors: single location, narrow service, regulatory exposure

Key insight Paul needs: "What's the ONE thing that would increase this business's value most?"

### 4. ACTION PLANNING (Recommend: Not Now / Warm Introduction / Active Conversation)
Based on the above three dimensions, recommend Paul's next move:
- Not Now: Score below 5, owner clearly in growth mode, no exit signals. Monitor.
- Warm Introduction: Score 5-7, some signals present but timing unclear. Plant the seed.
- Active Conversation: Score 8+, multiple converging signals. This owner needs Paul now.

For "Warm Introduction" and "Active Conversation," provide:
- The SINGLE best opening angle
- The emotional insight to lead with
- The specific "No Regrets" framing to use

## OUTPUT FORMAT — return ONLY valid JSON:
{
  "emotional_readiness": {
    "rating": "not_ready" | "awakening" | "exploring" | "ready",
    "evidence": ["string — specific evidence from the data"],
    "identity_insight": "string — what is this owner's identity beyond the business?",
    "emotional_risk": "string — what fear or concern would prevent them from engaging?"
  },
  "business_structure": {
    "rating": "owner_dependent" | "transitioning" | "transferable",
    "evidence": ["string"],
    "key_vulnerability": "string — the biggest structural risk for a sale",
    "improvement_suggestion": "string — what Paul could advise them to fix BEFORE selling"
  },
  "valuation_positioning": {
    "rating": "under_positioned" | "moderate" | "well_positioned",
    "evidence": ["string"],
    "value_driver": "string — the ONE thing that makes this business most valuable",
    "value_gap": "string — the ONE thing holding the valuation back"
  },
  "action_plan": {
    "recommendation": "not_now" | "warm_introduction" | "active_conversation",
    "opening_angle": "string — the single best way to open a conversation",
    "emotional_lead": "string — the feeling to appeal to (legacy, fear, pride, relief, curiosity)",
    "no_regrets_framing": "string — how to frame Paradise Capital's value using 'No Regrets' language",
    "timeline_estimate": "string — when this owner is likely to be ready (now, 6 months, 1-2 years, 3+ years)",
    "follow_up_strategy": "string — what to do if they don't respond"
  },
  "overall_readiness_score": integer 1-10,
  "paul_summary": "string — 3-4 sentences summarizing this lead for Paul in plain language, as if briefing him before a call"
}`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export interface SuccessionAudit {
  emotional_readiness: {
    rating: string;
    evidence: string[];
    identity_insight: string;
    emotional_risk: string;
  };
  business_structure: {
    rating: string;
    evidence: string[];
    key_vulnerability: string;
    improvement_suggestion: string;
  };
  valuation_positioning: {
    rating: string;
    evidence: string[];
    value_driver: string;
    value_gap: string;
  };
  action_plan: {
    recommendation: string;
    opening_angle: string;
    emotional_lead: string;
    no_regrets_framing: string;
    timeline_estimate: string;
    follow_up_strategy: string;
  };
  overall_readiness_score: number;
  paul_summary: string;
}

export async function runSuccessionAudits(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ audited: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS succession_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      readiness_score INTEGER,
      recommendation TEXT,
      emotional_readiness TEXT,
      business_structure TEXT,
      audit_json TEXT NOT NULL,
      paul_summary TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Get leads with enrichment data that haven't been audited yet
  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website, l.city, l.state,
           l.google_rating, l.review_count,
           ed.data as enrichment_json,
           sd.data as scoring_json,
           fp.profile_json as founder_json,
           sn.owner_signals, sn.industry_signals,
           ss.linkedin_about,
           sc.all_text
    FROM leads l
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN scoring_data sd ON sd.lead_id = l.id
    LEFT JOIN founder_profiles fp ON fp.lead_id = l.id
    LEFT JOIN succession_news sn ON sn.lead_id = l.id
    LEFT JOIN social_signals ss ON ss.lead_id = l.id
    LEFT JOIN scraped_content sc ON sc.lead_id = l.id
    LEFT JOIN succession_audits sa ON sa.lead_id = l.id
    WHERE sa.id IS NULL
      AND l.enrichment_status NOT IN ('pending', 'scrape_failed')
      AND ed.data IS NOT NULL
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    city: string | null;
    state: string | null;
    google_rating: number | null;
    review_count: number | null;
    enrichment_json: string | null;
    scoring_json: string | null;
    founder_json: string | null;
    owner_signals: string | null;
    industry_signals: string | null;
    linkedin_about: string | null;
    all_text: string | null;
  }[];

  const counts = { audited: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const scoring = row.scoring_json ? JSON.parse(row.scoring_json) : {};
    const founder = row.founder_json ? JSON.parse(row.founder_json) : {};
    const ownerSignals = row.owner_signals ? JSON.parse(row.owner_signals) : [];
    const industrySignals = row.industry_signals ? JSON.parse(row.industry_signals) : [];

    // Skip leads with very thin data
    if (!enrichment.business_name && !enrichment.owner_name) {
      counts.skipped++;
      continue;
    }

    try {
      const result = await callAnthropicWithRetry<SuccessionAudit>({
        client,
        maxTokens: 2000,
        system: buildSystemPrompt(AUDIT_INSTRUCTIONS),
        userContent: `Conduct a full Succession Readiness Audit for this lead.

═══════════════════════════════════════════════════════
LEAD OVERVIEW
═══════════════════════════════════════════════════════
Business: ${row.business_name}
Owner: ${enrichment.owner_name || "Unknown"}
Location: ${row.city || ""}, ${row.state || ""}
Industry: ${enrichment.industry_category || "Unknown"}
Website: ${row.website || ""}
Founded: ${enrichment.founded_year || "Unknown"}
Business Age: ${enrichment.business_age_years || "Unknown"} years
Google Rating: ${row.google_rating || "N/A"} (${row.review_count || 0} reviews)

═══════════════════════════════════════════════════════
ENRICHMENT DATA
═══════════════════════════════════════════════════════
Services: ${(enrichment.services_offered || []).join(", ") || "Unknown"}
Employee Signals: ${enrichment.employee_signals || "None"}
Revenue Signals: ${enrichment.revenue_signals || "None"}
Succession Signals: ${enrichment.succession_signals || "None"}
Growth Signals: ${enrichment.growth_signals || "None"}
Stagnation Signals: ${enrichment.stagnation_signals || "None"}
Owner Personal Details: ${enrichment.owner_personal_details || "None"}
Certifications/Awards: ${(enrichment.certifications_awards || []).join(", ") || "None"}
Unique Hooks: ${JSON.stringify(enrichment.unique_hooks || [])}

═══════════════════════════════════════════════════════
EXIT-READINESS SCORING (if available)
═══════════════════════════════════════════════════════
Score: ${scoring.score || "Not scored"}/10
Confidence: ${scoring.confidence || "N/A"}
Recommended Action: ${scoring.recommended_action || "N/A"}
Primary Signals: ${(scoring.primary_signals || []).join(", ") || "N/A"}
Best Angle: ${scoring.best_angle || "N/A"}
Reasoning: ${scoring.reasoning || "N/A"}

═══════════════════════════════════════════════════════
FOUNDER PROFILE (if available)
═══════════════════════════════════════════════════════
Is Primary Founder: ${founder.is_primary_founder ? "Yes" : "Unknown"}
Founder Confidence: ${founder.founder_confidence || "Unknown"}
Estimated Age: ${founder.estimated_current_age || "Unknown"}
Age 55+: ${founder.is_age_55_plus ? "Yes" : "Unknown"}
Career Stage: ${founder.career_stage || "Unknown"}
Tenure: ${founder.tenure_years || "Unknown"} years
Early Career Signals: ${(founder.early_career_signals || []).join("; ") || "None"}
Retirement Indicators: ${(founder.retirement_indicators || []).join("; ") || "None"}
Exit Readiness Boost: ${founder.exit_readiness_boost || 0}

═══════════════════════════════════════════════════════
SUCCESSION NEWS
═══════════════════════════════════════════════════════
Owner Exit Signals:
${ownerSignals.length > 0
  ? ownerSignals.map((s: { title: string; snippet: string; keyword_matched: string }) =>
    `- "${s.title}" (keyword: ${s.keyword_matched})\n  ${s.snippet}`).join("\n")
  : "None found"}

Industry M&A Trends:
${industrySignals.length > 0
  ? industrySignals.map((s: { title: string; keyword_matched: string }) =>
    `- "${s.title}" (keyword: ${s.keyword_matched})`).join("\n")
  : "None found"}

═══════════════════════════════════════════════════════
LINKEDIN ABOUT
═══════════════════════════════════════════════════════
${row.linkedin_about || "(not available)"}

═══════════════════════════════════════════════════════
WEBSITE TEXT (first 3000 chars)
═══════════════════════════════════════════════════════
${(row.all_text || "").slice(0, 3000) || "(not available)"}`,
      });

      db.prepare(`
        INSERT OR REPLACE INTO succession_audits
        (lead_id, readiness_score, recommendation, emotional_readiness,
         business_structure, audit_json, paul_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        result.overall_readiness_score,
        result.action_plan?.recommendation || null,
        result.emotional_readiness?.rating || null,
        result.business_structure?.rating || null,
        JSON.stringify(result),
        result.paul_summary || null,
      );

      counts.audited++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
