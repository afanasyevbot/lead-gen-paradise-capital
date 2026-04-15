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

    // Find the lead by EXACT hostname match. Using LIKE %domain% previously
    // caused collisions: searching "smith.com" also matched "smithplumbing.com".
    const domain = input.domain.replace(/^www\./, "").toLowerCase();
    const candidates = db.prepare(
      `SELECT ed.data, l.id, l.website, sc.all_text
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN scraped_content sc ON sc.lead_id = l.id
       WHERE l.website LIKE ?`
    ).all(`%${domain}%`) as { data: string; id: number; website: string | null; all_text: string | null }[];

    const row = candidates.find((r) => {
      if (!r.website) return false;
      try {
        const host = new URL(r.website.startsWith("http") ? r.website : `https://${r.website}`)
          .hostname.replace(/^www\./, "").toLowerCase();
        return host === domain;
      } catch {
        return false;
      }
    });

    if (!row) return null;

    try {
      const enrichment = JSON.parse(row.data);

      // Check for personal email first, then generic (Claude-extracted)
      const claudeEmail = enrichment.owner_email || enrichment.company_email || null;
      if (claudeEmail) {
        return {
          email: claudeEmail,
          confidence: enrichment.owner_email ? 0.8 : 0.5,
          ownerName: enrichment.owner_name || null,
          ownerTitle: enrichment.owner_title || null,
          rawResponse: { source: enrichment.owner_email ? "website_personal" : "website_generic", leadId: row.id },
        };
      }

      // Regex fallback — scan raw scraped text for any email address Claude may have missed
      if (row.all_text) {
        const emailRegex = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
        const found = row.all_text.match(emailRegex);
        if (found && found.length > 0) {
          // Prefer emails that match the lead's domain over generic ones
          const domainEmails = found.filter((e) => e.toLowerCase().includes(domain.replace(/^www\./, "")));
          const best = domainEmails[0] || found[0];
          const isPersonal = !best.match(/^(info|contact|hello|support|admin|sales|enquir|mail|office|noreply|no-reply)@/i);

          return {
            email: best,
            confidence: isPersonal ? 0.65 : 0.4,
            ownerName: enrichment.owner_name || null,
            ownerTitle: enrichment.owner_title || null,
            rawResponse: { source: "website_regex_fallback", leadId: row.id },
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
