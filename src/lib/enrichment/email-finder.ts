import { getDb } from "@/lib/db";
import { WaterfallEmailFinder } from "./email/waterfall";

type ProgressCallback = (current: number, total: number, item: string) => void;

/**
 * Find founder emails using the full waterfall:
 * Website → Hunter → Apollo → Snov → ZeroBounce verification
 *
 * Stops on first verified-valid email. Skips providers with no API key.
 */
export async function findFounderEmails(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ found_website: number; found_hunter: number; found_apollo: number; found_snov: number; not_found: number; failed: number }> {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT l.id, l.business_name, l.website, l.city, l.state,
              ed.data as enrichment_json,
              ld.owner_name_from_linkedin
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       LEFT JOIN founder_emails fe ON fe.lead_id = l.id
       WHERE fe.id IS NULL
         AND l.enrichment_status IN ('scored', 'outreach_generated')
         AND CAST(JSON_EXTRACT(ed.data, '$.score') AS INTEGER) >= 7
       ORDER BY l.id
       LIMIT ?`
    )
    .all(limit) as {
      id: number;
      business_name: string;
      website: string | null;
      city: string | null;
      state: string | null;
      enrichment_json: string;
      owner_name_from_linkedin: string | null;
    }[];

  const counts = { found_website: 0, found_hunter: 0, found_apollo: 0, found_snov: 0, not_found: 0, failed: 0 };
  const finder = new WaterfallEmailFinder();

  async function processLead(row: typeof rows[0], i: number): Promise<void> {
    onProgress?.(i + 1, rows.length, row.business_name);

    try {
      const enrichment = JSON.parse(row.enrichment_json);
      const ownerName: string | null = enrichment.owner_name || row.owner_name_from_linkedin || null;

      // Parse owner name into first/last for providers that need it
      const nameParts = (ownerName || "").trim().split(/\s+/);
      const firstName = nameParts[0] || null;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

      // Extract domain from website URL
      const domain = row.website
        ? row.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
        : row.business_name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";

      const input = {
        domain,
        fullName: ownerName || null,
        firstName,
        lastName,
        title: enrichment.owner_title || null,
        companyName: row.business_name,
      };

      const result = await finder.findEmail(input);

      if (result.bestEmail) {
        const source = result.bestProvider || "unknown";
        db.prepare(
          `INSERT OR REPLACE INTO founder_emails (lead_id, email, email_source, owner_name, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          row.id,
          result.bestEmail,
          source,
          result.candidates.find((c) => c.email === result.bestEmail)?.ownerName || ownerName,
          result.bestVerificationStatus,
        );

        // Increment correct provider counter
        if (source.includes("website")) counts.found_website++;
        else if (source.includes("hunter")) counts.found_hunter++;
        else if (source.includes("apollo")) counts.found_apollo++;
        else if (source.includes("snov")) counts.found_snov++;
        else counts.found_website++; // fallback
      } else {
        // Record miss so we don't retry
        db.prepare(
          `INSERT OR REPLACE INTO founder_emails (lead_id, email, email_source, owner_name, confidence, created_at)
           VALUES (?, NULL, 'not_found', ?, 'none', datetime('now'))`
        ).run(row.id, ownerName);
        counts.not_found++;
      }
    } catch (err) {
      console.error(`[EMAIL] Waterfall failed for ${row.business_name}:`, err);
      counts.failed++;
    }
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((row, batchIdx) => processLead(row, i + batchIdx)));
  }

  return counts;
}

/**
 * Find email for a SINGLE lead by ID — used by the lead detail action button.
 * Returns full waterfall details (which providers were tried, candidates found, etc.)
 */
export async function findEmailForLead(leadId: number): Promise<{
  success: boolean;
  email: string | null;
  source: string | null;
  waterfall: {
    providersAttempted: string[];
    providersHit: string[];
    candidates: { email: string; provider: string; verificationStatus: string; confidence: number }[];
    durationMs: number;
  };
}> {
  const db = getDb();

  // Clear any existing record so waterfall runs fresh
  try { db.prepare("DELETE FROM founder_emails WHERE lead_id = ?").run(leadId); } catch { /* */ }

  const row = db
    .prepare(
      `SELECT l.id, l.business_name, l.website, l.city, l.state,
              ed.data as enrichment_json,
              ld.owner_name_from_linkedin
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       WHERE l.id = ?`
    )
    .get(leadId) as {
      id: number;
      business_name: string;
      website: string | null;
      city: string | null;
      state: string | null;
      enrichment_json: string;
      owner_name_from_linkedin: string | null;
    } | undefined;

  if (!row) {
    return {
      success: false,
      email: null,
      source: null,
      waterfall: { providersAttempted: [], providersHit: [], candidates: [], durationMs: 0 },
    };
  }

  const enrichment = JSON.parse(row.enrichment_json);
  const ownerName: string | null = enrichment.owner_name || row.owner_name_from_linkedin || null;
  const nameParts = (ownerName || "").trim().split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const domain = row.website
    ? row.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : row.business_name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";

  const finder = new WaterfallEmailFinder();

  const result = await finder.findEmail({
    domain,
    fullName: ownerName || null,
    firstName,
    lastName,
    title: enrichment.owner_title || null,
    companyName: row.business_name,
  });

  if (result.bestEmail) {
    const source = result.bestProvider || "unknown";
    db.prepare(
      `INSERT OR REPLACE INTO founder_emails (lead_id, email, email_source, owner_name, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(leadId, result.bestEmail, source, ownerName, result.bestVerificationStatus);
  } else {
    db.prepare(
      `INSERT OR REPLACE INTO founder_emails (lead_id, email, email_source, owner_name, confidence, created_at)
       VALUES (?, NULL, 'not_found', ?, 'none', datetime('now'))`
    ).run(leadId, ownerName);
  }

  return {
    success: !!result.bestEmail,
    email: result.bestEmail,
    source: result.bestProvider,
    waterfall: {
      providersAttempted: result.providersAttempted,
      providersHit: result.providersHit,
      candidates: result.candidates.map((c) => ({
        email: c.email,
        provider: c.provider,
        verificationStatus: c.verificationStatus,
        confidence: c.confidenceScore,
      })),
      durationMs: result.durationMs,
    },
  };
}
