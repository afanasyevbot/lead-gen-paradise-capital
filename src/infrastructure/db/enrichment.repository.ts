/**
 * Enrichment Repository
 *
 * All enrichment-related database queries: extraction, scoring, outreach,
 * LinkedIn, and the full "enrichment bundle" for lead detail views.
 */

import type Database from "better-sqlite3";

export class EnrichmentRepository {
  constructor(private db: Database.Database) {}

  // ─── Extraction ─────────────────────────────────────────────────────────

  saveExtraction(leadId: number, data: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO enrichment_data (lead_id, data, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(leadId, JSON.stringify(data));
  }

  getExtraction(leadId: number): Record<string, unknown> | null {
    const row = this.db.prepare(
      "SELECT data FROM enrichment_data WHERE lead_id = ?"
    ).get(leadId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  // ─── Scoring ────────────────────────────────────────────────────────────

  saveScoring(leadId: number, score: number, confidence: string, action: string, data: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO scoring_data (lead_id, score, confidence, recommended_action, data, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(leadId, score, confidence, action, JSON.stringify(data));
  }

  getScoring(leadId: number): { score: number; confidence: string; recommended_action: string; data: Record<string, unknown> } | null {
    const row = this.db.prepare(
      "SELECT score, confidence, recommended_action, data FROM scoring_data WHERE lead_id = ?"
    ).get(leadId) as { score: number; confidence: string; recommended_action: string; data: string } | undefined;
    if (!row) return null;
    return { score: row.score, confidence: row.confidence, recommended_action: row.recommended_action, data: JSON.parse(row.data) };
  }

  // ─── Outreach ───────────────────────────────────────────────────────────

  saveOutreach(leadId: number, outreach: Record<string, unknown>, followups: Record<string, unknown> | null): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO outreach_data (lead_id, outreach_json, followup_json, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(leadId, JSON.stringify(outreach), followups ? JSON.stringify(followups) : null);
  }

  getOutreach(leadId: number): { outreach: Record<string, unknown>; followups: Record<string, unknown> | null } | null {
    const row = this.db.prepare(
      "SELECT outreach_json, followup_json FROM outreach_data WHERE lead_id = ?"
    ).get(leadId) as { outreach_json: string; followup_json: string | null } | undefined;
    if (!row) return null;
    return {
      outreach: JSON.parse(row.outreach_json),
      followups: row.followup_json ? JSON.parse(row.followup_json) : null,
    };
  }

  // ─── LinkedIn ───────────────────────────────────────────────────────────

  saveLinkedIn(leadId: number, data: {
    linkedin_url: string | null;
    owner_name: string | null;
    owner_title: string | null;
    headline: string | null;
    rate_limited: boolean;
    data_quality: string;
  }): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO linkedin_data
       (lead_id, linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, linkedin_headline, rate_limited, data_quality, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      leadId, data.linkedin_url, data.owner_name, data.owner_title,
      data.headline, data.rate_limited ? 1 : 0, data.data_quality,
    );
  }

  getLinkedIn(leadId: number): { linkedin_url: string | null; owner_name: string | null; owner_title: string | null; headline: string | null } | null {
    const row = this.db.prepare(
      "SELECT linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, linkedin_headline FROM linkedin_data WHERE lead_id = ?"
    ).get(leadId) as Record<string, string | null> | undefined;
    if (!row) return null;
    return {
      linkedin_url: row.linkedin_url,
      owner_name: row.owner_name_from_linkedin,
      owner_title: row.owner_title_from_linkedin,
      headline: row.linkedin_headline,
    };
  }

  // ─── Scraped Content ────────────────────────────────────────────────────

  saveScrapedContent(leadId: number, data: {
    homepage_text: string; about_text: string; all_text: string; pages_scraped: number;
  }): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO scraped_content (lead_id, homepage_text, about_text, all_text, pages_scraped, scraped_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(leadId, data.homepage_text, data.about_text, data.all_text, data.pages_scraped);
  }

  getScrapedContent(leadId: number): { all_text: string; pages_scraped: number } | null {
    const row = this.db.prepare(
      "SELECT all_text, pages_scraped FROM scraped_content WHERE lead_id = ?"
    ).get(leadId) as { all_text: string; pages_scraped: number } | undefined;
    return row || null;
  }

  // ─── Enrichment Bundle (for lead detail view) ───────────────────────────

  /**
   * Get all enrichment data for a lead in one call.
   * Used by the lead detail page to avoid N+1 queries.
   */
  getBundle(leadId: number): {
    scraped: { all_text: string; pages_scraped: number } | null;
    enrichment: Record<string, unknown> | null;
    scoring: Record<string, unknown> | null;
    scoringMeta: { score: number; confidence: string; recommended_action: string } | null;
    outreach: Record<string, unknown> | null;
    followups: Record<string, unknown> | null;
    linkedin: { linkedin_url: string | null; owner_name: string | null; owner_title: string | null; headline: string | null } | null;
  } {
    return {
      scraped: this.getScrapedContent(leadId),
      enrichment: this.getExtraction(leadId),
      scoring: this.getScoring(leadId)?.data ?? null,
      scoringMeta: (() => {
        const s = this.getScoring(leadId);
        return s ? { score: s.score, confidence: s.confidence, recommended_action: s.recommended_action } : null;
      })(),
      outreach: this.getOutreach(leadId)?.outreach ?? null,
      followups: this.getOutreach(leadId)?.followups ?? null,
      linkedin: this.getLinkedIn(leadId),
    };
  }
}
