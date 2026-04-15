/**
 * Website Email Provider
 *
 * Pulls emails discovered during scraping. Three sources, in order:
 *   1. scraped_content.emails_found JSON (populated by harvestContactsFromPage —
 *      catches mailto: hrefs, Cloudflare data-cfemail, "[at]/[dot]" obfuscation)
 *   2. Claude-extracted owner_email / company_email from enrichment_data
 *   3. Regex fallback over raw scraped text
 *
 * No API key required — always "configured".
 */

import { getDb } from "@/lib/db";
import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";
import { rankEmails, harvestContactsFromStored, GENERIC_PREFIXES as GENERIC_RE } from "@/lib/scraper/email-harvester";

export class WebsiteEmailProvider implements EmailProvider {
  name: EmailProviderName = "website";

  isConfigured(): boolean {
    return true;
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const db = getDb();
    const domain = input.domain.replace(/^www\./, "").toLowerCase();

    // Narrow the SQL match to variants that could only be the exact domain —
    // avoids the `%smith.com%` over-match that pulled in `smithplumbing.com`.
    // We still need the JS hostname verification to handle protocol/path noise.
    const candidates = db.prepare(
      `SELECT ed.data, l.id, l.website,
              sc.all_text, sc.homepage_text, sc.about_text, sc.emails_found
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN scraped_content sc ON sc.lead_id = l.id
       WHERE lower(l.website) LIKE ?
          OR lower(l.website) LIKE ?
          OR lower(l.website) LIKE ?
          OR lower(l.website) LIKE ?
       ORDER BY l.id ASC`
    ).all(
      `http://${domain}%`,
      `https://${domain}%`,
      `http://www.${domain}%`,
      `https://www.${domain}%`,
    ) as {
      data: string;
      id: number;
      website: string | null;
      all_text: string | null;
      homepage_text: string | null;
      about_text: string | null;
      emails_found: string | null;
    }[];

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

    let enrichment: Record<string, unknown> = {};
    try { enrichment = JSON.parse(row.data) as Record<string, unknown>; } catch { /* ignore */ }

    // ── Source 1: harvester column ────────────────────────────────────────
    let harvested: string[] = [];
    if (row.emails_found) {
      try { harvested = JSON.parse(row.emails_found) as string[]; } catch { /* ignore */ }
    }
    // If scraper predates the harvester column, run it now over stored content
    if (harvested.length === 0 && (row.all_text || row.homepage_text)) {
      const text = [row.homepage_text, row.about_text, row.all_text].filter(Boolean).join("\n");
      const { emails } = harvestContactsFromStored("", text);
      harvested = emails;
    }

    if (harvested.length > 0) {
      const ranked = rankEmails(harvested, domain);
      const best = ranked[0];
      const [, host] = best.split("@");
      const isOwnDomain = host === domain || host?.endsWith(`.${domain}`);
      const isGeneric = GENERIC_RE.test(best);

      let confidence = 0.4;
      if (isOwnDomain && !isGeneric) confidence = 0.85;
      else if (isOwnDomain && isGeneric) confidence = 0.55;
      else if (!isOwnDomain && !isGeneric) confidence = 0.6;

      return {
        email: best,
        confidence,
        ownerName: (enrichment.owner_name as string) || null,
        ownerTitle: (enrichment.owner_title as string) || null,
        rawResponse: {
          source: "website_harvested",
          leadId: row.id,
          isOwnDomain,
          isGeneric,
          totalFound: harvested.length,
        },
      };
    }

    // ── Source 2: Claude-extracted ────────────────────────────────────────
    const claudeEmail = (enrichment.owner_email as string) || (enrichment.company_email as string) || null;
    if (claudeEmail) {
      return {
        email: claudeEmail,
        confidence: enrichment.owner_email ? 0.8 : 0.5,
        ownerName: (enrichment.owner_name as string) || null,
        ownerTitle: (enrichment.owner_title as string) || null,
        rawResponse: { source: enrichment.owner_email ? "website_personal" : "website_generic", leadId: row.id },
      };
    }

    // ── Source 3: regex fallback ──────────────────────────────────────────
    if (row.all_text) {
      // Fresh regex per call — shared /../gi leaks lastIndex across callers.
      const found = row.all_text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi);
      if (found && found.length > 0) {
        const ranked = rankEmails(found, domain);
        const best = ranked[0];
        const isPersonal = !GENERIC_RE.test(best);
        return {
          email: best,
          confidence: isPersonal ? 0.65 : 0.4,
          ownerName: (enrichment.owner_name as string) || null,
          ownerTitle: (enrichment.owner_title as string) || null,
          rawResponse: { source: "website_regex_fallback", leadId: row.id },
        };
      }
    }

    return null;
  }
}
