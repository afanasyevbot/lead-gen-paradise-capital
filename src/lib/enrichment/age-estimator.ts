/**
 * Deterministic age estimator from LinkedIn profile data.
 *
 * Used by both extract.ts and score.ts so Claude receives a pre-calculated
 * age estimate rather than being asked to infer it from raw dates.
 *
 * Strategy (in priority order):
 *   1. Founder/Owner role start year  →  assumed 25-42 at founding
 *   2. Earliest career role start     →  assumed 22 at first job
 *   3. College graduation year        →  assumed 22 at graduation
 */

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Parse a year from a LinkedIn duration string like:
 *   "Sep 1996 - Present · 29 yrs 8 mos"
 *   "Jan 2003 - Dec 2015"
 *   "2001 - Present"
 * Returns the start (first) year found, or null.
 */
function parseStartYearFromDuration(duration: string): number | null {
  if (!duration) return null;
  const matches = duration.match(/\b(19[4-9]\d|20[0-2]\d)\b/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[0], 10);
}

/**
 * Parse a graduation year from a LinkedIn education years string like:
 *   "2005 - 2009"  →  2009
 *   "1988 - 1992"  →  1992
 * Returns the later (end) year, or null.
 */
function parseGradYear(years: string): number | null {
  if (!years) return null;
  const matches = years.match(/\b(19[4-9]\d|20[0-2]\d)\b/g);
  if (!matches || matches.length < 2) return null;
  return Math.max(...matches.map((y) => parseInt(y, 10)));
}

export interface AgeEstimate {
  estimated_age: number | null;
  age_range: string | null;
  confidence: "high" | "medium" | "low";
  method: string;
}

/**
 * Calculate a concrete age estimate from LinkedIn experience + education.
 * Returns an AgeEstimate with null values if no usable data is found.
 */
export function estimateAgeFromLinkedIn(
  experience: Array<{ title: string; company: string; duration: string }>,
  education: Array<{ school: string; degree: string; years: string }>,
): AgeEstimate {
  const empty: AgeEstimate = { estimated_age: null, age_range: null, confidence: "low", method: "No LinkedIn data" };

  // ── Method 1: Founder/Owner role start year ───────────────────────────────
  // If this person has been "Owner" or "Founder" since 1996, they likely
  // started that role in their late 20s–early 40s. We assume median age 32.
  const founderKeywords = /founder|owner|president|ceo|principal|partner|proprietor/i;
  for (const exp of experience) {
    if (!founderKeywords.test(exp.title)) continue;
    const startYear = parseStartYearFromDuration(exp.duration);
    if (!startYear) continue;

    const yearsAgo = CURRENT_YEAR - startYear;
    // Plausible age range at founding: 25 (young founder) to 42 (career-switcher)
    const lowAge = yearsAgo + 25;
    const midAge = yearsAgo + 32;  // median assumption
    const highAge = yearsAgo + 42;

    return {
      estimated_age: midAge,
      age_range: `${lowAge}-${highAge}`,
      confidence: yearsAgo >= 15 ? "high" : "medium",
      method: `"${exp.title}" role started ${startYear} (${yearsAgo} yrs ago) — assumed founded at age 25-42, median 32`,
    };
  }

  // ── Method 2: Earliest career role (any title) ────────────────────────────
  // First job = entered workforce ≈ age 22
  let earliestYear: number | null = null;
  for (const exp of experience) {
    const startYear = parseStartYearFromDuration(exp.duration);
    if (startYear && (!earliestYear || startYear < earliestYear)) {
      earliestYear = startYear;
    }
  }
  if (earliestYear) {
    const yearsAgo = CURRENT_YEAR - earliestYear;
    const estimatedAge = yearsAgo + 22;
    return {
      estimated_age: estimatedAge,
      age_range: `${estimatedAge - 5}-${estimatedAge + 5}`,
      confidence: "medium",
      method: `Earliest career role started ${earliestYear} — assumed entered workforce at age 22`,
    };
  }

  // ── Method 3: College graduation year ─────────────────────────────────────
  // Grad year + assumed 22 at graduation
  for (const edu of education) {
    const gradYear = parseGradYear(edu.years);
    if (!gradYear) continue;

    const yearsAgo = CURRENT_YEAR - gradYear;
    const estimatedAge = yearsAgo + 22;
    return {
      estimated_age: estimatedAge,
      age_range: `${estimatedAge - 3}-${estimatedAge + 3}`,
      confidence: "medium",
      method: `Graduated ${edu.school || "college"} in ${gradYear} — assumed graduated at age 22`,
    };
  }

  return empty;
}

/**
 * Format an AgeEstimate as a prompt block to inject into Claude's context.
 * Returns an empty string if no estimate is available.
 */
export function formatAgeEstimateBlock(estimate: AgeEstimate): string {
  if (!estimate.estimated_age) return "";
  return `
⚠️ PRE-CALCULATED AGE ESTIMATE (use this — do not override with a lower-confidence guess):
Estimated age: ~${estimate.estimated_age} years old
Age range: ${estimate.age_range}
Confidence: ${estimate.confidence}
How calculated: ${estimate.method}
→ Set estimated_owner_age_range to "${estimate.age_range}" and owner_age_confidence to "${estimate.confidence}".`;
}
