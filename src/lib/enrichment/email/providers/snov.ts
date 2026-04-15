/**
 * Snov.io Email Provider
 *
 * Uses Snov's Email Finder to find emails by name + domain.
 * https://snov.io/api
 *
 * Free tier: 50 credits/month
 */

import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export class SnovEmailProvider implements EmailProvider {
  name: EmailProviderName = "snov";

  isConfigured(): boolean {
    return !!(process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET);
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const token = await this.getAccessToken(input.signal);
    if (!token) return null;

    // Try name + domain search
    if (input.fullName || (input.firstName && input.lastName)) {
      const result = await this.findByNameDomain(token, input);
      if (result) return result;
    }

    // Fall back to domain search
    return this.findByDomain(token, input);
  }

  private async findByNameDomain(token: string, input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const firstName = input.firstName || input.fullName?.trim().split(/\s+/)[0] || "";
    const lastName = input.lastName || input.fullName?.trim().split(/\s+/).slice(1).join(" ") || "";

    if (!firstName || !lastName) return null;

    const res = await fetch("https://api.snov.io/v1/get-emails-from-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: token,
        firstName,
        lastName,
        domain: input.domain,
      }),
      signal: input.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (!data.data?.emails?.length) return null;

    // Pick the most relevant email
    const best = data.data.emails.reduce((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aStatus = a.emailStatus === "valid" ? 2 : a.emailStatus === "unknown" ? 1 : 0;
      const bStatus = b.emailStatus === "valid" ? 2 : b.emailStatus === "unknown" ? 1 : 0;
      return bStatus > aStatus ? b : a;
    }, data.data.emails[0]);

    return {
      email: best.email,
      confidence: best.emailStatus === "valid" ? 0.9 : best.emailStatus === "unknown" ? 0.5 : 0.3,
      ownerName: `${firstName} ${lastName}`.trim(),
      ownerTitle: input.title || null,
      rawResponse: {
        emailStatus: best.emailStatus,
        total_emails: data.data.emails.length,
      },
    };
  }

  private async findByDomain(token: string, input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const res = await fetch("https://api.snov.io/v2/domain-emails-with-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: token,
        domain: input.domain,
        limit: 10,
      }),
      signal: input.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const emails = data.data?.emails;

    if (!emails?.length) return null;

    // Prefer senior positions
    const seniorTitles = /owner|founder|president|ceo|managing|director|principal/i;
    const best = emails.find((e: Record<string, unknown>) =>
      typeof e.position === "string" && seniorTitles.test(e.position)
    ) || emails[0];

    if (!best?.email) return null;

    return {
      email: best.email,
      confidence: best.status === "valid" ? 0.8 : 0.5,
      ownerName: `${best.firstName || ""} ${best.lastName || ""}`.trim() || null,
      ownerTitle: best.position || null,
      rawResponse: {
        status: best.status,
        total_results: emails.length,
        source_page: best.sourcePage || null,
      },
    };
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string | null> {
    if (cachedAccessToken && Date.now() < tokenExpiresAt) {
      return cachedAccessToken;
    }

    const clientId = process.env.SNOV_CLIENT_ID;
    const clientSecret = process.env.SNOV_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
      const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal,
      });

      if (!res.ok) return null;

      const data = await res.json();
      cachedAccessToken = data.access_token;
      // Tokens last ~1 hour, refresh at 50 min
      tokenExpiresAt = Date.now() + 50 * 60 * 1000;
      return cachedAccessToken;
    } catch {
      return null;
    }
  }
}
