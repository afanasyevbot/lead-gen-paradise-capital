import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/pipeline/scored-leads?since=<ISO timestamp>
 * Returns individual lead scores for leads scored during this run.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const sinceRaw = req.nextUrl.searchParams.get("since");
  // Normalize ISO 8601 → SQLite datetime format so string comparisons work
  const since = sinceRaw
    ? sinceRaw.replace("T", " ").replace(/\.\d{3}Z$/, "").replace("Z", "")
    : null;

  const query = since
    ? `
      SELECT
        l.id,
        l.business_name,
        l.website,
        l.city,
        l.state,
        sd.score,
        sd.confidence,
        sd.recommended_action,
        sd.data as score_data,
        ed.data as enrichment_data
      FROM scoring_data sd
      JOIN leads l ON l.id = sd.lead_id
      LEFT JOIN enrichment_data ed ON ed.lead_id = sd.lead_id
      WHERE sd.created_at >= ?
      ORDER BY sd.score DESC, l.business_name ASC
    `
    : `
      SELECT
        l.id,
        l.business_name,
        l.website,
        l.city,
        l.state,
        sd.score,
        sd.confidence,
        sd.recommended_action,
        sd.data as score_data,
        ed.data as enrichment_data
      FROM scoring_data sd
      JOIN leads l ON l.id = sd.lead_id
      LEFT JOIN enrichment_data ed ON ed.lead_id = sd.lead_id
      ORDER BY sd.score DESC, l.business_name ASC
      LIMIT 100
    `;

  const rows = since
    ? (db.prepare(query).all(since) as RawRow[])
    : (db.prepare(query).all() as RawRow[]);

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
