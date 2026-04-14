/**
 * Founder Signals Enrichment
 *
 * 1. Primary Founder Detection — Compares LinkedIn "Joined Company" date
 *    with "Company Founded" date. Match within 6 months = Primary Founder.
 *
 * 2. Career Math — Takes university graduation year + 22 to estimate birth year.
 *    If graduation year is before 1993, flags the lead as Age 55+.
 *
 * 3. Bio Analysis — Uses Claude to analyze a founder's bio and early career
 *    signals to estimate if they are nearing retirement age.
 *
 * All three signals are combined into a single "founder profile" that feeds
 * into the scoring and outreach modules.
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FounderProfile {
  // Founder detection
  is_primary_founder: boolean;
  founder_confidence: "confirmed" | "likely" | "possible" | "unknown";
  joined_company_date: string | null;
  company_founded_date: string | null;
  date_gap_months: number | null;

  // Career math
  estimated_graduation_year: number | null;
  estimated_birth_year: number | null;
  estimated_current_age: number | null;
  is_age_55_plus: boolean;
  age_source: "graduation" | "bio_analysis" | "career_start" | "founded_year" | null;

  // Bio analysis
  early_career_signals: string[];
  retirement_indicators: string[];
  tenure_years: number | null;
  career_stage: "early" | "mid" | "late" | "near_retirement" | "unknown";

  // Combined assessment
  exit_readiness_boost: number; // -2 to +3 adjustment to existing score
  reasoning: string;
}

// ─── 1. Primary Founder Detection ───────────────────────────────────────────

/**
 * Scrapes LinkedIn via Google to find when the owner joined their company.
 * Compares with the company founded date from enrichment data.
 * If dates match within 6 months → Primary Founder.
 */
async function detectPrimaryFounder(
  linkedinUrl: string | null,
  ownerName: string | null,
  businessName: string,
  foundedYear: number | null,
): Promise<{
  is_primary_founder: boolean;
  confidence: "confirmed" | "likely" | "possible" | "unknown";
  joined_date: string | null;
  founded_date: string | null;
  gap_months: number | null;
}> {
  const result = {
    is_primary_founder: false,
    confidence: "unknown" as "confirmed" | "likely" | "possible" | "unknown",
    joined_date: null as string | null,
    founded_date: foundedYear ? `${foundedYear}` : null,
    gap_months: null as number | null,
  };

  if (!linkedinUrl && !ownerName) return result;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Search Google for LinkedIn experience section info
    const searchName = linkedinUrl
      ? linkedinUrl.split("/in/")[1]?.replace(/-/g, " ") || ownerName || businessName
      : ownerName || businessName;

    const query = `site:linkedin.com "${searchName}" "${businessName}" experience`;
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return result;
    }

    // Extract all text from search result snippets
    const snippetText = await page.$$eval(".VwiC3b, .IsZvec, [data-sncf]", (els: Element[]) =>
      els.map((el: Element) => (el.textContent || "").trim()).join(" ")
    );

    // Look for date patterns like "Jan 2005 - Present" or "2005 - Present" or "Founded in 2003"
    const joinedMatch = snippetText.match(
      /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+)?(\d{4})\s*[-–]\s*(?:Present|present|current)/i
    );
    const foundedMatch = snippetText.match(
      /(?:Founded|Established|Started|Co-founded)\s+(?:in\s+)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+)?(\d{4})/i
    );

    if (joinedMatch) {
      result.joined_date = joinedMatch[1];
    }
    if (foundedMatch) {
      result.founded_date = result.founded_date || foundedMatch[1];
    }

    // Compare dates
    if (result.joined_date && result.founded_date) {
      const joinedYear = parseInt(result.joined_date);
      const foundedYearParsed = parseInt(result.founded_date);
      const gapMonths = Math.abs(joinedYear - foundedYearParsed) * 12;
      result.gap_months = gapMonths;

      if (gapMonths <= 6) {
        result.is_primary_founder = true;
        result.confidence = "confirmed";
      } else if (gapMonths <= 24) {
        result.is_primary_founder = true;
        result.confidence = "likely";
      } else if (gapMonths <= 60) {
        result.confidence = "possible";
      }
    } else if (result.joined_date && foundedYear) {
      // Compare with enrichment founded year
      const joinedYear = parseInt(result.joined_date);
      const gapMonths = Math.abs(joinedYear - foundedYear) * 12;
      result.gap_months = gapMonths;

      if (gapMonths <= 6) {
        result.is_primary_founder = true;
        result.confidence = "confirmed";
      } else if (gapMonths <= 24) {
        result.is_primary_founder = true;
        result.confidence = "likely";
      }
    }

    // Check for founder/owner titles in snippet
    if (!result.is_primary_founder) {
      const founderTitleMatch = snippetText.match(
        /\b(Founder|Co-Founder|Owner|Proprietor)\b/i
      );
      if (founderTitleMatch) {
        result.is_primary_founder = true;
        result.confidence = result.confidence === "unknown" ? "likely" : result.confidence;
      }
    }
  } catch { /* ignore scraping errors */ }
  finally {
    await browser.close();
  }

  return result;
}

