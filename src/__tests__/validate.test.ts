import { describe, it, expect } from "vitest";
import {
  validateLeadForScrape,
  validateScrapedContent,
  validateEnrichmentData,
  validateScoringData,
  validateBatch,
} from "@/lib/enrichment/validate";

// ─── Lead validation (pre-scrape) ───────────────────────────────────────────

describe("validateLeadForScrape", () => {
  it("passes a fully valid lead", () => {
    const result = validateLeadForScrape({
      id: 1,
      business_name: "Tampa Bay Marina",
      website: "https://tampamarina.com",
      city: "Tampa",
      state: "FL",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when business_name is missing", () => {
    const result = validateLeadForScrape({
      id: 1,
      business_name: "",
      website: "https://example.com",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing business_name — cannot process lead without a name");
  });

  it("fails when website is missing", () => {
    const result = validateLeadForScrape({
      id: 1,
      business_name: "Test Business",
      website: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing website URL"))).toBe(true);
  });

  it("warns when URL missing protocol", () => {
    const result = validateLeadForScrape({
      id: 1,
      business_name: "Test Business",
      website: "tampamarina.com",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("missing protocol"))).toBe(true);
  });

  it("warns when no city or state", () => {
    const result = validateLeadForScrape({
      id: 1,
      business_name: "Test",
      website: "https://example.com",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("No city/state"))).toBe(true);
  });

  it("fails when id is missing", () => {
    const result = validateLeadForScrape({
      business_name: "Test",
      website: "https://example.com",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lead id"))).toBe(true);
  });
});

// ─── Scraped content validation (pre-enrichment) ────────────────────────────

describe("validateScrapedContent", () => {
  it("passes with sufficient text", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: "A".repeat(500),
      homepage_text: "something",
      about_text: "something",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when all_text is empty", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("No scraped text"))).toBe(true);
  });

  it("fails when all_text is null", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: null,
    });
    expect(result.valid).toBe(false);
  });

  it("warns when text is very short (< 50 chars)", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: "Very short page content.",
      homepage_text: "short",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("very short"))).toBe(true);
  });

  it("warns when text is moderately short (50-200 chars)", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: "A".repeat(100),
      homepage_text: "something",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("short"))).toBe(true);
  });

  it("warns when no homepage or about page text", () => {
    const result = validateScrapedContent({
      lead_id: 1,
      all_text: "A".repeat(300),
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Neither homepage nor about page"))).toBe(true);
  });
});

// ─── Enrichment data validation (pre-scoring) ──────────────────────────────

