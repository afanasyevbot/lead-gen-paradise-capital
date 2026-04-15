/**
 * GET /api/pipeline/health
 *
 * Surfaces coverage gaps, funnel leaks, and attention-required items so the
 * UI can warn the user when a stage is silently under-performing.
 *
 * Defensive: every query is wrapped so a missing table or bad DB state
 * degrades one field rather than 500'ing the whole endpoint.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type Database from "better-sqlite3";

function safeCount(db: Database.Database, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch (e) {
    console.warn(`[HEALTH] query failed: ${sql.slice(0, 60)}… ${String(e)}`);
    return 0;
  }
}

function safeAll<T>(db: Database.Database, sql: string): T[] {
  try {
    return db.prepare(sql).all() as T[];
  } catch (e) {
    console.warn(`[HEALTH] query failed: ${sql.slice(0, 60)}… ${String(e)}`);
    return [];
  }
}

export async function GET() {
  try {
    const db = getDb();

    // Stage counts (each safely wrapped)
    const scraped = safeCount(db, "SELECT COUNT(*) as c FROM scraped_content");
    const enriched = safeCount(db, "SELECT COUNT(*) as c FROM enrichment_data");
    const scored = safeCount(db, "SELECT COUNT(*) as c FROM scoring_data");
    const outreach = safeCount(db, "SELECT COUNT(*) as c FROM outreach_data");
    const linkedin = safeCount(db, "SELECT COUNT(*) as c FROM linkedin_data");
    const emailsFound = safeCount(db, "SELECT COUNT(*) as c FROM founder_emails WHERE status = 'found'");
    const emailsAttempted = safeCount(db, "SELECT COUNT(*) as c FROM founder_emails");
    const totalLeads = safeCount(db, "SELECT COUNT(*) as c FROM leads");
    const leadsWithWebsite = safeCount(
      db,
      "SELECT COUNT(*) as c FROM leads WHERE website IS NOT NULL AND website != ''"
    );

    const stages = [
      { name: "scrape", have: scraped, eligible: leadsWithWebsite, warnBelow: 0.8 },
      { name: "linkedin", have: linkedin, eligible: scraped, warnBelow: 0.5 },
      { name: "enrich", have: enriched, eligible: scraped, warnBelow: 0.9 },
      { name: "score", have: scored, eligible: enriched, warnBelow: 0.95 },
      { name: "email", have: emailsFound, eligible: scored, warnBelow: 0.3 },
      { name: "outreach", have: outreach, eligible: scored, warnBelow: 0.2 },
    ].map((s) => ({
      ...s,
      pct: s.eligible > 0 ? s.have / s.eligible : 0,
      warn: s.eligible > 0 && s.have / s.eligible < s.warnBelow,
    }));

    const funnelStatuses = safeAll<{ enrichment_status: string; c: number }>(
      db,
      "SELECT enrichment_status, COUNT(*) as c FROM leads GROUP BY enrichment_status"
    );
    const byStatus: Record<string, number> = {};
    for (const r of funnelStatuses) byStatus[r.enrichment_status] = r.c;

    const funnel = {
      scored: byStatus.scored ?? 0,
      outreach_generated: byStatus.outreach_generated ?? 0,
      outreach_failed: byStatus.outreach_failed ?? 0,
      conversion_pct:
        (byStatus.scored ?? 0) > 0
          ? (byStatus.outreach_generated ?? 0) /
            ((byStatus.scored ?? 0) + (byStatus.outreach_generated ?? 0))
          : 0,
      stuck_in_scored: byStatus.scored ?? 0,
    };

    const noisyNames = safeCount(
      db,
      `SELECT COUNT(*) as c FROM leads
       WHERE lower(business_name) IN ('linkedin','google','facebook','-','','n/a','unknown')`
    );

    const staleScrapeFailed = safeCount(
      db,
      `SELECT COUNT(*) as c FROM leads
       WHERE enrichment_status = 'scrape_failed'
       AND updated_at < datetime('now', '-7 days')`
    );

    // json_extract may not be available on all SQLite builds — fall back to 0
    const unverifiedFounders = safeCount(
      db,
      `SELECT COUNT(*) as c FROM enrichment_data ed
       WHERE json_extract(ed.data, '$.is_likely_founder') = 1
         AND (json_extract(ed.data, '$.founder_evidence') IS NULL
              OR length(json_extract(ed.data, '$.founder_evidence')) < 10)`
    );

    const lowConfHighScore = safeCount(
      db,
      "SELECT COUNT(*) as c FROM scoring_data WHERE confidence = 'low' AND score >= 6"
    );

    const attention = {
      noisy_names: noisyNames,
      stale_scrape_failed: staleScrapeFailed,
      unverified_founders: unverifiedFounders,
      low_conf_high_score: lowConfHighScore,
      emails_not_found: emailsAttempted - emailsFound,
      email_miss_rate: emailsAttempted > 0 ? (emailsAttempted - emailsFound) / emailsAttempted : 0,
    };

    return NextResponse.json({
      total_leads: totalLeads,
      stages,
      funnel,
      attention,
      byStatus,
    });
  } catch (e) {
    console.error("[HEALTH] fatal:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
