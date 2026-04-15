/**
 * Dropcontact Email Provider
 *
 * Uses Dropcontact's enrichment API to find business emails.
 * https://developer.dropcontact.com/
 *
 * Note: Dropcontact is async — it returns a request_id and you poll for results.
 * We poll with a 15-second timeout.
 */

import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 15_000;

export class DropcontactEmailProvider implements EmailProvider {
  name: EmailProviderName = "dropcontact";

  isConfigured(): boolean {
    return !!process.env.DROPCONTACT_API_KEY;
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) return null;

    const firstName = input.firstName || input.fullName?.trim().split(/\s+/)[0] || "";
    const lastName = input.lastName || input.fullName?.trim().split(/\s+/).slice(1).join(" ") || "";

    if (!firstName) return null;

    // Submit enrichment request
    const submitRes = await fetch("https://api.dropcontact.com/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": apiKey,
      },
      body: JSON.stringify({
        data: [{
          first_name: firstName,
          last_name: lastName || undefined,
          company: input.companyName || undefined,
          website: input.domain || undefined,
        }],
        siren: false,
        language: "en",
      }),
      signal: input.signal,
    });

    if (!submitRes.ok) return null;

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;

    if (!requestId) return null;

    // Poll for results
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_POLL_MS) {
      if (input.signal?.aborted) return null;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (input.signal?.aborted) return null;

      const pollRes = await fetch(`https://api.dropcontact.com/batch/${requestId}`, {
        headers: { "X-Access-Token": apiKey },
        signal: input.signal,
      });

      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();

      if (!pollData.success || !pollData.data?.length) continue;

      const person = pollData.data[0];

      if (person.email?.[0]?.email) {
        return {
          email: person.email[0].email,
          confidence: person.email[0].qualification === "professional" ? 0.85 : 0.6,
          ownerName: `${person.first_name || firstName} ${person.last_name || lastName}`.trim(),
          ownerTitle: person.job || input.title || null,
          rawResponse: {
            qualification: person.email[0].qualification,
            nb_email: person.email?.length || 0,
            civility: person.civility,
          },
        };
      }

      // If processing is done but no email, stop polling
      if (pollData.error === false && pollData.success) break;
    }

    return null;
  }
}
