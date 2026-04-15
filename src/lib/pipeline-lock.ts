/**
 * Pipeline execution lock — prevents concurrent pipeline runs.
 *
 * Uses a single DB row as a mutex. SQLite's serialized writes guarantee
 * atomicity. Any route that launches a background pipeline job must:
 *   1. Call acquireLock() — throws if already locked
 *   2. Call releaseLock() in a finally block when done
 */
import { getDb } from "@/lib/db";
import { lastJobHeartbeatAt } from "@/lib/jobs";

const STALE_LOCK_MINUTES = 30; // any lock older than 30 min is assumed crashed
const STALE_HEARTBEAT_MINUTES = 5; // no progress update in 5 min = stuck

const LOCK_TABLE = `
  CREATE TABLE IF NOT EXISTS pipeline_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    locked INTEGER NOT NULL DEFAULT 0,
    locked_by TEXT,
    locked_at TEXT
  )
`;

function ensureLockTable() {
  const db = getDb();
  db.exec(LOCK_TABLE);
  const row = db.prepare("SELECT id FROM pipeline_lock WHERE id = 1").get();
  if (!row) {
    db.prepare("INSERT INTO pipeline_lock (id, locked) VALUES (1, 0)").run();
  }
}

export function acquireLock(pipelineName: string): void {
  ensureLockTable();
  const db = getDb();

  // Auto-release stale locks before trying to acquire. Two criteria:
  //   1. Hard ceiling: lock older than STALE_LOCK_MINUTES (assume crashed)
  //   2. Heartbeat-based: no job progress update in STALE_HEARTBEAT_MINUTES
  //      (catches pipelines killed mid-stage where finally never ran)
  const existing = db.prepare("SELECT locked, locked_by, locked_at FROM pipeline_lock WHERE id = 1").get() as
    | { locked: number; locked_by: string | null; locked_at: string | null }
    | undefined;
  if (existing?.locked === 1 && existing.locked_at) {
    const lockAgeMin = (Date.now() - new Date(existing.locked_at).getTime()) / 60000;
    let shouldRelease = false;
    let reason = "";

    if (lockAgeMin > STALE_LOCK_MINUTES) {
      shouldRelease = true;
      reason = `lock age ${Math.round(lockAgeMin)}min > ${STALE_LOCK_MINUTES}min`;
    } else {
      const heartbeat = lastJobHeartbeatAt();
      if (heartbeat) {
        const hbAgeMin = (Date.now() - new Date(heartbeat).getTime()) / 60000;
        if (hbAgeMin > STALE_HEARTBEAT_MINUTES) {
          shouldRelease = true;
          reason = `heartbeat silent for ${Math.round(hbAgeMin)}min > ${STALE_HEARTBEAT_MINUTES}min`;
        }
      } else if (lockAgeMin > STALE_HEARTBEAT_MINUTES) {
        // Lock held but no running job exists at all → definitely stale
        shouldRelease = true;
        reason = `no running job record, lock ${Math.round(lockAgeMin)}min old`;
      }
    }

    if (shouldRelease) {
      console.warn(`[PIPELINE LOCK] Auto-releasing "${existing.locked_by}" — ${reason}`);
      releaseLock();
    }
  }

  const result = db.prepare(`
    UPDATE pipeline_lock
    SET locked = 1, locked_by = ?, locked_at = datetime('now')
    WHERE id = 1 AND locked = 0
  `).run(pipelineName);

  if (result.changes === 0) {
    const current = db.prepare("SELECT locked_by, locked_at FROM pipeline_lock WHERE id = 1").get() as
      | { locked_by: string; locked_at: string }
      | undefined;
    throw new Error(
      `Pipeline already running: "${current?.locked_by}" started at ${current?.locked_at}. Wait for it to finish or restart the server.`
    );
  }
}

export function releaseLock(): void {
  try {
    const db = getDb();
    db.prepare("UPDATE pipeline_lock SET locked = 0, locked_by = NULL, locked_at = NULL WHERE id = 1").run();
  } catch {
    // Best-effort — don't crash on lock release failure
  }
}

export function isLocked(): boolean {
  try {
    ensureLockTable();
    const db = getDb();
    const row = db.prepare("SELECT locked FROM pipeline_lock WHERE id = 1").get() as
      | { locked: number }
      | undefined;
    return row?.locked === 1;
  } catch {
    return false;
  }
}

export function getLockStatus(): {
  locked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  isStale: boolean;
  ageMinutes: number | null;
} {
  try {
    ensureLockTable();
    const db = getDb();
    const row = db.prepare("SELECT locked, locked_by, locked_at FROM pipeline_lock WHERE id = 1").get() as
      | { locked: number; locked_by: string | null; locked_at: string | null }
      | undefined;

    if (!row || row.locked !== 1) {
      return { locked: false, lockedBy: null, lockedAt: null, isStale: false, ageMinutes: null };
    }

    // Fix #10: Detect and auto-release stale locks from crashed pipelines
    let ageMinutes: number | null = null;
    let isStale = false;
    if (row.locked_at) {
      ageMinutes = (Date.now() - new Date(row.locked_at).getTime()) / 60000;
      isStale = ageMinutes > STALE_LOCK_MINUTES;
      if (isStale) {
        console.warn(
          `[PIPELINE LOCK] Stale lock detected — "${row.locked_by}" locked ${Math.round(ageMinutes)}min ago. Auto-releasing.`
        );
        releaseLock();
        return { locked: false, lockedBy: row.locked_by, lockedAt: row.locked_at, isStale: true, ageMinutes };
      }
    }

    return {
      locked: true,
      lockedBy: row.locked_by ?? null,
      lockedAt: row.locked_at ?? null,
      isStale,
      ageMinutes,
    };
  } catch {
    return { locked: false, lockedBy: null, lockedAt: null, isStale: false, ageMinutes: null };
  }
}