// ─── 2. Career Math ────────────────────────────────────────────────────────

/**
 * Estimates age from education and career data:
 * - Graduation year + 22 = estimated birth year
 * - If graduation < 1993 → Age 55+
 * - If founded_year is old enough, uses that as a fallback
 */
function calculateCareerMath(
  graduationYear: number | null,
  foundedYear: number | null,
  careerStartYear: number | null,
  ownerTenureYears: number | null,
): {
  estimated_birth_year: number | null;
  estimated_current_age: number | null;
  is_age_55_plus: boolean;
  source: "graduation" | "career_start" | "founded_year" | null;
} {
  const currentYear = new Date().getFullYear();

  // Priority 1: Graduation year
  if (graduationYear && graduationYear > 1950 && graduationYear < currentYear) {
    const birthYear = graduationYear - 22; // typical age at graduation
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: graduationYear < 1993, // graduated before 1993 = born before 1971 = 55+
      source: "graduation",
    };
  }

  // Priority 2: Career start year (first job)
  if (careerStartYear && careerStartYear > 1950 && careerStartYear < currentYear) {
    const birthYear = careerStartYear - 22; // assume started career at ~22
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: age >= 55,
      source: "career_start",
    };
  }

  // Priority 3: Owner tenure from website ("has owned for X years", "since YEAR", etc.)
  // Assumes owner took over / founded at ~28 on average
  if (ownerTenureYears && ownerTenureYears > 0) {
    const startYear = currentYear - ownerTenureYears;
    const birthYear = startYear - 28;
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: age >= 55,
      source: "career_start", // close enough — tenure at this business
    };
  }

  // Priority 4: Founded year (assume age 30-35 when founding)
  if (foundedYear && foundedYear > 1950 && foundedYear < currentYear) {
    const birthYear = foundedYear - 32; // average founder age
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: age >= 55,
      source: "founded_year",
    };
  }

  return {
    estimated_birth_year: null,
    estimated_current_age: null,
    is_age_55_plus: false,
    source: null,
  };
}

// ─── 3. Bio Analysis Prompt ────────────────────────────────────────────────

