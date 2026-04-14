/**
 * Pipeline Stage Presets
 *
 * Pre-composed stage arrays for the different pipeline modes.
 * API routes import these instead of composing stages manually.
 */

import type { PipelineStage } from "../stage.interface";

// Cost-optimization stages (00, 00b)
import { preFilterStage } from "./00-prefilter";
import { icpScreenStage } from "./00b-icp-screen";

// Core stages (1-6)
import { scrapeStage } from "./01-scrape";
import { linkedinStage } from "./02-linkedin";
import { extractStage } from "./03-extract";
import { emailFinderStage } from "./04-email-finder";
import { scoreStage } from "./05-score";
import { outreachStage } from "./06-outreach";

// Deep enrichment stages (7-10)
import { socialSignalsStage } from "./07-social-signals";
import { contentHooksStage } from "./08-content-hooks";
import { socialIntrosStage } from "./09-social-intros";
import { hookExtractorStage } from "./10-hook-extractor";

// Founder analysis stages (11-13)
import { founderSignalsStage } from "./11-founder-signals";
import { successionNewsStage } from "./12-succession-news";
import { legacyOutreachStage } from "./13-legacy-outreach";

// Premium chained output stages (14-15)
import { successionAuditStage } from "./14-succession-audit";
import { tenureLegacyEmailStage } from "./15-tenure-legacy-email";

// LinkedIn deep profile visit (16) — requires session cookie
import { linkedinProfileStage } from "./16-linkedin-profile";

// Re-export individual stages for custom composition
export {
  preFilterStage,
  icpScreenStage,
  scrapeStage,
  linkedinStage,
  extractStage,
  emailFinderStage,
  scoreStage,
  outreachStage,
  socialSignalsStage,
  contentHooksStage,
  socialIntrosStage,
  hookExtractorStage,
  founderSignalsStage,
  successionNewsStage,
  legacyOutreachStage,
  successionAuditStage,
  tenureLegacyEmailStage,
  linkedinProfileStage,
};

// ─── Preset Compositions ────────────────────────────────────────────────────

/**
 * Core 6-stage pipeline (matches /api/pipeline).
 * Scrape → LinkedIn → Extract → Score → Email Finder (5+) → Outreach
 * Score runs before email finding so we only burn API credits on leads scoring 5+.
 */
export const CORE_STAGES: PipelineStage[] = [
  scrapeStage,
  linkedinStage,
  extractStage,
  scoreStage,
  emailFinderStage,
  outreachStage,
];

/**
 * Enrich-only stages (matches /api/enrich-only).
 * Extract → Score → Email Finder (5+) → Outreach (skips scraping + LinkedIn)
 */
export const ENRICH_ONLY_STAGES: PipelineStage[] = [
  extractStage,
  scoreStage,
  emailFinderStage,
  outreachStage,
];

/**
 * Score + Outreach only (matches /api/score-outreach).
 * For CSV-imported leads that already have enrichment data (e.g. Apollo exports).
 * Skips scraping and extraction — just scores, finds emails, and writes outreach.
 */
export const SCORE_OUTREACH_STAGES: PipelineStage[] = [
  scoreStage,
  emailFinderStage,
  outreachStage,
];

/**
 * Deep enrichment stages (matches /api/deep-enrich).
 * Social Signals → Content Hooks → Social Intros → Hook Extractor
 */
export const DEEP_ENRICH_STAGES: PipelineStage[] = [
  socialSignalsStage,
  contentHooksStage,
  socialIntrosStage,
  hookExtractorStage,
];

/**
 * Founder analysis stages (matches /api/founder-analysis).
 * Founder Signals → Succession News → Legacy Outreach
 */
export const FOUNDER_ANALYSIS_STAGES: PipelineStage[] = [
  founderSignalsStage,
  successionNewsStage,
  legacyOutreachStage,
];

/**
 * Full 15-stage pipeline (matches /api/full-pipeline).
 * Core → Deep Enrichment → Founder Analysis → Premium Chained Output
 */
export const FULL_PIPELINE_STAGES: PipelineStage[] = [
  // Core (1-6)
  scrapeStage,
  linkedinStage,
  extractStage,
  scoreStage,
  emailFinderStage,
  outreachStage,
  // LinkedIn deep profile visit (16) — runs after scoring, only on 6+ leads
  linkedinProfileStage,
  // Deep enrichment (7-10)
  socialSignalsStage,
  contentHooksStage,
  socialIntrosStage,
  hookExtractorStage,
  // Founder analysis (11-13)
  founderSignalsStage,
  successionNewsStage,
  legacyOutreachStage,
  // Premium chained output (14-15)
  successionAuditStage,
  tenureLegacyEmailStage,
];

/**
 * Cost-Aware Pipeline — target ~$0.01/lead average
 *
 * Stage order optimized to eliminate bad leads before expensive calls:
 *   00. Pre-filter (free)     — rule-based: chains, micro-biz, wrong industry
 *   01. Scrape websites (free) — Playwright, no API cost
 *   00b. ICP Screen (Haiku ~$0.0006/lead) — yes/no before expensive extraction
 *   03. Extract (Haiku ~$0.006/lead)      — structured data, gated on ICP pass
 *   05. Score (Haiku ~$0.004/lead)        — exit-readiness, all extracted leads
 *   04. Email Find (waterfall, mostly free) — only leads scoring 4+
 *   06. Outreach (Sonnet ~$0.024/lead)    — only leads scoring 7+ (minScore gate)
 *
 * Estimated cost breakdown per 100 raw leads:
 *   - ~30% eliminated free by pre-filter
 *   - ~40% of remainder eliminated by Haiku ICP screen ($0.04 total)
 *   - ~42 leads reach extraction ($0.25)
 *   - ~25 leads score 4+ reach email finding (~$0.15)
 *   - ~12 leads score 7+ reach Sonnet outreach ($0.29)
 *   Total ≈ $0.73 / 100 leads = ~$0.007/lead
 */
export const COST_AWARE_STAGES: PipelineStage[] = [
  preFilterStage,       // free — eliminate rejects before any scraping
  scrapeStage,          // free — Playwright
  linkedinStage,        // free — Google X-Ray for LinkedIn URL + owner name
  icpScreenStage,       // Haiku — ICP yes/no
  extractStage,         // Haiku — structured extraction (ICP-confirmed only)
  scoreStage,           // Haiku — exit-readiness score
  emailFinderStage,     // waterfall — only picks up leads with status scored+
  linkedinProfileStage, // free — visit actual profile (only 6+ scored leads, requires cookie)
  outreachStage,        // Sonnet — only leads scoring >= minScore (default 7)
];
