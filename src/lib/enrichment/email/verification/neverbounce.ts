/**
 * NeverBounce Email Verification
 *
 * https://developers.neverbounce.com/reference/single-check
 * Free tier: 1000 verifications for new accounts
 */

import type { EmailVerificationStatus } from "@/domain/types";

export interface NeverBounceResult {
  status: EmailVerificationStatus;
  rawResult: string;
}

export async function verifyViaNeverBounce(email: string): Promise<NeverBounceResult | null> {
  const apiKey = process.env.NEVERBOUNCE_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.neverbounce.com/v4.2/single/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: apiKey,
      email: email,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();

  const statusMap: Record<string, EmailVerificationStatus> = {
    valid: "valid",
    invalid: "invalid",
    disposable: "invalid",
    catchall: "catch_all",
    unknown: "unknown",
  };

  return {
    status: statusMap[data.result] || "unknown",
    rawResult: data.result || "unknown",
  };
}
