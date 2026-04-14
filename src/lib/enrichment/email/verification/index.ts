/**
 * Email Verification Orchestrator
 *
 * Runs verification in order:
 * 1. MX/SMTP check (always — free, built-in)
 * 2. ZeroBounce or NeverBounce (if configured and MX/SMTP was inconclusive)
 */

import type { EmailVerificationStatus, EmailVerificationMethod } from "@/domain/types";
import { verifyViaMxSmtp } from "./mx-smtp";
import { verifyViaZeroBounce } from "./zerobounce";
import { verifyViaNeverBounce } from "./neverbounce";

export interface VerificationResult {
  status: EmailVerificationStatus;
  method: EmailVerificationMethod;
}

/**
 * Verify an email address using available verification methods.
 * Returns the best determination we can make.
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  // Basic format check
  if (!email || !email.includes("@") || !email.includes(".")) {
    return { status: "invalid", method: "mx_smtp" };
  }

  // Step 1: MX/SMTP (always available, free)
  try {
    const mxResult = await verifyViaMxSmtp(email);

    // If MX/SMTP gives a definitive answer, use it
    if (mxResult.status === "valid" || mxResult.status === "invalid") {
      return { status: mxResult.status, method: "mx_smtp" };
    }

    // If inconclusive, try paid providers
    if (mxResult.status === "unknown" || mxResult.status === "catch_all") {
      // Try ZeroBounce first
      if (process.env.ZEROBOUNCE_API_KEY) {
        try {
          const zbResult = await verifyViaZeroBounce(email);
          if (zbResult) {
            return { status: zbResult.status, method: "zerobounce" };
          }
        } catch {
          // Fall through to NeverBounce
        }
      }

      // Try NeverBounce
      if (process.env.NEVERBOUNCE_API_KEY) {
        try {
          const nbResult = await verifyViaNeverBounce(email);
          if (nbResult) {
            return { status: nbResult.status, method: "neverbounce" };
          }
        } catch {
          // Fall through
        }
      }

      // Return MX/SMTP result if no paid provider available
      return { status: mxResult.status, method: "mx_smtp" };
    }

    return { status: mxResult.status, method: "mx_smtp" };
  } catch {
    // If everything fails, return unknown
    return { status: "unknown", method: "mx_smtp" };
  }
}
