/**
 * Schema validation for lead data at each pipeline stage.
 * Validates data BEFORE it enters the enrichment engine to catch
 * malformed, missing, or null data early — preventing wasted API calls.
 */

import type {
  ValidationResult,
  BatchValidationResult,
  EnrichmentData,
  ScoringData,
} from "@/domain/types";

// Re-export domain types for backward compatibility
export type { EnrichmentData, ScoringData, BatchValidationResult } from "@/domain/types";

// ─── Lead validation (before website scrape) ────────────────────────────────

// LeadValidationResult is an alias for the domain ValidationResult
export type LeadValidationResult = ValidationResult;

export function validateLeadForScrape(lead: Record<string, unknown>): LeadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!lead.id || typeof lead.id !== "number") {
    errors.push("Missing or invalid lead id");
  }

  if (!lead.business_name || typeof lead.business_name !== "string" || lead.business_name.trim() === "") {
    errors.push("Missing business_name — cannot process lead without a name");
  }

  if (!lead.website || typeof lead.website !== "string" || lead.website.trim() === "") {
    errors.push("Missing website URL — cannot scrape without a website");
  } else {
    // Basic URL validation
    const url = lead.website as string;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      warnings.push(`Website URL "${url}" missing protocol — will prepend https://`);
    }
  }

  if (!lead.city && !lead.state) {
    warnings.push("No city/state — location-based enrichment will be limited");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Scraped content validation (before enrichment extract) ─────────────────

export function validateScrapedContent(content: Record<string, unknown>): LeadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content.lead_id || typeof content.lead_id !== "number") {
    errors.push("Missing lead_id on scraped content");
  }

  const allText = content.all_text as string | null | undefined;

  if (!allText || typeof allText !== "string" || allText.trim() === "") {
    errors.push("No scraped text — enrichment will have nothing to analyze");
  } else if (allText.trim().length < 50) {
    warnings.push(`Scraped text very short (${allText.trim().length} chars) — enrichment quality will be low`);
  } else if (allText.trim().length < 200) {
    warnings.push(`Scraped text is short (${allText.trim().length} chars) — some fields may be null`);
  }

  if (!content.homepage_text && !content.about_text) {
    warnings.push("Neither homepage nor about page text found — limited extraction possible");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Enrichment data validation (before scoring) ────────────────────────────

// EnrichmentData is imported from @/domain/types

export function validateEnrichmentData(data: unknown): LeadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Enrichment data is null or not an object");
    return { valid: false, errors, warnings };
  }

  const d = data as EnrichmentData;

  if (!d.business_name || typeof d.business_name !== "string") {
    warnings.push("business_name missing from enrichment — scoring may be inaccurate");
  }

  if (!d.owner_name || d.owner_name === "null" || d.owner_name === "Unknown") {
    warnings.push("owner_name not found — outreach will use generic greeting");
  }

  if (!d.industry_category || d.industry_category === "Unknown") {
    warnings.push("industry_category unknown — industry-specific scoring disabled");
  }

  if (d.founded_year && typeof d.founded_year === "number") {
    const currentYear = new Date().getFullYear();
    if (d.founded_year < 1800 || d.founded_year > currentYear) {
      warnings.push(`Suspicious founded_year: ${d.founded_year}`);
    }
  }

  if (d.business_age_years && typeof d.business_age_years === "number") {
    if (d.business_age_years < 0 || d.business_age_years > 200) {
      warnings.push(`Suspicious business_age: ${d.business_age_years} years`);
    }
  }

  if (!d.succession_signals && !d.revenue_signals) {
    warnings.push("No succession or revenue signals — exit-readiness score will be low");
  }

  if (!d.unique_hooks || !Array.isArray(d.unique_hooks) || d.unique_hooks.length === 0) {
    warnings.push("No unique_hooks — outreach personalization will be generic");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Scoring data validation (before outreach) ──────────────────────────────

// ScoringData is imported from @/domain/types

export function validateScoringData(data: unknown): LeadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Scoring data is null or not an object");
    return { valid: false, errors, warnings };
  }

  const d = data as ScoringData;

  if (d.score == null || typeof d.score !== "number") {
    errors.push("Missing score — cannot determine outreach eligibility");
  } else if (d.score < 1 || d.score > 10) {
    errors.push(`Score out of range: ${d.score} (must be 1-10)`);
  }

  const validActions = ["reach_out_now", "reach_out_warm", "offer_booklet", "monitor", "skip"];
  if (!d.recommended_action || !validActions.includes(d.recommended_action)) {
    warnings.push(`Invalid recommended_action: "${d.recommended_action}" — defaulting to "monitor"`);
  }

  const validConfidence = ["high", "medium", "low"];
  if (!d.confidence || !validConfidence.includes(d.confidence)) {
    warnings.push(`Invalid confidence: "${d.confidence}"`);
  }

  if (!d.best_angle || typeof d.best_angle !== "string" || d.best_angle.trim() === "") {
    warnings.push("No best_angle — outreach will use generic opener");
  }

  if (!d.primary_signals || !Array.isArray(d.primary_signals) || d.primary_signals.length === 0) {
    warnings.push("No primary_signals — outreach context will be limited");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Batch validation helper ────────────────────────────────────────────────

// BatchValidationResult is imported from @/domain/types

export function validateBatch(
  items: Record<string, unknown>[],
  validator: (item: Record<string, unknown>) => LeadValidationResult,
): BatchValidationResult {
  const result: BatchValidationResult = {
    totalChecked: items.length,
    passed: 0,
    failed: 0,
    withWarnings: 0,
    failures: [],
  };

  for (const item of items) {
    const v = validator(item);
    if (v.valid) {
      result.passed++;
      if (v.warnings.length > 0) result.withWarnings++;
    } else {
      result.failed++;
      result.failures.push({ id: item.id ?? item.lead_id ?? "unknown", errors: v.errors });
    }
  }

  return result;
}
