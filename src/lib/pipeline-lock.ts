/**
 * Named execution locks — prevents concurrent runs of the same job type.
 *
 * Uses one DB row per lock category ("pipeline", "scrape") so scraping and
 * enrichment pipelines can run simultaneously without blocking each other.
 * SQLite's serialized writes + BEGIN IMMEDIATE guarantee atomic acquire.
 *
 * Usage:
 *   acquireLock("cost-aware-pipeline")          // uses "pipeline" slot
 *   acquireLock("scrape", "scrape")              // uses "scrape" slot
 *   releaseLock("scrape")                        // releases "scrape" slot
 */
import { getDb } from "@/lib/db";
import { lastJobHeartbeatAt } from "@/lib/jobs";

const STALE_LOCK_MINUTES = 30;
const STALE_HEARTBEAT_MINUTES = 5;

// Two independent lock slots — scraping and enrichment don't share resources.
export type LockKey = "pipeline" | "scrape";

const LOCK_TABLE = `
  CREATE TABLE IF NOT EXISTS pipeline_lock (
    lock_key TEXT PRIMARY KEY,
    locked INTEGER NOT NULL DEFAULT 0,
    locked_by TEXT,
    locked_at TEXT
  )
`;

function ensureLockRow(db: ReturnType<typeof getDb>, lockKey: LockKey) {
  db.exec(LOCK_TABLE);
  const row = db.prepare("SELECT lock_key FROM pipeline_lock WHERE lock_key = ?").get(lockKey);
  if (!row) {
    db.prepare("INSERT INTO pipeline_lock (lock_key, locked) VALUES (?, 0)").run(lockKey);
  }
}

/** Derive lock slot from the pipeline name — all enrichment pipelines share one slot. */
function resolveLockKey(pipelineName: string, explicitKey?: LockKey): LockKey {
  if (explicitKey) return explicitKey;
  return pipelineName === "scrape" ? "scrape" : "pipeline";
}

export function acquireLock(pipelineName: string, lockKey?: LockKey): void {
  const db = getDb();
  const key = resolveLockKey(pipelineName, lockKey);
  ensureLockRow(db, key);

  const acquire = db.transaction((name: string, k: LockKey) => {
    const existing = db.prepare(
      "SELECT locked, locked_by, locked_at FROM pipeline_lock WHERE lock_key = ?"
    ).get(k) as { locked: number; locked_by: string | null; locked_at: string | null } | undefined;

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
          shouldRelease = true;
          reason = `no running job record, lock ${Math.round(lockAgeMin)}min old`;
        }
      }

      if (shouldRelease) {
        console.warn(`[PIPELINE LOCK:${k}] Auto-releasing "${existing.locked_by}" — ${reason}`);
        db.prepare(
          "UPDATE pipeline_lock SET locked = 0, locked_by = NULL, locked_at = NULL WHERE lock_key = ?"
        ).run(k);
      }
    }

    const result = db.prepare(`
      UPDATE pipeline_lock
      SET locked = 1, locked_by = ?, locked_at = datetime('now')
      WHERE lock_key = ? AND locked = 0
    `).run(name, k);

    return result.changes;
  }).immediate;

  const changes = acquire(pipelineName, key);

  if (changes === 0) {
    const current = db.prepare(
      "SELECT locked_by, locked_at FROM pipeline_lock WHERE lock_key = ?"
    ).get(key) as { locked_by: string; locked_at: string } | undefined;
    throw new Error(
      `[${key}] Already running: "${current?.locked_by}" started at ${current?.locked_at}. Wait for it to finish or restart the server.`
    );
  }
}

export function releaseLock(lockKey: LockKey = "pipeline"): void {
  try {
    const db = getDb();
    db.prepare(
      "UPDATE pipeline_lock SET locked = 0, locked_by = NULL, locked_at = NULL WHERE lock_key = ?"
    ).run(lockKey);
  } catch {
    // Best-effort
  }
}

export function isLocked(lockKey: LockKey = "pipeline"): boolean {
  try {
    const db = getDb();
    ensureLockRow(db, lockKey);
    const row = db.prepare("SELECT locked FROM pipeline_lock WHERE lock_key = ?").get(lockKey) as
      | { locked: number }
      | undefined;
    return row?.locked === 1;
  } catch {
    return false;
  }
}

export function getLockStatus(lockKey: LockKey = "pipeline"): {
  locked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  isStale: boolean;
  ageMinutes: number | null;
} {
  try {
    const db = getDb();
    ensureLockRow(db, lockKey);
    const row = db.prepare(
      "SELECT locked, locked_by, locked_at FROM pipeline_lock WHERE lock_key = ?"
    ).get(lockKey) as
      | { locked: number; locked_by: string | null; locked_at: string | null }
      | undefined;

    if (!row || row.locked !== 1) {
      return { locked: false, lockedBy: null, lockedAt: null, isStale: false, ageMinutes: null };
    }

    let ageMinutes: number | null = null;
    let isStale = false;
    if (row.locked_at) {
      ageMinutes = (Date.now() - new Date(row.locked_at).getTime()) / 60000;
      isStale = ageMinutes > STALE_LOCK_MINUTES;
      if (isStale) {
        console.warn(
          `[PIPELINE LOCK:${lockKey}] Stale lock "${row.locked_by}" (${Math.round(ageMinutes)}min) — auto-releasing.`
        );
        releaseLock(lockKey);
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
