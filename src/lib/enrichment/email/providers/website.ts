/**
 * Website Email Provider
 *
 * Extracts emails already found by Claude during the enrichment stage.
 * No API key required — always "configured".
 */

import { getDb } from "@/lib/db";
import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

export class WebsiteEmailProvider implements EmailProvider {
  name: EmailProviderName = "website";

  isConfigured(): boolean {
    return true; // No API key needed
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const db = getDb();

    // Find the lead by domain to get enrichment data
    const domain = input.domain.replace(/^www\./, "");
    const row = db.prepare(
      `SELECT ed.data, l.id
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       WHERE l.website LIKE ?
       LIMIT 1`
    ).get(`%${domain}%`) as { data: string; id: number } | undefined;

    if (!row) return null;

    try {
      const enrichment = JSON.parse(row.data);

      // Check for personal email first, then generic
      const email = enrichment.owner_email || enrichment.company_email || null;
      if (!email) return null;

      return {
        email,
        confidence: enrichment.owner_email ? 0.8 : 0.5,
        ownerName: enrichment.owner_name || null,
        ownerTitle: enrichment.owner_title || null,
        rawResponse: { source: enrichment.owner_email ? "website_personal" : "website_generic", leadId: row.id },
      };
    } catch {
      return null;
    }
  }
}
