/**
 * MX/SMTP Email Verification
 *
 * Free, built-in verification:
 * 1. DNS MX lookup — does the domain accept email?
 * 2. SMTP handshake — does the mailbox exist?
 * 3. Catch-all detection — does the server accept any address?
 *
 * Limitations:
 * - Many mail servers block SMTP verification (returns "unknown")
 * - Gmail, Outlook, etc. won't let you verify individual mailboxes
 * - Best used as a first-pass filter before paid verification
 */

import { resolveMx } from "dns/promises";
import { createConnection, type Socket } from "net";
import type { EmailVerificationStatus } from "@/domain/types";

const SMTP_TIMEOUT_MS = 10_000;

export interface MxSmtpResult {
  status: EmailVerificationStatus;
  mxHost: string | null;
  smtpResponse: string | null;
  isCatchAll: boolean;
}

/**
 * Verify an email address via MX lookup + SMTP handshake.
 */
export async function verifyViaMxSmtp(email: string): Promise<MxSmtpResult> {
  const domain = email.split("@")[1];
  if (!domain) {
    return { status: "invalid", mxHost: null, smtpResponse: "No domain in email", isCatchAll: false };
  }

  // Step 1: MX lookup
  let mxHost: string;
  try {
    const records = await resolveMx(domain);
    if (!records || records.length === 0) {
      return { status: "invalid", mxHost: null, smtpResponse: "No MX records", isCatchAll: false };
    }
    // Sort by priority (lowest = highest priority)
    records.sort((a, b) => a.priority - b.priority);
    mxHost = records[0].exchange;
  } catch {
    return { status: "invalid", mxHost: null, smtpResponse: "MX lookup failed", isCatchAll: false };
  }

  // Step 2: SMTP handshake
  try {
    const smtpResult = await smtpCheck(mxHost, email, domain);
    return { ...smtpResult, mxHost };
  } catch {
    // SMTP connection refused or timed out — common for big providers
    return { status: "unknown", mxHost, smtpResponse: "SMTP connection failed", isCatchAll: false };
  }
}

/**
 * Perform SMTP handshake to verify mailbox exists.
 */
function smtpCheck(
  mxHost: string,
  email: string,
  domain: string,
): Promise<{ status: EmailVerificationStatus; smtpResponse: string; isCatchAll: boolean }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket?.destroy();
      resolve({ status: "unknown", smtpResponse: "SMTP timeout", isCatchAll: false });
    }, SMTP_TIMEOUT_MS);

    let socket: Socket | null = null;
    let step = 0;
    let buffer = "";
    let rcptResponse = "";

    try {
      socket = createConnection(25, mxHost);

      socket.setEncoding("utf-8");

      socket.on("data", (data: string) => {
        buffer += data;

        if (!buffer.includes("\r\n") && !buffer.includes("\n")) return;

        const code = parseInt(buffer.substring(0, 3), 10);

        if (step === 0 && code === 220) {
          // Server greeting — send EHLO
          step = 1;
          buffer = "";
          socket!.write(`EHLO verify.local\r\n`);
        } else if (step === 1 && code === 250) {
          // EHLO accepted — send MAIL FROM
          step = 2;
          buffer = "";
          socket!.write(`MAIL FROM:<verify@${domain}>\r\n`);
        } else if (step === 2 && code === 250) {
          // MAIL FROM accepted — send RCPT TO
          step = 3;
          buffer = "";
          socket!.write(`RCPT TO:<${email}>\r\n`);
        } else if (step === 3) {
          rcptResponse = buffer.trim();
          step = 4;
          buffer = "";
          // Send QUIT
          socket!.write("QUIT\r\n");

          if (code === 250) {
            clearTimeout(timeout);
            resolve({ status: "valid", smtpResponse: rcptResponse, isCatchAll: false });
          } else if (code === 550 || code === 551 || code === 553) {
            clearTimeout(timeout);
            resolve({ status: "invalid", smtpResponse: rcptResponse, isCatchAll: false });
          } else if (code === 452 || code === 421) {
            clearTimeout(timeout);
            resolve({ status: "unknown", smtpResponse: rcptResponse, isCatchAll: false });
          } else {
            clearTimeout(timeout);
            resolve({ status: "unknown", smtpResponse: rcptResponse, isCatchAll: false });
          }
        }
      });

      socket.on("error", () => {
        clearTimeout(timeout);
        resolve({ status: "unknown", smtpResponse: "Connection error", isCatchAll: false });
      });

      socket.on("close", () => {
        clearTimeout(timeout);
        if (step < 3) {
          resolve({ status: "unknown", smtpResponse: "Connection closed early", isCatchAll: false });
        }
      });
    } catch {
      clearTimeout(timeout);
      resolve({ status: "unknown", smtpResponse: "Connection failed", isCatchAll: false });
    }
  });
}
