import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/dedup-stats
 *
 * Returns a summary of duplicate leads detected during scraping.
 * Shows which query/location combos produce the most overlap, and which
 * businesses are discovered by multiple queries.
 *
 * Query params:
 *   ?since=2026-04-28        — filter to a specific date (ISO prefix)
 *   ?limit=50                — top-N businesses by dupe count (default 50)
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const p = req.nextUrl.searchParams;
    const since = p.get("since") || null;
    const limit = Math.min(Number(p.get("limit") || 50), 200);

    const dateFilter = since ? `AND ts >= ?` : "";
    const dateParam = since ? [since] : [];

    // Overall summary
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_dupes,
        SUM(CASE WHEN matched_by = 'place_id' THEN 1 ELSE 0 END) as place_id_matches,
        SUM(CASE WHEN matched_by = 'normalized_key' THEN 1 ELSE 0 END) as normalized_key_matches,
        COUNT(DISTINCT existing_lead_id) as unique_leads_with_dupes
      FROM dedup_log
      WHERE 1=1 ${dateFilter}
    `).get(...dateParam) as {
      total_dupes: number;
      place_id_matches: number;
      normalized_key_matches: number;
      unique_leads_with_dupes: number;
    };

    // Which query+location combos produced the most dupes
    const byQuery = db.prepare(`
      SELECT incoming_query, incoming_location, COUNT(*) as dupes
      FROM dedup_log
      WHERE 1=1 ${dateFilter}
      GROUP BY incoming_query, incoming_location
      ORDER BY dupes DESC
      LIMIT ?
    `).all(...dateParam, limit) as { incoming_query: string; incoming_location: string; dupes: number }[];

    // Which businesses were found most often (hit by multiple queries)
    const topBusinesses = db.prepare(`
      SELECT d.business_name, l.city, l.state, COUNT(*) as duplicate_hits,
             GROUP_CONCAT(d.incoming_query, ' | ') as found_by_queries
      FROM dedup_log d
      LEFT JOIN leads l ON l.id = d.existing_lead_id
      WHERE 1=1 ${dateFilter}
      GROUP BY d.existing_lead_id
      ORDER BY duplicate_hits DESC
      LIMIT ?
    `).all(...dateParam, limit) as {
      business_name: string;
      city: string;
      state: string;
      duplicate_hits: number;
      found_by_queries: string;
    }[];

    // New vs dupe rate today
    const totalLeads = (db.prepare("SELECT COUNT(*) as c FROM leads").get() as { c: number }).c;
    const dupeRate = summary.total_dupes > 0
      ? ((summary.total_dupes / (totalLeads + summary.total_dupes)) * 100).toFixed(1)
      : "0.0";

    return NextResponse.json({
      summary: { ...summary, total_leads_in_db: totalLeads, dupe_rate_pct: dupeRate },
      by_query: byQuery,
      top_businesses: topBusinesses,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
