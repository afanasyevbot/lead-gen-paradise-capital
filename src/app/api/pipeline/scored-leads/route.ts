import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/pipeline/scored-leads?since=<ISO timestamp>
 * Returns individual lead scores for leads scored during this run.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  // Use `limit` (count of leads scored this run) to fetch the most recently
  // scored N leads — avoids all timestamp format comparison issues.
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10))) : 100;
  const since = req.nextUrl.searchParams.get("since"); // ISO timestamp

  // When `since` is provided, scope results to leads scored AFTER that
  // timestamp — the dashboard passes the run's start time so we only show
  // leads from the current pipeline execution, not every historical lead.
  const rows = since
    ? db.prepare(`
        SELECT
          l.id, l.business_name, l.website, l.city, l.state,
          sd.score, sd.confidence, sd.recommended_action,
          sd.data as score_data,
          ed.data as enrichment_data
        FROM scoring_data sd
        JOIN leads l ON l.id = sd.lead_id
        LEFT JOIN enrichment_data ed ON ed.lead_id = sd.lead_id
        WHERE sd.created_at >= ?
        ORDER BY sd.created_at DESC
        LIMIT ?
      `).all(since, limit) as RawRow[]
    : db.prepare(`
        SELECT
          l.id, l.business_name, l.website, l.city, l.state,
          sd.score, sd.confidence, sd.recommended_action,
          sd.data as score_data,
          ed.data as enrichment_data
        FROM scoring_data sd
        JOIN leads l ON l.id = sd.lead_id
        LEFT JOIN enrichment_data ed ON ed.lead_id = sd.lead_id
        ORDER BY sd.created_at DESC
        LIMIT ?
      `).all(limit) as RawRow[];

  const leads = rows.map((row) => {
    let scoreData: Record<string, unknown> = {};
    let enrichData: Record<string, unknown> = {};
    try { scoreData = JSON.parse(row.score_data ?? "{}"); } catch { /* ignore */ }
    try { enrichData = JSON.parse(row.enrichment_data ?? "{}"); } catch { /* ignore */ }

    return {
      id: row.id,
      business_name: row.business_name,
      website: row.website,
      city: row.city,
      state: row.state,
      score: row.score,
      confidence: row.confidence,
      recommended_action: row.recommended_action,
      avatar_fit: scoreData.avatar_fit as string | undefined,
      reasoning: scoreData.reasoning as string | undefined,
      primary_signals: scoreData.primary_signals as string[] | undefined,
      risk_factors: scoreData.risk_factors as string[] | undefined,
      owner_name: (enrichData.owner_name ?? scoreData.owner_name) as string | undefined,
      estimated_owner_age: scoreData.estimated_owner_age as string | undefined,
      estimated_revenue_range: scoreData.estimated_revenue_range as string | undefined,
      is_likely_founder: scoreData.is_likely_founder as boolean | undefined,
    };
  });

  return NextResponse.json({ leads });
}

interface RawRow {
  id: number;
  business_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  score: number;
  confidence: string;
  recommended_action: string;
  score_data: string | null;
  enrichment_data: string | null;
}
