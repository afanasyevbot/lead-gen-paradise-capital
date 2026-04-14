/**
 * Hunter.io Email Provider
 *
 * Uses Hunter's Email Finder API to find email by name + domain.
 * Falls back to Domain Search if name isn't available.
 * https://hunter.io/api-documentation
 *
 * Free tier: 25 searches/month
 */

import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

export class HunterEmailProvider implements EmailProvider {
  name: EmailProviderName = "hunter";

  isConfigured(): boolean {
    return !!process.env.HUNTER_API_KEY;
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return null;

    // Try email-finder first if we have a name
    if (input.fullName || (input.firstName && input.lastName)) {
      const result = await this.emailFinder(apiKey, input);
      if (result) return result;
    }

    // Fall back to domain search
    return this.domainSearch(apiKey, input);
  }

  private async emailFinder(apiKey: string, input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const firstName = input.firstName || input.fullName?.trim().split(/\s+/)[0] || "";
    const lastName = input.lastName || input.fullName?.trim().split(/\s+/).slice(1).join(" ") || "";

    if (!firstName || !lastName) return null;

    const params = new URLSearchParams({
      domain: input.domain,
      first_name: firstName,
      last_name: lastName,
      api_key: apiKey,
    });

    const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);

    if (!res.ok) return null;

    const json = await res.json();
    const data = json.data;

    if (!data?.email) return null;

    return {
      email: data.email,
      confidence: (data.score || 50) / 100,
      ownerName: `${data.first_name || firstName} ${data.last_name || lastName}`.trim(),
      ownerTitle: data.position || input.title || null,
      rawResponse: {
        score: data.score,
        domain: data.domain,
        sources: data.sources?.length || 0,
        type: data.type, // personal or generic
      },
    };
  }

  private async domainSearch(apiKey: string, input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const params = new URLSearchParams({
      domain: input.domain,
      api_key: apiKey,
      limit: "5",
      type: "personal",
    });

    // If we have a company name, use it for filtering
    if (input.companyName) {
      params.set("company", input.companyName);
    }

    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);

    if (!res.ok) return null;

    const json = await res.json();
    const emails = json.data?.emails;

    if (!emails || emails.length === 0) return null;

    // Prefer emails with senior titles
    const seniorTitles = /owner|founder|president|ceo|managing|director|principal/i;
    const best = emails.find((e: Record<string, unknown>) =>
      typeof e.position === "string" && seniorTitles.test(e.position)
    ) || emails[0];

    if (!best?.value) return null;

    return {
      email: best.value,
      confidence: (best.confidence || 50) / 100,
      ownerName: `${best.first_name || ""} ${best.last_name || ""}`.trim() || null,
      ownerTitle: best.position || null,
      rawResponse: {
        total_results: json.data?.total || 0,
        confidence: best.confidence,
        type: best.type,
        sources_count: best.sources?.length || 0,
      },
    };
  }
}
