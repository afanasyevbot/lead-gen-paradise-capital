/**
 * Suppression Repository
 *
 * Email suppression list database operations.
 * Wraps the existing suppression.ts functions into a class
 * that takes a db instance — no global singleton dependency.
 */

import type Database from "better-sqlite3";
import type { SuppressionEntry } from "@/domain/types";

export class SuppressionRepository {
  constructor(private db: Database.Database) {}

  /** Check if a single email is suppressed (case-insensitive). */
  isEmailSuppressed(email: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM suppression_list WHERE LOWER(email) = LOWER(?)"
    ).get(email);
    return !!row;
  }

  /** Add an email to the suppression list (upsert). */
  add(email: string, reason: string, source: string): void {
    this.db.prepare(`
      INSERT INTO suppression_list (email, reason, source, created_at, updated_at)
      VALUES (LOWER(?), ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(email) DO UPDATE SET reason = ?, source = ?, updated_at = datetime('now')
    `).run(email, reason, source, reason, source);
  }

  /** Bulk check a list of emails, returning the set of suppressed ones. */
  bulkCheck(emails: string[]): Set<string> {
    if (emails.length === 0) return new Set();
    const suppressed = new Set<string>();
    const BATCH = 500;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const rows = this.db.prepare(
        `SELECT email FROM suppression_list WHERE LOWER(email) IN (${placeholders})`
      ).all(...batch.map(e => e.toLowerCase())) as { email: string }[];
      for (const row of rows) suppressed.add(row.email);
    }
    return suppressed;
  }

  /** Get the full suppression list. */
  getAll(): SuppressionEntry[] {
    return this.db.prepare(
      "SELECT email, reason, source, created_at FROM suppression_list ORDER BY created_at ASC"
    ).all() as SuppressionEntry[];
  }

  /** Remove an email from the suppression list. */
  remove(email: string): void {
    this.db.prepare(
      "DELETE FROM suppression_list WHERE LOWER(email) = LOWER(?)"
    ).run(email);
  }
}
