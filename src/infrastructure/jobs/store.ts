/**
 * Persistent Job Store
 *
 * SQLite-backed job storage that survives server restarts.
 * Replaces the in-memory globalThis Map from lib/jobs.ts.
 *
 * Can be used alongside the existing in-memory store during migration.
 * The old jobs.ts functions still work — this provides an alternative
 * for when persistence is needed.
 */

import type Database from "better-sqlite3";
import type { Job, JobProgress, JobType, JobStatus } from "@/domain/types";

const CREATE_JOBS_TABLE = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    progress_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )
`;

export class JobStore {
  constructor(private db: Database.Database) {
    this.db.exec(CREATE_JOBS_TABLE);
  }

  /** Create a new job. Returns the created job. */
  create(type: JobType): Job {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const progress: JobProgress = { current: 0, total: 0, stage: "starting", currentItem: "" };

    this.db.prepare(
      `INSERT INTO jobs (id, type, status, progress_json, started_at)
       VALUES (?, ?, 'running', ?, ?)`
    ).run(id, type, JSON.stringify(progress), now);

    return { id, type, status: "running", progress, startedAt: now };
  }

  /** Update job progress. */
  updateProgress(id: string, progress: Partial<JobProgress>): void {
    const existing = this.get(id);
    if (!existing) return;
    const merged = { ...existing.progress, ...progress };
    this.db.prepare(
      "UPDATE jobs SET progress_json = ? WHERE id = ?"
    ).run(JSON.stringify(merged), id);
  }

  /** Mark a job as completed with results. */
  complete(id: string, result: Record<string, number>): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE jobs SET status = 'completed', result_json = ?, completed_at = ? WHERE id = ?"
    ).run(JSON.stringify(result), now, id);
  }

  /** Mark a job as failed with an error message. */
  fail(id: string, error: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?"
    ).run(error, now, id);
  }

  /** Get a job by ID. */
  get(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as {
      id: string; type: string; status: string;
      progress_json: string; result_json: string | null; error: string | null;
      started_at: string; completed_at: string | null;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type as JobType,
      status: row.status as JobStatus,
      progress: JSON.parse(row.progress_json),
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  /** Get recent jobs, ordered by start time descending. */
  getRecent(limit = 20): Job[] {
    const rows = this.db.prepare(
      "SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?"
    ).all(limit) as {
      id: string; type: string; status: string;
      progress_json: string; result_json: string | null; error: string | null;
      started_at: string; completed_at: string | null;
    }[];

    return rows.map(row => ({
      id: row.id,
      type: row.type as JobType,
      status: row.status as JobStatus,
      progress: JSON.parse(row.progress_json),
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    }));
  }

  /** Delete jobs older than N hours. */
  cleanup(olderThanHours = 24): number {
    const result = this.db.prepare(
      "DELETE FROM jobs WHERE completed_at IS NOT NULL AND completed_at < datetime('now', ?)"
    ).run(`-${olderThanHours} hours`);
    return result.changes;
  }
}
