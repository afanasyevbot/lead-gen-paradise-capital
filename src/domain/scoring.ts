/**
 * Domain Scoring Logic
 *
 * Pure functions for score-to-tier mapping, action determination,
 * and review logic. No I/O — no database, no API calls.
 *
 * These rules are the single source of truth for how scores
 * translate into actions and tiers across the entire system.
 */

import type { OutreachTier, RecommendedAction, Confidence } from "./types";

// ─── Score → Tier ───────────────────────────────────────────────────────────

/**
 * Map a numeric score to an outreach tier.
 *
 * - 8-10: Legacy (confirmed founder, 60+, high confidence)
 * - 5-7:  Seed Planter (founder likely, age/revenue uncertain)
 * - 1-4:  Awareness (possible match, low confidence)
 */
export function scoreToTier(score: number): OutreachTier {
  if (score >= 8) return "legacy";
  if (score >= 5) return "seed_planter";
  return "awareness";
}

// ─── Score → Action ─────────────────────────────────────────────────────────

/**
 * Determine the recommended action based on score and confidence.
 *
 * This mirrors the RECOMMENDED ACTION GUIDE in the scoring prompt
 * but can be used without an AI call for rule-based decisions.
 */
export function scoreToAction(score: number, confidence: Confidence): RecommendedAction {
  if (score >= 7 && confidence !== "low") return "reach_out_now";
  if (score >= 5) return "reach_out_warm";
  if (score >= 4) return "offer_booklet";
  if (score >= 3) return "monitor";
  return "skip";
}

// ─── Manual Review ──────────────────────────────────────────────────────────

/**
 * Determine if a lead requires Paul's manual review before outreach.
 *
 * Rules:
 * - Score 7+ with low confidence → review (high-impact, uncertain data)
 * - Founder status uncertain on a score 5+ → review
 * - Age confidence low on a score that would change tier → review
 */
export function requiresManualReview(
  score: number,
  confidence: Confidence,
  founderConfirmed: boolean,
): boolean {
  // High-scoring leads with low confidence should be verified
  if (score >= 7 && confidence === "low") return true;

  // Founders aren't confirmed but score is in outreach range
  if (score >= 5 && !founderConfirmed) return true;

  return false;
}

// ─── High Value Check ───────────────────────────────────────────────────────

/**
 * Quick check: is this lead worth immediate attention?
 * Score 7+ with medium or high confidence = Paul should look at this today.
 */
export function isHighValueLead(score: number, confidence: Confidence): boolean {
  return score >= 7 && confidence !== "low";
}

// ─── Format Style Rotation ──────────────────────────────────────────────────

const FORMAT_STYLES = ["standard", "ultra_short", "question_only", "story_lead", "book_excerpt"] as const;

/**
 * Get the format style for a given index.
 * Rotates through the 5 styles to avoid AI-pattern recognition.
 */
export function getFormatStyle(index: number): typeof FORMAT_STYLES[number] {
  return FORMAT_STYLES[index % FORMAT_STYLES.length];
}