const BIO_ANALYSIS_PROMPT = `You are an M&A analyst estimating a business owner's career stage and potential proximity to retirement. You are analyzing their bio, LinkedIn data, and any available career signals.

YOUR TASK:
Analyze the provided information and extract:
1. Early career signals — specific dates, companies, or roles that help estimate age
2. Retirement indicators — language or patterns suggesting they're thinking about the next chapter
3. Estimated career stage

EARLY CAREER SIGNALS TO LOOK FOR:
- "Started at [Company] in [year]" — subtract 22-25 from year for birth estimate
- "Founded first company in [decade]" — the 80s = likely 60+, the 90s = likely 50+
- "30 years of experience" / "over X years in [industry]" — add to typical career start age (22) for age estimate
- "Has owned/operated/led [Business] for X years" or "since [YEAR]" — strong tenure signal
- "Celebrating X years in business" — if personal founding story, use as tenure
- "Since [YEAR]" phrases on About pages — calculate years from current year (2026)
- Military service dates — if served in Vietnam/Gulf War, age indicator
- "Class of [year]" or graduation mentions
- References to technologies or eras ("when I started, we used [old tech]")
- Professional license years ("Licensed since 1988")
- "Been in [industry] for X years" — career tenure signal even without founding date

RETIREMENT INDICATORS:
- "Thinking about my legacy" or "what I've built"
- Mentions of grandchildren
- Board positions replacing operational roles
- Reduced involvement language ("my team handles...")
- "Giving back" or philanthropy focus
- No growth language (no "expanding" or "launching")
- Reference to health, slowing down, or "next chapter"

Return ONLY valid JSON:
{
  "early_career_signals": ["string — each specific signal found with the year/date"],
  "retirement_indicators": ["string — each retirement indicator found"],
  "estimated_career_start_year": integer or null,
  "estimated_graduation_year": integer or null,
  "tenure_at_current_company_years": integer or null,
  "career_stage": "early" | "mid" | "late" | "near_retirement" | "unknown",
  "exit_readiness_boost": integer from -2 to +3,
  "reasoning": "string — 2-3 sentences explaining your assessment"
}

SCORING ADJUSTMENT (exit_readiness_boost):
+3: Multiple strong retirement signals, career clearly winding down
+2: Owner is 60+, long tenure, some succession language
+1: Owner is 55+, showing fatigue or legacy focus
 0: Insufficient data or mixed signals
-1: Owner actively growing, clearly mid-career
-2: Owner recently took over or is clearly young/energetic`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export async function analyzeFounderSignals(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ analyzed: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS founder_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      is_primary_founder INTEGER DEFAULT 0,
      founder_confidence TEXT,
      is_age_55_plus INTEGER DEFAULT 0,
      estimated_age INTEGER,
      career_stage TEXT,
      exit_readiness_boost INTEGER DEFAULT 0,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare(`
    SELECT l.id, l.business_name,
           ed.data as enrichment_json,
           ld.linkedin_url, ld.owner_name_from_linkedin, ld.owner_title_from_linkedin, ld.linkedin_headline,
           ss.linkedin_about,
           sc.all_text
    FROM leads l
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
    LEFT JOIN social_signals ss ON ss.lead_id = l.id
    LEFT JOIN scraped_content sc ON sc.lead_id = l.id
    LEFT JOIN founder_profiles fp ON fp.lead_id = l.id
    WHERE fp.id IS NULL
      AND l.enrichment_status NOT IN ('pending', 'scrape_failed')
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    enrichment_json: string | null;
    linkedin_url: string | null;
    owner_name_from_linkedin: string | null;
    owner_title_from_linkedin: string | null;
    linkedin_headline: string | null;
    linkedin_about: string | null;
    all_text: string | null;
  }[];

  const counts = { analyzed: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const ownerName = enrichment.owner_name || row.owner_name_from_linkedin || null;
    const foundedYear = enrichment.founded_year || null;

    try {
      // Step 1: Detect primary founder via LinkedIn dates
      const founderResult = await detectPrimaryFounder(
        row.linkedin_url,
        ownerName,
        row.business_name,
        foundedYear,
      );

      await new Promise((r) => setTimeout(r, 3000));

      // Step 2: Run bio analysis via Claude
      const bioContext = [
        row.linkedin_about ? `LinkedIn About: ${row.linkedin_about}` : "",
        row.linkedin_headline ? `LinkedIn Headline: ${row.linkedin_headline}` : "",
        row.owner_title_from_linkedin ? `LinkedIn Title: ${row.owner_title_from_linkedin}` : "",
        enrichment.owner_personal_details ? `Personal Details: ${enrichment.owner_personal_details}` : "",
        enrichment.succession_signals ? `Succession Signals: ${enrichment.succession_signals}` : "",
        enrichment.stagnation_signals ? `Stagnation Signals: ${enrichment.stagnation_signals}` : "",
        row.all_text ? `Website Text (first 2000 chars): ${row.all_text.slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n\n");

      if (!bioContext || bioContext.length < 50) {
        counts.skipped++;
        continue;
      }

      const bioAnalysis = await callAnthropicWithRetry<{
        early_career_signals: string[];
        retirement_indicators: string[];
        estimated_career_start_year: number | null;
        estimated_graduation_year: number | null;
        tenure_at_current_company_years: number | null;
        career_stage: string;
        exit_readiness_boost: number;
        reasoning: string;
      }>({
        client,
        maxTokens: 1000,
        system: BIO_ANALYSIS_PROMPT,
        userContent: `Analyze this business owner's career signals.

LEAD:
Business: ${row.business_name}
Owner: ${ownerName || "Unknown"}
Industry: ${enrichment.industry_category || "Unknown"}
Founded: ${foundedYear || "Unknown"}
Business Age: ${enrichment.business_age_years || "Unknown"} years

AVAILABLE DATA:
${bioContext}`,
      });

      // Step 3: Calculate career math
      // Prefer enrichment owner_tenure_years (from website "since YEAR" / "X years" parsing),
      // fall back to Claude's bio-extracted tenure if enrichment didn't catch it.
      const ownerTenureYears: number | null =
        enrichment.owner_tenure_years ??
        bioAnalysis.tenure_at_current_company_years ??
        null;

      const careerMath = calculateCareerMath(
        bioAnalysis.estimated_graduation_year,
        foundedYear,
        bioAnalysis.estimated_career_start_year,
        ownerTenureYears,
      );

      // Step 4: Assemble founder profile
      const profile: FounderProfile = {
        is_primary_founder: founderResult.is_primary_founder,
        founder_confidence: founderResult.confidence,
        joined_company_date: founderResult.joined_date,
        company_founded_date: founderResult.founded_date,
        date_gap_months: founderResult.gap_months,

        estimated_graduation_year: bioAnalysis.estimated_graduation_year,
        estimated_birth_year: careerMath.estimated_birth_year,
        estimated_current_age: careerMath.estimated_current_age,
        is_age_55_plus: careerMath.is_age_55_plus,
        age_source: careerMath.source,

        early_career_signals: bioAnalysis.early_career_signals || [],
        retirement_indicators: bioAnalysis.retirement_indicators || [],
        tenure_years: bioAnalysis.tenure_at_current_company_years,
        career_stage: (bioAnalysis.career_stage as FounderProfile["career_stage"]) || "unknown",

        exit_readiness_boost: bioAnalysis.exit_readiness_boost || 0,
        reasoning: bioAnalysis.reasoning || "",
      };

      db.prepare(`
        INSERT OR REPLACE INTO founder_profiles
        (lead_id, is_primary_founder, founder_confidence, is_age_55_plus,
         estimated_age, career_stage, exit_readiness_boost, profile_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        profile.is_primary_founder ? 1 : 0,
        profile.founder_confidence,
        profile.is_age_55_plus ? 1 : 0,
        profile.estimated_current_age,
        profile.career_stage,
        profile.exit_readiness_boost,
        JSON.stringify(profile),
      );

      counts.analyzed++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
