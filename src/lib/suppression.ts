import type Database from "better-sqlite3";

// Re-export SuppressionEntry type from domain layer
export type { SuppressionEntry } from "@/domain/types";

export function createSuppressionTable(db: Database.Database) {
  // suppression_list table is created by the unified schema in db.ts.
  // This function is kept for backward compatibility but is now a no-op.
  // The table will already exist when getDb() is called.
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppression_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function isEmailSuppressed(db: Database.Database, email: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM suppression_list WHERE LOWER(email) = LOWER(?)"
  ).get(email);
  return !!row;
}

export function addToSuppressionList(
  db: Database.Database,
  email: string,
  reason: string,
  source: string,
): void {
  db.prepare(`
    INSERT INTO suppression_list (email, reason, source, created_at, updated_at)
    VALUES (LOWER(?), ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(email) DO UPDATE SET reason = ?, source = ?, updated_at = datetime('now')
  `).run(email, reason, source, reason, source);
}

export function bulkCheckSuppression(
  db: Database.Database,
  emails: string[],
): Set<string> {
  if (emails.length === 0) return new Set();
  const suppressed = new Set<string>();
  const BATCH = 500;
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT email FROM suppression_list WHERE LOWER(email) IN (${placeholders})`
    ).all(...batch.map(e => e.toLowerCase())) as { email: string }[];
    for (const row of rows) suppressed.add(row.email);
  }
  return suppressed;
}

export function getSuppressionList(
  db: Database.Database,
): { email: string; reason: string; source: string; created_at: string }[] {
  return db.prepare(
    "SELECT email, reason, source, created_at FROM suppression_list ORDER BY created_at ASC"
  ).all() as { email: string; reason: string; source: string; created_at: string }[];
}

export function removeFromSuppressionList(db: Database.Database, email: string): void {
  db.prepare("DELETE FROM suppression_list WHERE LOWER(email) = LOWER(?)").run(email);
}
