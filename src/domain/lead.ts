/**
 * Domain Lead Logic
 *
 * Pure functions for lead status transitions and validation.
 * No I/O — no database, no API calls.
 */

import type { EnrichmentStatus } from "./types";

// ─── Valid Status Transitions ───────────────────────────────────────────────

/**
 * Map of valid status transitions.
 * A lead can only move from one status to another if it's in this map.
 */
const VALID_TRANSITIONS: Record<EnrichmentStatus, EnrichmentStatus[]> = {
  pending:           ["scraped", "scrape_failed", "pre_filtered", "no_website"],
  scraped:           ["enriched", "enrich_failed", "icp_rejected"],
  enriched:          ["scored", "score_failed"],
  scored:            ["outreach_generated", "outreach_failed"],
  outreach_generated: [],                                   // terminal
  outreach_failed:   ["scored"],                            // can retry — reset to scored to re-queue
  scrape_failed:     ["scraped", "scrape_failed"],          // can retry
  enrich_failed:     ["enriched", "enrich_failed"],         // can retry
  score_failed:      ["scored", "score_failed"],            // can retry
  pre_filtered:      [],                                    // terminal — rule-based reject
  icp_rejected:      [],                                    // terminal — Haiku ICP reject
  no_website:        [],                                    // terminal — no website to scrape
};

/**
 * Check if a status transition is valid.
 */
export function canTransition(from: EnrichmentStatus, to: EnrichmentStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Validate a status transition. Throws if invalid.
 */
export function validateTransition(from: EnrichmentStatus, to: EnrichmentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid status transition: ${from} → ${to}. ` +
      `Allowed transitions from "${from}": [${(VALID_TRANSITIONS[from] || []).join(", ")}]`
    );
  }
}

/**
 * Get all valid next statuses for a given status.
 */
export function getNextStatuses(status: EnrichmentStatus): EnrichmentStatus[] {
  return VALID_TRANSITIONS[status] || [];
}

// ─── Status Checks ──────────────────────────────────────────────────────────

/** Check if a status represents a failure. */
export function isFailedStatus(status: EnrichmentStatus): boolean {
  return status.endsWith("_failed");
}

/** Check if a status is terminal (no further transitions). */
export function isTerminalStatus(status: EnrichmentStatus): boolean {
  const next = VALID_TRANSITIONS[status];
  return !next || next.length === 0;
}

/** Check if a lead is ready for outreach generation. */
export function isReadyForOutreach(status: EnrichmentStatus): boolean {
  return status === "scored";
}

/** Check if a lead has been through the full pipeline. */
export function isFullyProcessed(status: EnrichmentStatus): boolean {
  return status === "outreach_generated";
}

// ─── Pipeline Stage → Expected Status ───────────────────────────────────────

/**
 * Map of pipeline stage names to the enrichment status a lead
 * should be in BEFORE that stage runs.
 */
export const STAGE_PREREQUISITES: Record<string, EnrichmentStatus[]> = {
  scrape:   ["pending"],
  linkedin: ["scraped", "enriched", "scored", "outreach_generated"],
  extract:  ["scraped"],
  score:    ["enriched"],
  outreach: ["scored", "outreach_failed"],  // outreach_failed leads can be re-queued
};
