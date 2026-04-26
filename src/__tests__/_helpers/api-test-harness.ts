/**
 * Shared harness for API route integration tests.
 *
 * Each test file calls `setupApiTestHarness()` at module top level. The harness:
 *   - Points DATABASE_PATH at a unique temp file (must happen before any db import)
 *   - Dynamically imports the db + rate-limit modules (after env is set)
 *   - Registers beforeAll/afterAll/beforeEach hooks: schema init, table wipe, cleanup
 *   - Returns { getDb, resetDb, seedLead } for use in tests
 *
 * Usage:
 *   const { seedLead, getDb } = await setupApiTestHarness();
 *   const leadsRoute = await import("@/app/api/leads/route");
 */
import { afterAll, beforeAll, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

export interface SeedLeadOverrides {
  place_id?: string;
  business_name?: string;
  status?: string;
  source?: string;
}

export interface ApiTestHarness {
  getDb: () => import("better-sqlite3").Database;
  resetDb: () => void;
  seedLead: (overrides?: SeedLeadOverrides) => number;
  dbPath: string;
}

let harnessCounter = 0;

export async function setupApiTestHarness(): Promise<ApiTestHarness> {
  // Unique per-suite path so parallel test files don't collide on the same DB.
  harnessCounter++;
  const dbPath = path.join(
    os.tmpdir(),
    `paradise-itest-${Date.now()}-${process.pid}-${harnessCounter}.db`,
  );
  process.env.DATABASE_PATH = dbPath;

  // Imports MUST come after DATABASE_PATH is set so the singleton picks it up.
  const { getDb, resetDb, upsertLead } = await import("@/lib/db");
  const { _resetRateLimits } = await import("@/lib/rate-limit");

  beforeAll(() => {
    getDb(); // trigger schema creation
  });

  afterAll(() => {
    resetDb();
    for (const ext of ["", "-shm", "-wal"]) {
      try {
        fs.unlinkSync(dbPath + ext);
      } catch {
        /* file may not exist */
      }
    }
  });

  beforeEach(() => {
    _resetRateLimits();
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      db.exec(`DELETE FROM "${name}"`);
    }
    db.pragma("foreign_keys = ON");
  });

  let seedCounter = 0;
  function seedLead(overrides: SeedLeadOverrides = {}): number {
    seedCounter++;
    const id = seedCounter;
    const placeId = overrides.place_id ?? `place-${id}`;
    upsertLead({
      place_id: placeId,
      business_name: overrides.business_name ?? `Test Co ${id}`,
      address: `${id} Main St`,
      city: `City${id}`,
      state: "IL",
      zip_code: "62701",
      phone: "555-0100",
      website: `https://example${id}.com`,
      google_rating: 4.5,
      review_count: 100,
      source: overrides.source ?? "google_maps",
    } as Record<string, unknown>);
    if (overrides.status || overrides.source) {
      getDb()
        .prepare(
          `UPDATE leads SET
            enrichment_status = COALESCE(?, enrichment_status),
            source = COALESCE(?, source)
           WHERE place_id = ?`,
        )
        .run(overrides.status ?? null, overrides.source ?? null, placeId);
    }
    return id;
  }

  return { getDb, resetDb, seedLead, dbPath };
}

/**
 * Drains a Web ReadableStream into a UTF-8 string. Used for asserting on
 * streaming route responses (CSV/JSON exports).
 */
export async function streamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}
