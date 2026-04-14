import { createAnthropicClient } from "./client";
import { callAnthropicWithRetry } from "./retry";
import type { FactCheckResult } from "@/domain/types";
import { loadPromptWithFallback } from "@/infrastructure/ai/prompt-loader";

// Re-export for backward compatibility
export type { FactCheckResult } from "@/domain/types";

const FACT_CHECK_PROMPT = `You are a fact-checker for outreach emails. You will be given an email draft and the source data it was written from. Your job is to verify every specific claim in the email against the source data.

For each specific claim (a name, year, number, location, service, award, or any concrete detail), check if it appears in the source data.

Return ONLY valid JSON:
{
  "all_claims_verified": boolean,
  "claims": [
    {
      "claim": "string — the specific detail from the email",
      "found_in_source": boolean,
      "source_text": "string or null — the matching text from source data, or null if not found"
    }
  ],
  "unverified_claims": ["string — claims that could not be found in the source data"],
  "risk_level": "safe | review | rewrite — safe if all verified, review if 1 unverified non-critical claim, rewrite if any fabricated core detail"
}`;

export async function factCheckEmail(
  emailBody: string,
  sourceData: string,
): Promise<FactCheckResult> {
  const client = createAnthropicClient();
  return callAnthropicWithRetry<FactCheckResult>({
    client,
    maxTokens: 800,
    system: loadPromptWithFallback("fact-check", FACT_CHECK_PROMPT),
    userContent: `EMAIL DRAFT:\n${emailBody}\n\nSOURCE DATA:\n${sourceData}`,
  });
}
