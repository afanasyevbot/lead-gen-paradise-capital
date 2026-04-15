import { getDb, setLeadStatus } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";
import { createAnthropicClient } from "./client";
import type { ProgressCallback } from "@/domain/types";
import { loadPromptWithFallback } from "@/infrastructure/ai/prompt-loader";
import { estimateAgeFromLinkedIn, formatAgeEstimateBlock } from "./age-estimator";

const SYSTEM_PROMPT = `You are a data extraction agent for Paradise Capital, an M&A advisory firm that helps founders exit their businesses with "No Regrets." Your #1 goal is to identify FOUNDER-OWNED businesses where the ORIGINAL FOUNDER is ideally in their 60s and approaching exit.

PARADISE CAPITAL'S AVATAR (ideal client):
→ FOUNDER who started the business from scratch (not hired manager, not second-generation, not an acquirer)
→ Ideally in their 60s — "the I'm done mindset." Owners in their 40s-50s rarely move forward.
→ Revenue $5M-$50M annual sales (EBITDA matters more than top-line — look for $1M-$5M EBITDA signals)
→ First-time seller — has never been through an exit and needs emotional guidance
→ People of faith, honest, caring, people of their word
→ Trades, services, marine, manufacturing, healthcare, education — hands-on industries

The distinction between FOUNDER and HIRED MANAGER matters enormously. Paradise Capital targets the person who BUILT the business from scratch — they have deep emotional attachment to their life's work. A hired CEO or second-generation operator is a completely different conversation.

Return ONLY valid JSON. No markdown, no explanation, no preamble.

JSON schema:
{
  "business_name": "string",
  "owner_name": "string or null",
  "owner_title": "string or null",
  "is_likely_founder": "boolean — true if the current owner appears to be the person who STARTED/FOUNDED the business, false if they appear to be a hired manager, second-gen, or acquired the business",
  "founder_evidence": "string or null — the specific evidence for why you believe they are/aren't the founder: 'About page says John started the company in 1992', 'Family name matches business name', 'Website says founded by current owner', etc.",
  "founded_year": "integer or null",
  "business_age_years": "integer or null",
  "estimated_owner_age_range": "string or null — e.g. '60-70', '55-65', '60+', 'under 50'. Be conservative — only estimate when real clues exist",
  "owner_age_confidence": "'high' | 'medium' | 'low' — how confident are you in the age estimate?",
  "owner_tenure_years": "integer or null — how long the current owner has run this business",
  "location_city": "string or null",
  "location_state": "string or null",
  "industry_category": "string",
  "services_offered": ["string"],
  "employee_signals": "string or null — team size, staff count, hiring mentions",
  "revenue_signals": "string or null — customers served, units sold, fleet size, locations, capacity. Look for signals that suggest $5M-$50M revenue: multiple locations, 50+ employees, large fleet, regional presence",
  "estimated_revenue_range": "string or null — e.g. '$5-10M', '$10-20M', '$20-50M', 'under $5M', 'unknown'. Use employee count, location count, fleet size, industry benchmarks to estimate",
  "succession_signals": "string or null — mentions of family business, next generation, retirement, legacy, transition, selling, new ownership",
  "no_succession_red_flags": "string or null — signs there is NO succession plan: single founder for 20+ years, no family mentioned in operations, no management team, no 'next generation' language",
  "growth_signals": "string or null — recent expansions, new locations, new services, hiring",
  "stagnation_signals": "string or null — outdated website, old copyright year, no recent news, limited online presence",
  "owner_personal_details": "string or null — age mentions, tenure, personal story, military service, faith references, founding story, community involvement",
  "faith_signals": "string or null — any references to faith, church involvement, Christian values, mission statement with faith language, charity work, 'blessed', 'calling', Bible references",
  "age_estimation_clues": ["string — every clue that helps estimate founder age"],
  "owner_email": "string or null — the owner/founder's direct email if found on the website. Look for personal emails (john@company.com, firstname@domain.com). Prefer personal emails over generic ones (info@, contact@, sales@). If only generic emails exist, still capture the best one.",
  "company_email": "string or null — the main company contact email (info@, contact@, etc.) if no personal email found",
  "certifications_awards": ["string"],
  "unique_hooks": ["string — 2-3 specific details for personalized outreach: founding story, community involvement, awards, faith connection, unique service, personal details"]
}

Rules:
- If information is not present, use null. Never fabricate.
- THREE THINGS MATTER MOST: (1) Is this person the FOUNDER? (2) Are they likely 60+? (3) Does the business look like $5M-$50M revenue?

FOUNDER DETECTION — look for these signals:
  * "I started this company..." or "Founded by [name]" = confirmed founder
  * Owner's last name matches the business name (e.g. "Smith" runs "Smith Plumbing") = likely founder
  * "About" page tells a founding story in first person = likely founder
  * Title is "Founder," "Owner/Founder," "President & Founder" = confirmed
  * Business is 20+ years old and owner name appears everywhere = likely founder
  * "Second generation" or "took over from my father" = NOT the original founder
  * No founding story, generic corporate language = possibly hired management

AGE ESTIMATION — Paradise Capital's sweet spot is founders in their 60s:
  * "Founded in 1985" → if they're the founder who started at 25-35, they're ~65-75 now = IDEAL
  * "Over 30 years experience" → started career at ~22, so they're ~52+ = getting close
  * "Vietnam veteran" → born ~1945-1955, now ~70-80 = in range
  * Military service dates, graduation years, children's ages all help
  * Owners in their 40s-50s are typically NOT ready (Paul says "1% chance of moving forward")
  * If you can't estimate age with any confidence, say so — don't guess wildly

REVENUE ESTIMATION — target is $5M-$50M annual sales (EBITDA $1M-$5M is the real sweet spot):
  * 50+ employees typically = $5M+ revenue
  * Multiple locations = likely $5M+
  * Large fleet (20+ vehicles/boats) = likely $5M+
  * "Served 10,000+ customers" or regional dominance = revenue signal
  * Single-person operation or "Bob's Bar" type = too small

FAITH SIGNALS — capture any reference to:
  * Church involvement, mission trips, Christian values in mission statement
  * "Blessed," "calling," "God," Bible references, faith-based charity work
  * These are positive indicators for Paradise Capital's avatar

- "unique_hooks" should capture 2-3 specific details for personalized outreach — founding story, community involvement, faith connection, personal interests`;

