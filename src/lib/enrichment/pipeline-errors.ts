/**
 * Pipeline failure point identification and graceful error handling.
 *
 * This module documents every failure point in the 5-stage enrichment pipeline
 * and provides structured error handling for each one.
 *
 * PIPELINE STAGES AND FAILURE POINTS:
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ Stage 1: Website Scrape                                         │
 * │ ├── Playwright launch failure (Chromium not installed/OOM)       │
 * │ ├── Navigation timeout (site down, DNS failure, slow load)       │
 * │ ├── Blocked by anti-bot (Cloudflare, reCAPTCHA)                 │
 * │ ├── Empty page content (SPA not rendering, JS-only site)        │
 * │ └── SSL/TLS errors (expired cert, self-signed)                  │
 * │                                                                  │
 * │ Stage 2: LinkedIn Search                                         │
 * │ ├── Google CAPTCHA / rate limit (too many searches)              │
 * │ ├── No LinkedIn results (owner not on LinkedIn)                  │
 * │ ├── Wrong person matched (common name ambiguity)                 │
 * │ └── Playwright timeout on Google search page                     │
 * │                                                                  │
 * │ Stage 3: Enrichment Extract (Anthropic API)                      │
 * │ ├── Rate limit 429 (too many requests)                           │
 * │ ├── API overloaded 529 (Anthropic capacity)                      │
 * │ ├── Invalid API key 401 (expired/wrong key)                      │
 * │ ├── Malformed JSON response (model didn't follow schema)         │
 * │ ├── Content too long (website text exceeds context window)        │
 * │ ├── Empty/null extraction (not enough data on page)              │
 * │ └── Network timeout (connection to Anthropic dropped)            │
 * │                                                                  │
 * │ Stage 4: Exit-Readiness Score (Anthropic API)                    │
 * │ ├── Rate limit 429                                               │
 * │ ├── API overloaded 529                                           │
 * │ ├── Malformed JSON (score not an integer, missing fields)        │
 * │ ├── Score out of range (not 1-10)                                │
 * │ └── Missing enrichment data (stage 3 failed for this lead)       │
 * │                                                                  │
 * │ Stage 5: Outreach Generation (Anthropic API)                     │
 * │ ├── Rate limit 429                                               │
 * │ ├── API overloaded 529                                           │
 * │ ├── Malformed JSON (email body missing, subject too long)        │
 * │ ├── No qualifying leads (all scores below threshold)             │
 * │ └── Follow-up generation failure (non-critical)                  │
 * └──────────────────────────────────────────────────────────────────┘
 */

// ─── Error classification ───────────────────────────────────────────────────

export type PipelineStage =
  | "website_scrape"
  | "linkedin_search"
  | "enrichment_extract"
  | "exit_score"
  | "outreach_generate";

export type ErrorSeverity = "fatal" | "retryable" | "skippable" | "warning";

export interface PipelineError {
  stage: PipelineStage;
  severity: ErrorSeverity;
  code: string;
  message: string;
  leadId?: number;
  businessName?: string;
  originalError?: string;
  suggestion: string;
}

// ─── Error factory functions ────────────────────────────────────────────────

