/**
 * Helper for reading from optional tables — tables that may not exist yet
 * because they're created by feature-specific migrations or lazy code.
 *
 * Replaces ~7 try/catch blocks in getLeadDetail() that all did the same thing:
 * SELECT one row by lead_id; if the table is missing, return null instead of
 * crashing the lead-detail endpoint.
 *
 * This swallows the SQLITE_ERROR for "no such table" only — other errors
 * propagate. Returns null when the table is missing or the row is absent.
 */
import type { Database } from "better-sqlite3";

export function getOptionalRow<T = Record<string, unknown>>(
  db: Database,
  table: string,
  leadId: number,
): T | null {
  try {
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE lead_id = ?`)
      .get(leadId) as T | undefined;
    return row ?? null;
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Reads an optional row and parses one of its columns as JSON.
 * Returns null if the table or row is missing, or the column is empty.
 */
export function getOptionalJson<T = unknown>(
  db: Database,
  table: string,
  leadId: number,
  jsonColumn: string,
): T | null {
  const row = getOptionalRow<Record<string, unknown>>(db, table, leadId);
  if (!row) return null;
  const raw = row[jsonColumn];
  if (typeof raw !== "string" || !raw) return null;
  return JSON.parse(raw) as T;
}
