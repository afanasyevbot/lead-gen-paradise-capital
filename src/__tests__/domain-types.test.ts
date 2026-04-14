/**
 * Tests for domain types — verifying type guard behavior and
 * that re-exports from existing modules still resolve.
 */
import { describe, it, expect } from "vitest";
import type {
  EnrichmentStatus,
  RecommendedAction,
  OutreachTier,
  FormatStyle,
  Lead,
  LeadFilters,
  JobProgress,
  Job,
  InstantlyCampaign,
  InstantlyLead,
  PushResult,
  FactCheckResult,
  ValidationResult,
  BatchValidationResult,
  EnrichmentData,
  ScoringData,
  ProgressCallback,
} from "@/domain/types";

// Also verify backward-compatible re-exports from original modules
import type { Lead as DbLead, LeadFilters as DbLeadFilters } from "@/lib/db";
import type { LeadValidationResult, EnrichmentData as ValidateEnrichmentData } from "@/lib/enrichment/validate";
import type { FactCheckResult as FactCheckReExport } from "@/lib/enrichment/fact-check";

describe("domain/types", () => {
  it("EnrichmentStatus covers all pipeline states", () => {
    const statuses: EnrichmentStatus[] = [
      "pending", "scraped", "enriched", "scored",
      "outreach_generated", "scrape_failed", "enrich_failed", "score_failed",
    ];
    expect(statuses).toHaveLength(8);
  });

  it("RecommendedAction covers all actions", () => {
    const actions: RecommendedAction[] = [
      "reach_out_now", "reach_out_warm", "offer_booklet", "monitor", "skip",
    ];
    expect(actions).toHaveLength(5);
  });

  it("OutreachTier covers all tiers", () => {
    const tiers: OutreachTier[] = ["legacy", "seed_planter", "awareness"];
    expect(tiers).toHaveLength(3);
  });

  it("FormatStyle covers all styles", () => {
    const styles: FormatStyle[] = [
      "standard", "ultra_short", "question_only", "story_lead", "book_excerpt",
    ];
    expect(styles).toHaveLength(5);
  });

  it("Lead interface is assignable", () => {
    const lead: Lead = {
      id: 1,
      place_id: "test-place",
      business_name: "Test Biz",
      address: null,
      city: "Dallas",
      state: "TX",
      zip_code: null,
      phone: null,
      website: "https://test.com",
      google_rating: 4.5,
      review_count: 100,
      business_types: null,
      latitude: null,
      longitude: null,
      source: "google_maps",
      search_query: null,
      search_location: null,
      is_chain: 0,
      high_review_flag: 0,
      no_website_flag: 0,
      scraped_at: "2024-01-01",
      enrichment_status: "pending",
      raw_data: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    };
    expect(lead.id).toBe(1);
  });

  it("re-exported Lead from db.ts matches domain Lead", () => {
    // TypeScript ensures these types are compatible at compile time.
    // This test just verifies the re-export path works at runtime.
    const lead: DbLead = {
      id: 1,
      place_id: "test",
      business_name: "Test",
      address: null,
      city: null,
      state: null,
      zip_code: null,
      phone: null,
      website: null,
      google_rating: null,
      review_count: null,
      business_types: null,
      latitude: null,
      longitude: null,
      source: "google_maps",
      search_query: null,
      search_location: null,
      is_chain: 0,
      high_review_flag: 0,
      no_website_flag: 0,
      scraped_at: "2024-01-01",
      enrichment_status: "pending",
      raw_data: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    };
    // DbLead and Lead should be the same type
    const domainLead: Lead = lead;
    expect(domainLead.business_name).toBe("Test");
  });

  it("ValidationResult matches LeadValidationResult re-export", () => {
    const result: LeadValidationResult = {
      valid: true,
      errors: [],
      warnings: ["test warning"],
    };
    const domainResult: ValidationResult = result;
    expect(domainResult.valid).toBe(true);
  });

  it("FactCheckResult is re-exported from fact-check module", () => {
    const result: FactCheckReExport = {
      all_claims_verified: true,
      claims: [{ claim: "test", found_in_source: true, source_text: "test data" }],
      unverified_claims: [],
      risk_level: "safe",
    };
    const domainResult: FactCheckResult = result;
    expect(domainResult.risk_level).toBe("safe");
  });

  it("Job interface is structurally valid", () => {
    const job: Job = {
      id: "pipeline-123-abc",
      type: "pipeline",
      status: "running",
      progress: { current: 0, total: 6, stage: "starting", currentItem: "" },
      startedAt: new Date().toISOString(),
    };
    expect(job.status).toBe("running");
  });

  it("ScoringData includes requires_manual_review", () => {
    const scoring: ScoringData = {
      score: 8,
      confidence: "high",
      recommended_action: "reach_out_now",
      requires_manual_review: true,
      review_reason: "Founder status inferred from name match only",
    };
    expect(scoring.requires_manual_review).toBe(true);
  });

  it("EnrichmentData includes all extraction fields", () => {
    const data: EnrichmentData = {
      business_name: "Test Plumbing",
      owner_name: "John Test",
      is_likely_founder: true,
      founder_evidence: "About page says 'John founded Test Plumbing in 1992'",
      founded_year: 1992,
      faith_signals: "Church involvement mentioned",
      unique_hooks: ["Founded 30+ years ago", "Active in local church"],
    };
    expect(data.is_likely_founder).toBe(true);
    expect(data.unique_hooks).toHaveLength(2);
  });
});
