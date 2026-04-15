import Anthropic from "@anthropic-ai/sdk";
import { trackClaudeCost } from "@/lib/cost-tracker";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

interface CallOptions {
  client: Anthropic;
  model?: string;
  maxTokens: number;
  system: string | SystemBlock[];
  userContent: string;
  /** Optional post-parse validator. Throw to trigger a retry. */
  validate?: (parsed: unknown) => void;
  /** When set, token usage is recorded to lead_costs for this lead. */
  leadId?: number;
  /** Pipeline stage label for cost tracking (e.g. "extract", "score"). */
  stage?: string;
}

// ─── Lightweight schema validators ───────────────────────────────────────────

/**
 * Validates that a scoring response has the minimum required fields
 * with sensible values. Throws a descriptive error on failure.
 */
export function validateScoringResponse(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Scoring response is not an object");
  }
  const r = parsed as Record<string, unknown>;

  // Normalize score — accept string numbers ("7") and coerce
  const rawScore = r.score;
  const score = typeof rawScore === "number" ? rawScore : Number(rawScore);
  if (isNaN(score) || score < 0 || score > 10) {
    throw new Error(`Invalid score: ${JSON.stringify(rawScore)} — must be number 0-10`);
  }
  r.score = score; // normalize in-place

  // Normalize confidence — case-insensitive
  const conf = String(r.confidence ?? "").toLowerCase().trim();
  if (!["high", "medium", "low"].includes(conf)) {
    throw new Error(`Invalid confidence: ${JSON.stringify(r.confidence)}`);
  }
  r.confidence = conf; // normalize in-place

  // Normalize recommended_action — accept variations Haiku sometimes produces
  const VALID_ACTIONS = ["reach_out_now", "reach_out_warm", "offer_booklet", "monitor", "skip"];
  const rawAction = String(r.recommended_action ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  if (!VALID_ACTIONS.includes(rawAction)) {
    throw new Error(`Invalid recommended_action: ${JSON.stringify(r.recommended_action)}`);
  }
  r.recommended_action = rawAction; // normalize in-place

  // Normalize gate booleans so score.ts gates always fire correctly.
  // Coerce string "true"/"false" and truthy values to real booleans.
  const toBool = (v: unknown): boolean | undefined => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.toLowerCase().trim();
      if (s === "true") return true;
      if (s === "false") return false;
    }
    return undefined;
  };
  const founder = toBool(r.is_likely_founder);
  if (founder !== undefined) r.is_likely_founder = founder;

  const tooSmall = toBool(r.revenue_too_small);
  if (tooSmall !== undefined) r.revenue_too_small = tooSmall;

  const tooLarge = toBool(r.revenue_too_large);
  if (tooLarge !== undefined) r.revenue_too_large = tooLarge;
}

/**
 * Validates that an outreach response has the minimum required fields.
 */
export function validateOutreachResponse(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Outreach response is not an object");
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r.subject_line !== "string" || r.subject_line.trim() === "") {
    throw new Error(`Missing or empty subject_line`);
  }
  if (typeof r.email_body !== "string" || r.email_body.length < 50) {
    throw new Error(`email_body too short or missing: length=${typeof r.email_body === "string" ? r.email_body.length : "N/A"}`);
  }
}

/**
 * Call the Anthropic API with retry logic for rate limits (429)
 * and parse the response as JSON with retry on malformed responses.
 */
export async function callAnthropicWithRetry<T>(
  opts: CallOptions,
): Promise<T> {
  const { client, model = "claude-sonnet-4-20250514", maxTokens, system, userContent, validate, leadId, stage } = opts;

  // Wrap string system prompts in a cached block so Anthropic can reuse them
  // across calls within the same batch — reduces input token costs by ~70%.
  const systemBlocks: SystemBlock[] = typeof system === "string"
    ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
    : system;

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages: [{ role: "user", content: userContent }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";

      // Extract JSON — find first { and matching last } to handle
      // cases where Haiku adds explanation text after the closing ```
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      const cleaned = firstBrace !== -1 && lastBrace > firstBrace
        ? text.slice(firstBrace, lastBrace + 1)
        : text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

      try {
        const parsed = JSON.parse(cleaned) as T;
        if (validate) validate(parsed);
        // Track token cost after successful parse
        if (leadId && stage && response.usage) {
          trackClaudeCost(leadId, stage, model, response.usage.input_tokens, response.usage.output_tokens);
        }
        return parsed;
      } catch (parseErr) {
        // Malformed JSON or failed validation — retry if we have attempts left
        lastError = new Error(
          `Invalid API response (attempt ${attempt + 1}/${MAX_RETRIES}): ${String(parseErr)}. ` +
          `Response started with: ${text.slice(0, 200)}`
        );
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
    } catch (err) {
      lastError = err;

      if (isRateLimitError(err)) {
        const retryAfter = getRetryAfterMs(err) || BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[Anthropic] Rate limited (429). Retrying in ${Math.round(retryAfter / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(retryAfter);
        continue;
      }

      if (isOverloadedError(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[Anthropic] API overloaded (529). Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(delay);
        continue;
      }

      // For non-retryable errors, throw immediately
      throw err;
    }
  }

  throw lastError;
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 429) return true;
  return false;
}

function isOverloadedError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError && err.status === 529) return true;
  if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 529) return true;
  return false;
}

function getRetryAfterMs(err: unknown): number | null {
  if (err && typeof err === "object" && "headers" in err) {
    const headers = (err as { headers?: Record<string, string> }).headers;
    const retryAfter = headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
