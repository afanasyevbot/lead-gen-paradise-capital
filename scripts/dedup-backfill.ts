/**
 * Dedup Backfill
 *
 * One-shot script to collapse duplicate leads that were created before the
 * cross-source dedup fix landed (prior to commit 9dcaa63). Two leads are
 * considered duplicates if either:
 *   1. They share a normalized website hostname (strip www., lowercase), OR
 *   2. They share a normalized business name AND city (LLC/Inc suffixes
 *      stripped, whitespace collapsed, lowercased)
 *
 * For each duplicate group:
 *   - Keep the lead with the richest state (enrichment_data > linkedin_data > website)
 *   - Move foreign-key rows (enrichment_data, scoring_data, etc.) to the kept lead
 *     where the kept lead has no row yet
 *   - Delete the loser rows
 *
 * Usage:
 *   npx tsx scripts/dedup-backfill.ts            # dry run — prints groups
 *   npx tsx scripts/dedup-backfill.ts --apply    # actually merge + delete
 *
 * Safe to re-run.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.resolve(process.cwd(), "paradise_leads.db");

const APPLY = process.argv.includes("--apply");

function normHost(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`)
      .hostname.replace(/^www\./, "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|pc|pa|llp|lp)\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Row {
  id: number;
  place_id: string;
  business_name: string;
  website: string | null;
  city: string | null;
  enrichment_status: string;
  created_at: string;
}

function richness(db: Database.Database, id: number): number {
  // Higher score = keep. Order of evidence richness:
  //   scoring_data > enrichment_data > linkedin_data > has website
  const s = db.prepare("SELECT 1 FROM scoring_data WHERE lead_id = ? LIMIT 1").get(id);
  const e = db.prepare("SELECT 1 FROM enrichment_data WHERE lead_id = ? LIMIT 1").get(id);
  const l = db.prepare("SELECT 1 FROM linkedin_data WHERE lead_id = ? LIMIT 1").get(id);
  return (s ? 8 : 0) + (e ? 4 : 0) + (l ? 2 : 0);
}

type FkTable = { table: string; column: string };
const FK_TABLES: FkTable[] = [
  { table: "scraped_content", column: "lead_id" },
  { table: "enrichment_data", column: "lead_id" },
  { table: "linkedin_data", column: "lead_id" },
  { table: "scoring_data", column: "lead_id" },
];

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(name);
  return !!row;
}

function mergeLead(db: Database.Database, keepId: number, loserId: number): void {
  for (const fk of FK_TABLES) {
    if (!tableExists(db, fk.table)) continue;
    // If loser has a row and keeper doesn't, move it. Otherwise drop the loser's row.
    const keepHas = db.prepare(`SELECT 1 FROM ${fk.table} WHERE ${fk.column} = ? LIMIT 1`).get(keepId);
    const loserHas = db.prepare(`SELECT 1 FROM ${fk.table} WHERE ${fk.column} = ? LIMIT 1`).get(loserId);
    if (loserHas && !keepHas) {
      db.prepare(`UPDATE ${fk.table} SET ${fk.column} = ? WHERE ${fk.column} = ?`).run(keepId, loserId);
    } else if (loserHas) {
      db.prepare(`DELETE FROM ${fk.table} WHERE ${fk.column} = ?`).run(loserId);
    }
  }
  db.prepare("DELETE FROM leads WHERE id = ?").run(loserId);
}

function main() {
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma("journal_mode = WAL");

  const leads = db.prepare(
    `SELECT id, place_id, business_name, website, city, enrichment_status, created_at
     FROM leads`
  ).all() as Row[];

  console.log(`[DEDUP] Loaded ${leads.length} leads from ${DB_PATH}`);

  // Group by host, then by (name|city)
  const byHost = new Map<string, Row[]>();
  const byNameCity = new Map<string, Row[]>();

  for (const r of leads) {
    const h = normHost(r.website);
    if (h) {
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h)!.push(r);
    }
    const key = `${normName(r.business_name)}|${(r.city || "").toLowerCase().trim()}`;
    if (!byNameCity.has(key)) byNameCity.set(key, []);
    byNameCity.get(key)!.push(r);
  }

  // Build duplicate groups: any set of 2+ rows that match on either key
  const mergedGroups: Row[][] = [];
  const seen = new Set<number>();

  const considerGroup = (group: Row[]) => {
    if (group.length < 2) return;
    const fresh = group.filter((r) => !seen.has(r.id));
    if (fresh.length < 2) return;
    for (const r of fresh) seen.add(r.id);
    mergedGroups.push(fresh);
  };

  for (const group of byHost.values()) considerGroup(group);
  for (const group of byNameCity.values()) considerGroup(group);

  if (mergedGroups.length === 0) {
    console.log("[DEDUP] No duplicates found. ✓");
    return;
  }

  let totalLosers = 0;
  const tx = db.transaction(() => {
    for (const group of mergedGroups) {
      // Pick keeper: highest richness, tie-break by oldest created_at
      const ranked = group
        .map((r) => ({ r, score: richness(db, r.id) }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.r.created_at.localeCompare(b.r.created_at);
        });
      const keeper = ranked[0].r;
      const losers = ranked.slice(1).map((x) => x.r);
      totalLosers += losers.length;

      console.log(
        `[DEDUP] Group of ${group.length}: keep id=${keeper.id} "${keeper.business_name}" ` +
        `(score=${ranked[0].score}) — drop ${losers.map((l) => l.id).join(",")}`
      );

      if (APPLY) {
        for (const loser of losers) mergeLead(db, keeper.id, loser.id);
      }
    }
  });

  if (APPLY) {
    tx();
    console.log(`[DEDUP] ✓ Merged and deleted ${totalLosers} duplicate leads`);
  } else {
    console.log(`[DEDUP] DRY RUN — would merge and delete ${totalLosers} duplicate leads`);
    console.log(`[DEDUP] Re-run with --apply to make changes`);
  }
}

main();
