import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureLeadCostsTable } from "@/lib/cost-tracker";

/**
 * GET /api/pipeline/summary
 * Returns a plain-English summary of current lead pipeline state.
 * Called after a pipeline run completes to show meaningful results.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const since = req.nextUrl.searchParams.get("since");

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enrichment_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN enrichment_status = 'scraped' THEN 1 ELSE 0 END) as scraped,
      SUM(CASE WHEN enrichment_status = 'enriched' THEN 1 ELSE 0 END) as enriched,
      SUM(CASE WHEN enrichment_status = 'scored' THEN 1 ELSE 0 END) as scored,
      SUM(CASE WHEN enrichment_status = 'outreach_generated' THEN 1 ELSE 0 END) as outreach_generated,
      SUM(CASE WHEN enrichment_status IN ('pre_filtered','icp_rejected','no_website') THEN 1 ELSE 0 END) as filtered_out,
      SUM(CASE WHEN enrichment_status IN ('scrape_failed','enrich_failed','score_failed','outreach_failed') THEN 1 ELSE 0 END) as failed
    FROM leads
  `).get() as Record<string, number>;

  // Leads scored 7+ (ready for outreach or already done)
  const highScoreRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM leads l
    JOIN scoring_data sd ON sd.lead_id = l.id
    WHERE l.enrichment_status IN ('scored', 'outreach_generated')
      AND sd.score >= 7
  `).get() as { count: number };

  // Leads with emails found
  const emailsRow = db.prepare(`
    SELECT COUNT(DISTINCT lead_id) as count FROM email_candidates WHERE is_primary = 1
  `).get() as { count: number };

  // Outreach ready to push to Instantly
  const readyToPushRow = db.prepare(`
    SELECT COUNT(*) as count FROM leads WHERE enrichment_status = 'outreach_generated'
  `).get() as { count: number };

  // Score distribution for all scored leads
  const scoreDistribution = db.prepare(`
    SELECT
      SUM(CASE WHEN sd.score >= 8 THEN 1 ELSE 0 END) as score_8_plus,
      SUM(CASE WHEN sd.score = 7 THEN 1 ELSE 0 END) as score_7,
      SUM(CASE WHEN sd.score BETWEEN 5 AND 6 THEN 1 ELSE 0 END) as score_5_6,
      SUM(CASE WHEN sd.score < 5 THEN 1 ELSE 0 END) as score_below_5
    FROM leads l
    JOIN scoring_data sd ON sd.lead_id = l.id
    WHERE l.enrichment_status IN ('scored', 'outreach_generated')
  `).get() as Record<string, number>;

  // Score distribution for this run (scoped by since)
  const thisRunScores = since ? (db.prepare(`
    SELECT
      SUM(CASE WHEN sd.score >= 8 THEN 1 ELSE 0 END) as score_8_plus,
      SUM(CASE WHEN sd.score = 7 THEN 1 ELSE 0 END) as score_7,
      SUM(CASE WHEN sd.score BETWEEN 5 AND 6 THEN 1 ELSE 0 END) as score_5_6,
      SUM(CASE WHEN sd.score < 5 THEN 1 ELSE 0 END) as score_below_5,
      COUNT(*) as total_scored
    FROM scoring_data sd
    WHERE sd.created_at >= ?
  `).get(since) as Record<string, number>) : null;

  // ICP-rejected / filtered this run
  const thisRunFiltered = since ? (db.prepare(`
    SELECT COUNT(*) as count FROM leads
    WHERE enrichment_status IN ('icp_rejected', 'pre_filtered', 'no_website')
      AND updated_at >= ?
  `).get(since) as { count: number }) : null;

  // Cost summary for this run (or all-time if no since param)
  let costSummary = { total_usd: 0, by_stage: {} as Record<string, number>, leads_billed: 0 };
  try {
    ensureLeadCostsTable();
    const costRows = since
      ? (db.prepare(`SELECT stage, SUM(cost_usd) as stage_cost, COUNT(DISTINCT lead_id) as lead_count FROM lead_costs WHERE created_at >= ? GROUP BY stage`).all(since) as { stage: string; stage_cost: number; lead_count: number }[])
      : (db.prepare(`SELECT stage, SUM(cost_usd) as stage_cost, COUNT(DISTINCT lead_id) as lead_count FROM lead_costs GROUP BY stage`).all() as { stage: string; stage_cost: number; lead_count: number }[]);
    const totalRow = since
      ? (db.prepare(`SELECT SUM(cost_usd) as total, COUNT(DISTINCT lead_id) as leads FROM lead_costs WHERE created_at >= ?`).get(since) as { total: number | null; leads: number })
      : (db.prepare(`SELECT SUM(cost_usd) as total, COUNT(DISTINCT lead_id) as leads FROM lead_costs`).get() as { total: number | null; leads: number });
    costSummary = {
      total_usd: totalRow.total ?? 0,
      by_stage: Object.fromEntries(costRows.map(r => [r.stage, r.stage_cost])),
      leads_billed: totalRow.leads,
    };
  } catch { /* cost table may not exist */ }

  return NextResponse.json({
    pipeline: {
      total: stats.total,
      pending: stats.pending,
      scraped: stats.scraped,
      enriched: stats.enriched,
      scored: stats.scored,
      outreach_generated: stats.outreach_generated,
      filtered_out: stats.filtered_out,
      failed: stats.failed,
    },
    highlights: {
      high_score_leads: highScoreRow.count,        // 7+ score
      emails_found: emailsRow.count,               // confirmed emails
      ready_to_push: readyToPushRow.count,         // outreach written, not yet sent
    },
    score_distribution: {
      legacy_tier: scoreDistribution.score_8_plus, // 8-10 → Legacy email
      high_tier: scoreDistribution.score_7,        // 7 → Legacy email
      seed_tier: scoreDistribution.score_5_6,      // 5-6 → Seed Planter email
      below_threshold: scoreDistribution.score_below_5, // <5 → no outreach
    },
    this_run_scores: thisRunScores ? {
      score_8_plus: thisRunScores.score_8_plus ?? 0,
      score_7: thisRunScores.score_7 ?? 0,
      score_5_6: thisRunScores.score_5_6 ?? 0,
      score_below_5: thisRunScores.score_below_5 ?? 0,
      total_scored: thisRunScores.total_scored ?? 0,
      filtered_out: thisRunFiltered?.count ?? 0,
    } : null,
    cost: costSummary,
  });
}
