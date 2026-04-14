/**
 * ZeroBounce Email Verification
 *
 * https://www.zerobounce.net/docs/email-validation-api-quickstart
 * Free tier: 100 verifications/month
 */

import type { EmailVerificationStatus } from "@/domain/types";

export interface ZeroBounceResult {
  status: EmailVerificationStatus;
  subStatus: string;
  rawStatus: string;
}

export async function verifyViaZeroBounce(email: string): Promise<ZeroBounceResult | null> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    api_key: apiKey,
    email: email,
  });

  const res = await fetch(`https://api.zerobounce.net/v2/validate?${params}`);

  if (!res.ok) return null;

  const data = await res.json();

  const statusMap: Record<string, EmailVerificationStatus> = {
    valid: "valid",
    invalid: "invalid",
    "catch-all": "catch_all",
    spamtrap: "invalid",
    abuse: "risky",
    do_not_mail: "invalid",
    unknown: "unknown",
  };

  return {
    status: statusMap[data.status] || "unknown",
    subStatus: data.sub_status || "",
    rawStatus: data.status || "unknown",
  };
}