export async function enrichLeads(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ enriched: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  // enrichment_data table is created by the unified schema in db.ts.

  const rows = db
    .prepare(
      `SELECT l.id, l.business_name, l.website, l.source, sc.all_text,
              ld.linkedin_url, ld.owner_name_from_linkedin, ld.owner_title_from_linkedin, ld.linkedin_headline,
              ld.profile_data
       FROM leads l
       JOIN scraped_content sc ON sc.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       WHERE l.enrichment_status = 'scraped'
       LIMIT ?`
    )
    .all(limit) as {
      id: number; business_name: string; website: string; source: string; all_text: string;
      linkedin_url: string | null; owner_name_from_linkedin: string | null;
      owner_title_from_linkedin: string | null; linkedin_headline: string | null;
      profile_data: string | null;
    }[];

  const counts = { enriched: 0, failed: 0 };
  const CONCURRENCY = 3; // Safe under Anthropic's 50 RPM limit
  let processed = 0;

  async function processRow(row: typeof rows[0], index: number): Promise<void> {
    onProgress?.(index + 1, rows.length, row.business_name);
    try {
      const result = await callAnthropicWithRetry<Record<string, unknown>>({
        client,
        model: "claude-haiku-4-5",
        maxTokens: 2000,
        leadId: row.id,
        stage: "extract",
        system: loadPromptWithFallback("extract", SYSTEM_PROMPT),
        userContent: (() => {
          const hasWebsite = row.all_text && row.all_text.trim().length > 50;
          const hasLinkedIn = row.owner_name_from_linkedin || row.linkedin_headline;
          const isLinkedInOnly = !hasWebsite && hasLinkedIn;

          // Parse LinkedIn profile_data (set by stage 16 profile visit) for experience/tenure
          let linkedInExperience: Array<{ title: string; company: string; duration: string }> = [];
          let linkedInEducation: Array<{ school: string; degree: string; years: string }> = [];
          if (row.profile_data) {
            try {
              const pd = JSON.parse(row.profile_data);
              if (Array.isArray(pd.experience)) linkedInExperience = pd.experience;
              if (Array.isArray(pd.education)) linkedInEducation = pd.education;
            } catch { /* ignore */ }
          }

          // Deterministic age calculation — done in code, not left to Claude
          const ageEstimate = estimateAgeFromLinkedIn(linkedInExperience, linkedInEducation);

          const experienceBlock = linkedInExperience.length > 0
            ? linkedInExperience.slice(0, 5).map((e) =>
                `  • ${e.title} at ${e.company}${e.duration ? ` — ${e.duration}` : ""}`
              ).join("\n")
            : null;

          const educationBlock = linkedInEducation.length > 0
            ? linkedInEducation.slice(0, 3).map((e) =>
                `  • ${e.school}${e.degree ? ` — ${e.degree}` : ""}${e.years ? ` (${e.years})` : ""}`
              ).join("\n")
            : null;

          const ageBlock = formatAgeEstimateBlock(ageEstimate);

          return `Extract business and ownership data from ${isLinkedInOnly ? "LinkedIn profile data" : "this website text and LinkedIn data"}.

Business name from lead list: ${row.business_name}
Website URL: ${row.website || "Not available"}
Source: ${row.source}

--- LINKEDIN DATA${isLinkedInOnly ? " (PRIMARY SOURCE — no website available)" : " (if available)"} ---
LinkedIn URL: ${row.linkedin_url || "Not found"}
Owner name (from LinkedIn): ${row.owner_name_from_linkedin || "Not found"}
Owner title (from LinkedIn): ${row.owner_title_from_linkedin || "Not found"}
LinkedIn headline: ${row.linkedin_headline || "Not found"}${experienceBlock ? `\nLinkedIn work history:\n${experienceBlock}` : ""}${educationBlock ? `\nLinkedIn education:\n${educationBlock}` : ""}${ageBlock}
--- END LINKEDIN ---

NOTE: LinkedIn title is a STRONG signal for founder detection. "Founder," "Owner/Founder," "President & Founder" = confirmed founder. "General Manager," "VP," "Director" = likely hired. Use the headline for career tenure clues (e.g. "30+ years in marine services").
${isLinkedInOnly
  ? `\nThis is a LinkedIn-only lead with no website data. Extract what you can from the business name and LinkedIn data. Use null for anything you cannot determine. Do NOT fabricate — partial data is fine.`
  : `\n--- RAW WEBSITE TEXT ---\n${row.all_text}\n--- END ---`}`;
        })(),
      });

      // Demote unsupported founder claims. Claude has a tendency to return
      // is_likely_founder=true with no supporting founder_evidence — which
      // propagates through scoring and inflates the funnel. If there's no
      // concrete evidence string, flip the claim to null so downstream
      // scoring treats the founder status as unknown, not confirmed.
      if (result && typeof result === "object") {
        const evidence = (result as Record<string, unknown>).founder_evidence;
        const hasEvidence = typeof evidence === "string" && evidence.trim().length > 10;
        if ((result as Record<string, unknown>).is_likely_founder === true && !hasEvidence) {
          (result as Record<string, unknown>).is_likely_founder = null;
          (result as Record<string, unknown>).founder_evidence =
            "Demoted: model claimed founder but provided no evidence string";
        }
      }

      db.prepare(
        `INSERT OR REPLACE INTO enrichment_data (lead_id, data, created_at)
         VALUES (?, ?, datetime('now'))`
      ).run(row.id, JSON.stringify(result));

      setLeadStatus(row.id, "enriched");
      counts.enriched++;
    } catch (err) {
      console.error(`[ENRICH FAIL] ${row.business_name} (id=${row.id}):`, err);
      setLeadStatus(row.id, "enrich_failed");
      counts.failed++;
    }
  }

  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((row, batchIdx) => processRow(row, i + batchIdx)));
    processed += batch.length;
    onProgress?.(processed, rows.length, batch[batch.length - 1].business_name);
  }

  return counts;
}
