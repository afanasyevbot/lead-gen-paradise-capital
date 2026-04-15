/**
 * Apollo.io Email Provider
 *
 * Uses the Apollo People Match API to find business emails.
 * https://apolloio.github.io/apollo-api-docs/
 */

import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

export class ApolloEmailProvider implements EmailProvider {
  name: EmailProviderName = "apollo";

  isConfigured(): boolean {
    return !!(process.env.APOLLO_API_KEY || loadApolloKey());
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const apiKey = process.env.APOLLO_API_KEY || loadApolloKey();
    if (!apiKey) return null;

    const firstName = input.firstName || input.fullName?.trim().split(/\s+/)[0] || "";
    const lastName = input.lastName || input.fullName?.trim().split(/\s+/).slice(1).join(" ") || "";

    if (!firstName || !input.domain) return null;

    const res = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        organization_name: input.companyName || "",
        domain: input.domain,
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      return null;
    }

    const data = await res.json();
    const person = data.person;

    if (!person?.email) return null;

    return {
      email: person.email,
      confidence: person.email_confidence ? person.email_confidence / 100 : 0.7,
      ownerName: person.name || input.fullName || null,
      ownerTitle: person.title || input.title || null,
      rawResponse: {
        person_id: person.id,
        name: person.name,
        title: person.title,
        email_status: person.email_status,
      },
    };
  }
}

function loadApolloKey(): string | null {
  try {
    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^APOLLO_API_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim();
      process.env.APOLLO_API_KEY = key;
      return key;
    }
  } catch { /* no key */ }
  return null;
}