describe("validateEnrichmentData", () => {
  it("passes with complete data", () => {
    const result = validateEnrichmentData({
      business_name: "Tampa Bay Marina",
      owner_name: "John Smith",
      industry_category: "Marine Services",
      founded_year: 1985,
      business_age_years: 41,
      succession_signals: "Family-owned, no next generation mentioned",
      revenue_signals: "50+ boats serviced annually",
      unique_hooks: ["Founded by Navy veteran", "Community boat show sponsor"],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when data is null", () => {
    const result = validateEnrichmentData(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("null"))).toBe(true);
  });

  it("fails when data is not an object", () => {
    const result = validateEnrichmentData("not an object");
    expect(result.valid).toBe(false);
  });

  it("warns when owner_name is null", () => {
    const result = validateEnrichmentData({
      business_name: "Test",
      owner_name: null,
      industry_category: "Marine",
      succession_signals: "test",
      unique_hooks: ["hook"],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("owner_name not found"))).toBe(true);
  });

  it('warns when owner_name is "Unknown"', () => {
    const result = validateEnrichmentData({
      business_name: "Test",
      owner_name: "Unknown",
      industry_category: "Marine",
      succession_signals: "test",
      unique_hooks: ["hook"],
    });
    expect(result.warnings.some((w) => w.includes("owner_name not found"))).toBe(true);
  });

  it("warns on suspicious founded_year", () => {
    const result = validateEnrichmentData({
      business_name: "Test",
      owner_name: "John",
      industry_category: "Marine",
      founded_year: 2030,
      succession_signals: "test",
      unique_hooks: ["hook"],
    });
    expect(result.warnings.some((w) => w.includes("Suspicious founded_year"))).toBe(true);
  });

  it("warns when no succession or revenue signals", () => {
    const result = validateEnrichmentData({
      business_name: "Test",
      owner_name: "John",
      industry_category: "Marine",
      unique_hooks: ["hook"],
    });
    expect(result.warnings.some((w) => w.includes("No succession or revenue signals"))).toBe(true);
  });

  it("warns when unique_hooks is empty array", () => {
    const result = validateEnrichmentData({
      business_name: "Test",
      owner_name: "John",
      industry_category: "Marine",
      succession_signals: "test",
      unique_hooks: [],
    });
    expect(result.warnings.some((w) => w.includes("No unique_hooks"))).toBe(true);
  });
});

// ─── Scoring data validation (pre-outreach) ─────────────────────────────────

describe("validateScoringData", () => {
  it("passes with complete scoring data", () => {
    const result = validateScoringData({
      score: 8,
      confidence: "high",
      recommended_action: "reach_out_now",
      primary_signals: ["20+ years", "no succession plan"],
      best_angle: "Legacy business with strong community ties",
      reasoning: "Owner has been running the marina for over 20 years...",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when data is null", () => {
    const result = validateScoringData(null);
    expect(result.valid).toBe(false);
  });

  it("fails when score is missing", () => {
    const result = validateScoringData({
      confidence: "high",
      recommended_action: "reach_out_now",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing score"))).toBe(true);
  });

  it("fails when score is out of range (too high)", () => {
    const result = validateScoringData({ score: 15 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("out of range"))).toBe(true);
  });

  it("fails when score is out of range (zero)", () => {
    const result = validateScoringData({ score: 0 });
    expect(result.valid).toBe(false);
  });

  it("warns on invalid recommended_action", () => {
    const result = validateScoringData({
      score: 7,
      confidence: "high",
      recommended_action: "do_something",
      primary_signals: ["test"],
      best_angle: "test",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Invalid recommended_action"))).toBe(true);
  });

  it("warns on invalid confidence", () => {
    const result = validateScoringData({
      score: 7,
      confidence: "very_high",
      recommended_action: "reach_out_now",
      primary_signals: ["test"],
      best_angle: "test",
    });
    expect(result.warnings.some((w) => w.includes("Invalid confidence"))).toBe(true);
  });

  it("warns when best_angle is empty", () => {
    const result = validateScoringData({
      score: 7,
      confidence: "high",
      recommended_action: "reach_out_now",
      primary_signals: ["test"],
      best_angle: "",
    });
    expect(result.warnings.some((w) => w.includes("No best_angle"))).toBe(true);
  });

  it("accepts offer_booklet as a valid recommended_action", () => {
    const result = validateScoringData({
      score: 5,
      confidence: "medium",
      recommended_action: "offer_booklet",
      best_angle: "Test angle",
      primary_signals: ["founder likely"],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.filter(w => w.includes("recommended_action"))).toHaveLength(0);
  });
});

// ─── Batch validation ───────────────────────────────────────────────────────

describe("validateBatch", () => {
  it("correctly counts pass/fail across a batch", () => {
    const items = [
      { id: 1, business_name: "Good Lead", website: "https://example.com", city: "Tampa", state: "FL" },
      { id: 2, business_name: "", website: "https://example.com" }, // missing name
      { id: 3, business_name: "No Website", website: null },       // missing website
      { id: 4, business_name: "OK Lead", website: "https://ok.com", city: "Miami", state: "FL" },
    ];

    const result = validateBatch(items, validateLeadForScrape);
    expect(result.totalChecked).toBe(4);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].id).toBe(2);
    expect(result.failures[1].id).toBe(3);
  });

  it("handles an empty batch", () => {
    const result = validateBatch([], validateLeadForScrape);
    expect(result.totalChecked).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
