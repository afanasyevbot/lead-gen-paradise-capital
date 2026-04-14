/**
 * Email Repository
 *
 * Manages email_candidates and email_enrichment_runs tables.
 * Stores all email candidates from the waterfall, tracks which is primary,
 * and logs each enrichment run for analytics.
 */

import type Database from "better-sqlite3";
import type {
  EmailCandidate,
  EmailProviderName,
  EmailVerificationStatus,
  EmailVerificationMethod,
  EmailEnrichmentResult,
} from "@/domain/types";

export class EmailRepository {
  constructor(private db: Database.Database) {
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id),
        email TEXT NOT NULL,
        provider TEXT NOT NULL,
        confidence_score REAL DEFAULT 0,
        verification_status TEXT DEFAULT 'unverified',
        verification_method TEXT,
        is_primary INTEGER DEFAULT 0,
        owner_name TEXT,
        owner_title TEXT,
        raw_response TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_email_candidates_lead_id ON email_candidates(lead_id);
      CREATE INDEX IF NOT EXISTS idx_email_candidates_primary ON email_candidates(lead_id, is_primary);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_candidates_unique ON email_candidates(lead_id, email, provider);

      CREATE TABLE IF NOT EXISTS email_enrichment_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id),
        providers_attempted TEXT NOT NULL,
        providers_hit TEXT,
        best_email TEXT,
        best_provider TEXT,
        best_verification_status TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_runs_lead_id ON email_enrichment_runs(lead_id);
    `);
  }

  // ─── Candidates ──────────────────────────────────────────────────────────

  saveCandidate(leadId: number, candidate: EmailCandidate): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO email_candidates
       (lead_id, email, provider, confidence_score, verification_status, verification_method,
        owner_name, owner_title, raw_response, created_at, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'),
        CASE WHEN ? != 'unverified' THEN datetime('now') ELSE NULL END)`
    ).run(
      leadId,
      candidate.email,
      candidate.provider,
      candidate.confidenceScore,
      candidate.verificationStatus,
      candidate.verificationMethod || null,
      candidate.ownerName || null,
      candidate.ownerTitle || null,
      candidate.rawResponse ? JSON.stringify(candidate.rawResponse) : null,
      candidate.verificationStatus,
    );
  }

  saveCandidates(leadId: number, candidates: EmailCandidate[]): void {
    const saveMany = this.db.transaction(() => {
      for (const candidate of candidates) {
        this.saveCandidate(leadId, candidate);
      }
    });
    saveMany();
  }

  setPrimary(leadId: number, email: string): void {
    const tx = this.db.transaction(() => {
      // Clear all primary flags for this lead
      this.db.prepare("UPDATE email_candidates SET is_primary = 0 WHERE lead_id = ?").run(leadId);
      // Set the chosen email as primary
      this.db.prepare("UPDATE email_candidates SET is_primary = 1 WHERE lead_id = ? AND email = ?").run(leadId, email);
    });
    tx();
  }

  getCandidates(leadId: number): EmailCandidate[] {
    const rows = this.db.prepare(
      `SELECT email, provider, confidence_score, verification_status, verification_method,
              owner_name, owner_title, raw_response
       FROM email_candidates
       WHERE lead_id = ?
       ORDER BY is_primary DESC, confidence_score DESC`
    ).all(leadId) as {
      email: string;
      provider: string;
      confidence_score: number;
      verification_status: string;
      verification_method: string | null;
      owner_name: string | null;
      owner_title: string | null;
      raw_response: string | null;
    }[];

    return rows.map((r) => ({
      email: r.email,
      provider: r.provider as EmailProviderName,
      confidenceScore: r.confidence_score,
      verificationStatus: r.verification_status as EmailVerificationStatus,
      verificationMethod: r.verification_method as EmailVerificationMethod | undefined,
      ownerName: r.owner_name,
      ownerTitle: r.owner_title,
      rawResponse: r.raw_response ? JSON.parse(r.raw_response) : undefined,
    }));
  }

  getPrimaryEmail(leadId: number): EmailCandidate | null {
    const row = this.db.prepare(
      `SELECT email, provider, confidence_score, verification_status, verification_method,
              owner_name, owner_title, raw_response
       FROM email_candidates
       WHERE lead_id = ? AND is_primary = 1`
    ).get(leadId) as {
      email: string;
      provider: string;
      confidence_score: number;
      verification_status: string;
      verification_method: string | null;
      owner_name: string | null;
      owner_title: string | null;
      raw_response: string | null;
    } | undefined;

    if (!row) return null;

    return {
      email: row.email,
      provider: row.provider as EmailProviderName,
      confidenceScore: row.confidence_score,
      verificationStatus: row.verification_status as EmailVerificationStatus,
      verificationMethod: row.verification_method as EmailVerificationMethod | undefined,
      ownerName: row.owner_name,
      ownerTitle: row.owner_title,
      rawResponse: row.raw_response ? JSON.parse(row.raw_response) : undefined,
    };
  }

  // ─── Enrichment Runs ─────────────────────────────────────────────────────

  saveRun(leadId: number, result: EmailEnrichmentResult): void {
    this.db.prepare(
      `INSERT INTO email_enrichment_runs
       (lead_id, providers_attempted, providers_hit, best_email, best_provider, best_verification_status, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      leadId,
      JSON.stringify(result.providersAttempted),
      JSON.stringify(result.providersHit),
      result.bestEmail,
      result.bestProvider,
      result.bestVerificationStatus,
      result.durationMs,
    );
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get leads that need email enrichment.
   * Must be scored 5+ and have no primary email candidate.
   * Score runs before email finding — leads below 5 never reach this stage.
   */
  getLeadsNeedingEmail(limit: number): { id: number; business_name: string; website: string | null; enrichment_json: string; owner_name_from_linkedin: string | null }[] {
    return this.db.prepare(
      `SELECT l.id, l.business_name, l.website,
              ed.data as enrichment_json,
              ld.owner_name_from_linkedin
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       JOIN scoring_data sd ON sd.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       LEFT JOIN email_candidates ec ON ec.lead_id = l.id AND ec.is_primary = 1
       WHERE ec.id IS NULL
         AND l.enrichment_status IN ('scored', 'outreach_generated')
         AND sd.score >= 8
       ORDER BY sd.score DESC
       LIMIT ?`
    ).all(limit) as { id: number; business_name: string; website: string | null; enrichment_json: string; owner_name_from_linkedin: string | null }[];
  }

  /**
   * Get stats about email enrichment results.
   */
  getStats(): { total: number; verified: number; unverified: number; invalid: number; byProvider: Record<string, number> } {
    const total = (this.db.prepare("SELECT COUNT(DISTINCT lead_id) as c FROM email_candidates WHERE is_primary = 1").get() as { c: number })?.c || 0;
    const verified = (this.db.prepare("SELECT COUNT(DISTINCT lead_id) as c FROM email_candidates WHERE is_primary = 1 AND verification_status = 'valid'").get() as { c: number })?.c || 0;
    const invalid = (this.db.prepare("SELECT COUNT(DISTINCT lead_id) as c FROM email_candidates WHERE is_primary = 1 AND verification_status = 'invalid'").get() as { c: number })?.c || 0;
    const unverified = total - verified - invalid;

    const providerRows = this.db.prepare(
      "SELECT provider, COUNT(*) as c FROM email_candidates WHERE is_primary = 1 GROUP BY provider"
    ).all() as { provider: string; c: number }[];

    const byProvider: Record<string, number> = {};
    for (const row of providerRows) {
      byProvider[row.provider] = row.c;
    }

    return { total, verified, unverified, invalid, byProvider };
  }
}
