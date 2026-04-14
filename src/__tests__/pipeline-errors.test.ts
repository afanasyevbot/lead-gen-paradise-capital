import { describe, it, expect } from "vitest";
import {
  classifyError,
  createEmptyReport,
  finalizeReport,
  withErrorHandling,
} from "@/lib/enrichment/pipeline-errors";

// ─── Error classification ───────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies 429 rate limit as retryable", () => {
    const err = classifyError("enrichment_extract", new Error("429 Too Many Requests"), 1, "Tampa Marina");
    expect(err.severity).toBe("retryable");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.suggestion).toContain("Wait");
  });

  it("classifies 529 overloaded as retryable", () => {
    const err = classifyError("exit_score", new Error("529 API overloaded"));
    expect(err.severity).toBe("retryable");
    expect(err.code).toBe("API_OVERLOADED");
  });

  it("classifies invalid API key as fatal", () => {
    const err = classifyError("enrichment_extract", new Error("401 Invalid API Key"));
    expect(err.severity).toBe("fatal");
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.suggestion).toContain("ANTHROPIC_API_KEY");
  });

  it("classifies malformed JSON as retryable", () => {
    const err = classifyError("exit_score", new Error("Unexpected token N in JSON"));
    expect(err.severity).toBe("retryable");
    expect(err.code).toBe("MALFORMED_JSON");
  });

  it("classifies timeout as skippable", () => {
    const err = classifyError("website_scrape", new Error("Navigation timeout of 15000ms exceeded"), 5, "Bay Boat Sales");
    expect(err.severity).toBe("skippable");
    expect(err.code).toBe("TIMEOUT");
  });

  it("classifies CAPTCHA as retryable", () => {
    const err = classifyError("linkedin_search", new Error("Google rate limit detected (CAPTCHA)"));
    expect(err.severity).toBe("retryable");
    expect(err.code).toBe("CAPTCHA_BLOCKED");
  });

  it("classifies DNS failure as skippable", () => {
    const err = classifyError("website_scrape", new Error("net::ERR_NAME_NOT_RESOLVED"), 3, "Ghost Business");
    expect(err.severity).toBe("skippable");
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("classifies SSL error as skippable", () => {
    const err = classifyError("website_scrape", new Error("SSL certificate expired"));
    expect(err.severity).toBe("skippable");
    expect(err.code).toBe("SSL_ERROR");
  });

  it("classifies Playwright browser error as fatal", () => {
    const err = classifyError("website_scrape", new Error("Chromium revision not found"));
    expect(err.severity).toBe("fatal");
    expect(err.code).toBe("BROWSER_ERROR");
    expect(err.suggestion).toContain("playwright install");
  });

  it("classifies unknown errors as skippable", () => {
    const err = classifyError("outreach_generate", new Error("Something weird happened"));
    expect(err.severity).toBe("skippable");
    expect(err.code).toBe("UNKNOWN");
  });

  it("attaches lead metadata", () => {
    const err = classifyError("website_scrape", new Error("timeout"), 42, "Tampa Bay Marina");
    expect(err.leadId).toBe(42);
    expect(err.businessName).toBe("Tampa Bay Marina");
    expect(err.stage).toBe("website_scrape");
  });
});

// ─── Pipeline report ────────────────────────────────────────────────────────

describe("Pipeline report", () => {
  it("creates empty report with all stages", () => {
    const report = createEmptyReport();
    expect(report.stages.website_scrape.processed).toBe(0);
    expect(report.stages.linkedin_search.processed).toBe(0);
    expect(report.stages.enrichment_extract.processed).toBe(0);
    expect(report.stages.exit_score.processed).toBe(0);
    expect(report.stages.outreach_generate.processed).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.hasFatalError).toBe(false);
  });

  it("finalizes with success summary when no failures", () => {
    const report = createEmptyReport();
    report.stages.website_scrape.processed = 10;
    report.stages.website_scrape.succeeded = 10;
    const final = finalizeReport(report);
    expect(final.hasFatalError).toBe(false);
    expect(final.summary).toContain("successfully");
    expect(final.completedAt).toBeTruthy();
  });

  it("finalizes with failure summary when errors exist", () => {
    const report = createEmptyReport();
    report.stages.website_scrape.processed = 10;
    report.stages.website_scrape.succeeded = 8;
    report.stages.website_scrape.failed = 2;
    report.errors.push(
      classifyError("website_scrape", new Error("timeout"), 1, "Lead 1"),
      classifyError("website_scrape", new Error("timeout"), 2, "Lead 2"),
    );
    const final = finalizeReport(report);
    expect(final.hasFatalError).toBe(false);
    expect(final.summary).toContain("2 failures");
  });

  it("sets hasFatalError when a fatal error is present", () => {
    const report = createEmptyReport();
    report.errors.push(classifyError("enrichment_extract", new Error("401 Invalid API Key")));
    const final = finalizeReport(report);
    expect(final.hasFatalError).toBe(true);
    expect(final.summary).toContain("halted");
  });
});

// ─── withErrorHandling ──────────────────────────────────────────────────────

describe("withErrorHandling", () => {
  it("returns result on success and increments counters", async () => {
    const report = createEmptyReport();
    const result = await withErrorHandling(
      "enrichment_extract", 1, "Test Marina", report,
      async () => ({ score: 8 })
    );
    expect(result).toEqual({ score: 8 });
    expect(report.stages.enrichment_extract.succeeded).toBe(1);
    expect(report.stages.enrichment_extract.processed).toBe(1);
  });

  it("returns null on skippable error and records it", async () => {
    const report = createEmptyReport();
    const result = await withErrorHandling(
      "website_scrape", 1, "Dead Site", report,
      async () => { throw new Error("Navigation timeout"); }
    );
    expect(result).toBeNull();
    expect(report.stages.website_scrape.failed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("TIMEOUT");
  });

  it("re-throws fatal errors", async () => {
    const report = createEmptyReport();
    let threw = false;
    try {
      await withErrorHandling(
        "enrichment_extract", 1, "Test", report,
        async () => { throw new Error("401 Invalid API Key"); }
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].severity).toBe("fatal");
  });
});
