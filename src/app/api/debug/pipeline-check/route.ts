import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRecentJobs } from "@/lib/jobs";
import { getLockStatus } from "@/lib/pipeline-lock";

/**
 * GET /api/debug/pipeline-check
 * Returns what each pipeline stage would find to process, plus recent job results.
 */
export async function GET() {
  const db = getDb();

  // What each stage queries for
  const pending = (db.prepare("SELECT COUNT(*) as c FROM leads WHERE enrichment_status = 'pending'").get() as { c: number }).c;

  const scrapedForExtract = (db.prepare(
    `SELECT COUNT(*) as c FROM leads l
     JOIN scraped_content sc ON sc.lead_id = l.id
     WHERE l.enrichment_status = 'scraped'`
  ).get() as { c: number }).c;

  const scrapedNoContent = (db.prepare(
    `SELECT COUNT(*) as c FROM leads l
     LEFT JOIN scraped_content sc ON sc.lead_id = l.id
     WHERE l.enrichment_status = 'scraped' AND sc.id IS NULL`
  ).get() as { c: number }).c;

  const enrichedForScore = (db.prepare(
    `SELECT COUNT(*) as c FROM leads WHERE enrichment_status = 'enriched'`
  ).get() as { c: number }).c;

  const scoredForEmail = (db.prepare(
    `SELECT COUNT(*) as c FROM leads l
     JOIN scoring_data sd ON sd.lead_id = l.id
     LEFT JOIN email_candidates ec ON ec.lead_id = l.id AND ec.is_primary = 1
     WHERE ec.id IS NULL
       AND l.enrichment_status IN ('scored', 'outreach_generated')
       AND sd.score >= 8`
  ).get() as { c: number }).c;

  const scoredForOutreach = (db.prepare(
    `SELECT COUNT(*) as c FROM leads l
     JOIN scoring_data sd ON sd.lead_id = l.id
     WHERE l.enrichment_status IN ('scored', 'outreach_failed')
       AND sd.score >= 5
       AND sd.recommended_action IN ('reach_out_now', 'reach_out_warm', 'offer_booklet')`
  ).get() as { c: number }).c;

  // Status breakdown
  const statuses = db.prepare(
    "SELECT enrichment_status, COUNT(*) as c FROM leads GROUP BY enrichment_status ORDER BY c DESC"
  ).all() as { enrichment_status: string; c: number }[];

  // Break down failed leads by source
  const failedBySource = db.prepare(
    `SELECT enrichment_status, source, COUNT(*) as c
     FROM leads
     WHERE enrichment_status IN ('enrich_failed', 'scrape_failed', 'no_website')
     GROUP BY enrichment_status, source
     ORDER BY enrichment_status, c DESC`
  ).all() as { enrichment_status: string; source: string; c: number }[];

  // Recent jobs
  const recentJobs = getRecentJobs(5);

  // Lock status
  const lock = getLockStatus();

  return NextResponse.json({
    stage_queues: {
      "01_scrape (pending)": pending,
      "03_extract (scraped + has content)": scrapedForExtract,
      "03_extract_missing_content (scraped but no scraped_content)": scrapedNoContent,
      "05_score (enriched)": enrichedForScore,
      "04_email (scored 8+ no email)": scoredForEmail,
      "06_outreach (scored 5+ with action)": scoredForOutreach,
    },
    statuses: Object.fromEntries(statuses.map(s => [s.enrichment_status, s.c])),
    failed_by_source: failedBySource,
    lock,
    recent_jobs: recentJobs.map(j => ({
      id: j.id,
      status: j.status,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      result: j.result,
      error: j.error,
    })),
  });
}
