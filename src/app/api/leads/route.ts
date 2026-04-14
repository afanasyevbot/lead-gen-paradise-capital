import { NextRequest, NextResponse } from "next/server";
import { getLeads, getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const scoreTierParam = p.get("scoreTier");
    const hasEmailParam = p.get("hasEmail");
    const result = getLeads({
      status: p.get("status") || undefined,
      minRating: p.get("minRating") ? Number(p.get("minRating")) : undefined,
      hasWebsite: p.get("hasWebsite") === "true",
      excludeChains: p.get("excludeChains") === "true",
      search: p.get("search") || undefined,
      scoreTier: (scoreTierParam as "high" | "medium" | "low" | "unscored") || undefined,
      hasEmail: hasEmailParam === "yes" ? true : hasEmailParam === "no" ? false : undefined,
      sortBy: p.get("sortBy") || undefined,
      sortOrder: (p.get("sortOrder") as "asc" | "desc") || undefined,
      page: p.get("page") ? Number(p.get("page")) : undefined,
      pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/leads?action=reset-xray
 * Resets linkedin_xray leads stuck in no_website back to pending
 * so the fixed pipeline can process them via LinkedIn data.
 */
export async function PATCH(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const db = getDb();

  try {
    switch (action) {
      case "reset-founder-signals-5plus": {
        const db2 = getDb();
        const result = db2.prepare(
          `DELETE FROM founder_profiles
           WHERE lead_id IN (SELECT lead_id FROM scoring_data WHERE score >= 5)`
        ).run();
        return NextResponse.json({ cleared: result.changes });
      }
      case "reset-outreach-7plus": {
        const result = db.prepare(
          `UPDATE leads SET enrichment_status = 'scored', updated_at = datetime('now')
           WHERE enrichment_status = 'outreach_generated'
             AND id IN (SELECT lead_id FROM scoring_data WHERE score >= 7)`
        ).run();
        return NextResponse.json({ reset: result.changes });
      }
      case "reset-xray": {
        // Reset ALL failed/stuck X-Ray leads back to pending for website discovery
        const result = db.prepare(
          `UPDATE leads SET enrichment_status = 'pending', updated_at = datetime('now')
           WHERE source = 'linkedin_xray'
             AND enrichment_status IN ('no_website', 'scrape_failed', 'enrich_failed')`
        ).run();
        return NextResponse.json({ reset: result.changes });
      }
      case "reset-scrape-failed": {
        const result = db.prepare(
          `UPDATE leads SET enrichment_status = 'pending', updated_at = datetime('now')
           WHERE enrichment_status = 'scrape_failed'`
        ).run();
        return NextResponse.json({ reset: result.changes });
      }
      case "reset-enrich-failed": {
        const result = db.prepare(
          `UPDATE leads SET enrichment_status = 'scraped', updated_at = datetime('now')
           WHERE enrichment_status = 'enrich_failed'`
        ).run();
        return NextResponse.json({ reset: result.changes });
      }
      case "reset-all-failed": {
        // Reset every failed state back to its appropriate re-entry point
        const scrapeFailed = db.prepare(
          `UPDATE leads SET enrichment_status = 'pending', updated_at = datetime('now')
           WHERE enrichment_status IN ('scrape_failed', 'no_website', 'pre_filtered', 'icp_rejected')`
        ).run();
        const enrichFailed = db.prepare(
          `UPDATE leads SET enrichment_status = 'scraped', updated_at = datetime('now')
           WHERE enrichment_status = 'enrich_failed'`
        ).run();
        const scoreFailed = db.prepare(
          `UPDATE leads SET enrichment_status = 'enriched', updated_at = datetime('now')
           WHERE enrichment_status = 'score_failed'`
        ).run();
        const outreachFailed = db.prepare(
          `UPDATE leads SET enrichment_status = 'scored', updated_at = datetime('now')
           WHERE enrichment_status = 'outreach_failed'`
        ).run();
        const total = scrapeFailed.changes + enrichFailed.changes + scoreFailed.changes + outreachFailed.changes;
        return NextResponse.json({ reset: total, breakdown: {
          scrape_failed: scrapeFailed.changes,
          enrich_failed: enrichFailed.changes,
          score_failed: scoreFailed.changes,
          outreach_failed: outreachFailed.changes,
        }});
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
