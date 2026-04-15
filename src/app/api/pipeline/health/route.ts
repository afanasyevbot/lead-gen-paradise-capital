/**
 * GET /api/pipeline/health
 *
 * Surfaces coverage gaps, funnel leaks, and attention-required items so the
 * UI can warn the user when a stage is silently under-performing.
 *
 * Defensive: every query is wrapped so a missing table or bad DB state
 * degrades one field rather than 500'ing the whole endpoint. Errors are
 * collected and returned in `errors[]` so the UI can badge broken stages
 * instead of silently rendering them as green/zero.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type Database from "better-sqlite3";

type Errors = { field: string; error: string }[];

function safeCount(db: Database.Database, field: string, sql: string, errors: Errors): number {
  try {
    const row = db.prepare(sql).get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch (e) {
    const msg = String(e);
    console.warn(`[HEALTH] ${field} query failed: ${msg}`);
    errors.push({ field, error: msg });
    return 0;
  }
}

function safeAll<T>(db: Database.Database, field: string, sql: string, errors: Errors): T[] {
  try {
    return db.prepare(sql).all() as T[];
  } catch (e) {
    const msg = String(e);
    console.warn(`[HEALTH] ${field} query failed: ${msg}`);
    errors.push({ field, error: msg });
    return [];
  }
}

export async function GET() {
  try {
    const db = getDb();
    const errors: Errors = [];

    const scraped = safeCount(db, "scraped", "SELECT COUNT(*) as c FROM scraped_content WHERE pages_scraped > 0", errors);
    const enriched = safeCount(db, "enriched", "SELECT COUNT(*) as c FROM enrichment_data", errors);
    const scored = safeCount(db, "scored", "SELECT COUNT(*) as c FROM scoring_data", errors);
    const outreach = safeCount(db, "outreach", "SELECT COUNT(*) as c FROM outreach_data", errors);
    const linkedin = safeCount(db, "linkedin", "SELECT COUNT(*) as c FROM linkedin_data", errors);
    const emailsFound = safeCount(db, "emails_found", "SELECT COUNT(*) as c FROM founder_emails WHERE email IS NOT NULL AND email != ''", errors);
    const emailsAttempted = safeCount(db, "emails_attempted", "SELECT COUNT(*) as c FROM founder_emails", errors);
    const totalLeads = safeCount(db, "total_leads", "SELECT COUNT(*) as c FROM leads", errors);
    const leadsWithWebsite = safeCount(
      db, "leads_with_website",
      "SELECT COUNT(*) as c FROM leads WHERE website IS NOT NULL AND website != ''",
      errors,
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
      db, "funnel_statuses",
      "SELECT enrichment_status, COUNT(*) as c FROM leads GROUP BY enrichment_status",
      errors,
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
      db, "noisy_names",
      `SELECT COUNT(*) as c FROM leads
       WHERE lower(business_name) IN ('linkedin','google','facebook','-','','n/a','unknown')`,
      errors,
    );

    const staleScrapeFailed = safeCount(
      db, "stale_scrape_failed",
      `SELECT COUNT(*) as c FROM leads
       WHERE enrichment_status = 'scrape_failed'
       AND updated_at < datetime('now', '-7 days')`,
      errors,
    );

    const unverifiedFounders = safeCount(
      db, "unverified_founders",
      `SELECT COUNT(*) as c FROM enrichment_data ed
       WHERE json_extract(ed.data, '$.is_likely_founder') = 1
         AND (json_extract(ed.data, '$.founder_evidence') IS NULL
              OR length(json_extract(ed.data, '$.founder_evidence')) < 10)`,
      errors,
    );

    const lowConfHighScore = safeCount(
      db, "low_conf_high_score",
      "SELECT COUNT(*) as c FROM scoring_data WHERE confidence = 'low' AND score >= 6",
      errors,
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
      errors, // UI should warn when non-empty
    });
  } catch (e) {
    console.error("[HEALTH] fatal:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
