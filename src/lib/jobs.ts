// Re-export shared types from domain layer for backward compatibility.
export type { JobProgress, Job, JobType, JobStatus } from "@/domain/types";
import type { Job, JobProgress, JobType } from "@/domain/types";
import { getDb } from "@/lib/db";

// ─── Schema ──────────────────────────────────────────────────────────────────

const JOBS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    progress TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )
`;

function ensureJobsTable() {
  getDb().exec(JOBS_SCHEMA);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToJob(row: {
  id: string;
  type: string;
  status: string;
  progress: string;
  result: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as Job["status"],
    progress: JSON.parse(row.progress) as JobProgress,
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function createJob(type: JobType): Job {
  ensureJobsTable();
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const progress: JobProgress = { current: 0, total: 0, stage: "starting", currentItem: "" };
  const startedAt = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO pipeline_jobs (id, type, status, progress, started_at)
       VALUES (?, ?, 'running', ?, ?)`
    )
    .run(id, type, JSON.stringify(progress), startedAt);

  return { id, type, status: "running", progress, startedAt };
}

export function updateJobProgress(id: string, progress: Partial<JobProgress>) {
  try {
    const db = getDb();
    const row = db.prepare("SELECT progress FROM pipeline_jobs WHERE id = ?").get(id) as
      | { progress: string }
      | undefined;
    if (!row) return;
    const current: JobProgress = JSON.parse(row.progress);
    const updated = { ...current, ...progress };
    db.prepare("UPDATE pipeline_jobs SET progress = ? WHERE id = ?").run(JSON.stringify(updated), id);
  } catch { /* best-effort */ }
}

export function completeJob(id: string, result: Record<string, number>) {
  try {
    getDb()
      .prepare(
        `UPDATE pipeline_jobs
         SET status = 'completed', result = ?, completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(JSON.stringify(result), id);
  } catch (err) {
    console.error(`[JOBS] completeJob failed for ${id}:`, String(err));
  }
}

export function failJob(id: string, error: string) {
  try {
    getDb()
      .prepare(
        `UPDATE pipeline_jobs
         SET status = 'failed', error = ?, completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(error, id);
  } catch (err) {
    console.error(`[JOBS] failJob failed for ${id}:`, String(err));
  }
}

export function getJob(id: string): Job | undefined {
  try {
    ensureJobsTable();
    const row = getDb()
      .prepare("SELECT * FROM pipeline_jobs WHERE id = ?")
      .get(id) as Parameters<typeof rowToJob>[0] | undefined;
    return row ? rowToJob(row) : undefined;
  } catch {
    return undefined;
  }
}

export function getRecentJobs(limit = 20): Job[] {
  try {
    ensureJobsTable();
    const rows = getDb()
      .prepare("SELECT * FROM pipeline_jobs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as Parameters<typeof rowToJob>[0][];
    return rows.map(rowToJob);
  } catch {
    return [];
  }
}