export function classifyError(
  stage: PipelineStage,
  error: unknown,
  leadId?: number,
  businessName?: string,
): PipelineError {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStr = errMsg.toLowerCase();

  // ── Check CAPTCHA before generic rate limit (CAPTCHA message contains "rate limit") ──
  if (errStr.includes("captcha") || errStr.includes("unusual traffic")) {
    return {
      stage,
      severity: "retryable",
      code: "CAPTCHA_BLOCKED",
      message: "Google detected automated traffic (CAPTCHA)",
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Wait 5-10 minutes before retrying. Reduce search frequency.",
    };
  }

  // ── API-level errors ──
  if (errStr.includes("429") || errStr.includes("rate limit")) {
    return {
      stage,
      severity: "retryable",
      code: "RATE_LIMITED",
      message: `Anthropic API rate limit hit during ${stage}`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Wait 30-60 seconds and retry. Consider reducing batch size.",
    };
  }

  if (errStr.includes("529") || errStr.includes("overloaded")) {
    return {
      stage,
      severity: "retryable",
      code: "API_OVERLOADED",
      message: `Anthropic API overloaded during ${stage}`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Wait 1-2 minutes and retry. This is temporary.",
    };
  }

  if (errStr.includes("401") || errStr.includes("invalid api key") || errStr.includes("authentication")) {
    return {
      stage,
      severity: "fatal",
      code: "AUTH_FAILED",
      message: "Anthropic API key is invalid or expired",
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Check your ANTHROPIC_API_KEY in .env.local. Get a new key at console.anthropic.com.",
    };
  }

  if (errStr.includes("malformed json") || errStr.includes("unexpected token") || errStr.includes("json")) {
    return {
      stage,
      severity: "retryable",
      code: "MALFORMED_JSON",
      message: `Claude returned invalid JSON during ${stage}`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Retry — this is intermittent. If persistent, the prompt may need adjustment.",
    };
  }

  // ── Scraper-level errors ──
  if (errStr.includes("timeout") || errStr.includes("timed out") || errStr.includes("navigation")) {
    return {
      stage,
      severity: "skippable",
      code: "TIMEOUT",
      message: `Page load timed out for ${businessName || "unknown lead"}`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Website may be down or very slow. Skip and retry later.",
    };
  }

  if (errStr.includes("net::err") || errStr.includes("dns") || errStr.includes("econnrefused")) {
    return {
      stage,
      severity: "skippable",
      code: "NETWORK_ERROR",
      message: `Network error reaching ${businessName || "unknown"}'s website`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Domain may not exist or is blocking requests. Skip this lead.",
    };
  }

  if (errStr.includes("ssl") || errStr.includes("certificate") || errStr.includes("cert")) {
    return {
      stage,
      severity: "skippable",
      code: "SSL_ERROR",
      message: `SSL certificate error for ${businessName || "unknown"}`,
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Website has certificate issues. Try with --ignore-certificate-errors or skip.",
    };
  }

  if (errStr.includes("chromium") || errStr.includes("playwright") || errStr.includes("browser")) {
    return {
      stage,
      severity: "fatal",
      code: "BROWSER_ERROR",
      message: "Playwright/Chromium failed to launch",
      leadId,
      businessName,
      originalError: errMsg,
      suggestion: "Run 'npx playwright install chromium' to install the browser.",
    };
  }

  // ── Default ──
  return {
    stage,
    severity: "skippable",
    code: "UNKNOWN",
    message: `Unexpected error during ${stage}`,
    leadId,
    businessName,
    originalError: errMsg,
    suggestion: "Check logs for details. This lead will be skipped.",
  };
}

// ─── Pipeline-level error aggregation ───────────────────────────────────────

export interface PipelineRunReport {
  startedAt: string;
  completedAt: string;
  stages: Record<PipelineStage, StageReport>;
  errors: PipelineError[];
  hasFatalError: boolean;
  summary: string;
}

interface StageReport {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export function createEmptyReport(): PipelineRunReport {
  const stages: Record<PipelineStage, StageReport> = {
    website_scrape: { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
    linkedin_search: { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
    enrichment_extract: { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
    exit_score: { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
    outreach_generate: { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
  };

  return {
    startedAt: new Date().toISOString(),
    completedAt: "",
    stages,
    errors: [],
    hasFatalError: false,
    summary: "",
  };
}

export function finalizeReport(report: PipelineRunReport): PipelineRunReport {
  report.completedAt = new Date().toISOString();
  report.hasFatalError = report.errors.some((e) => e.severity === "fatal");

  const totalProcessed = Object.values(report.stages).reduce((sum, s) => sum + s.processed, 0);
  const totalFailed = Object.values(report.stages).reduce((sum, s) => sum + s.failed, 0);
  const errorCount = report.errors.length;

  if (report.hasFatalError) {
    const fatal = report.errors.find((e) => e.severity === "fatal")!;
    report.summary = `Pipeline halted: ${fatal.message}. ${fatal.suggestion}`;
  } else if (totalFailed === 0) {
    report.summary = `Pipeline completed successfully. ${totalProcessed} items processed across all stages.`;
  } else {
    report.summary = `Pipeline completed with ${totalFailed} failures across ${errorCount} errors. Check error details for remediation steps.`;
  }

  return report;
}

// ─── Graceful per-lead error handler ────────────────────────────────────────

/**
 * Wraps a per-lead processing function with error classification.
 * Returns true if the lead was processed, false if it was skipped/failed.
 * Fatal errors are re-thrown to halt the pipeline.
 */
export async function withErrorHandling<T>(
  stage: PipelineStage,
  leadId: number,
  businessName: string,
  report: PipelineRunReport,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await fn();
    report.stages[stage].succeeded++;
    report.stages[stage].processed++;
    return result;
  } catch (error) {
    report.stages[stage].failed++;
    report.stages[stage].processed++;

    const classified = classifyError(stage, error, leadId, businessName);
    report.errors.push(classified);

    if (classified.severity === "fatal") {
      // Fatal errors stop the entire pipeline
      throw error;
    }

    // Log for debugging
    console.warn(
      `[Pipeline:${stage}] ${classified.code} for "${businessName}" (lead ${leadId}): ${classified.message}`
    );

    return null;
  }
}
