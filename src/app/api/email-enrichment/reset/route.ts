import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * POST /api/email-enrichment/reset
 *
 * Fix #6: Clears stale email_enrichment_runs records so leads can be
 * re-enriched with current API keys.
 *
 * Body (all optional):
 *   { mode?: "stale", leadIds?: number[], olderThanDays?: number, statusFilter?: string }
 *
 * - mode "stale": DELETE all runs where the lead has no email_candidates rows
 * - leadIds: reset specific leads by ID
 * - olderThanDays: reset runs older than N days (default 30)
 * - statusFilter: only reset leads in this enrichment_status (default: 'enriched')
 *
 * Returns: { reset: number, message: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      mode,
      leadIds,
      olderThanDays = 30,
      statusFilter = "enriched",
    } = body as {
      mode?: string;
      leadIds?: number[];
      olderThanDays?: number;
      statusFilter?: string;
    };

    const db = getDb();

    let result: { changes: number };

    if (mode === "stale") {
      // Delete runs where the waterfall found nothing (no email_candidates rows)
      // so those leads will be retried with current API keys.
      result = db.prepare(
        `DELETE FROM email_enrichment_runs
         WHERE lead_id IN (
           SELECT ler.lead_id
           FROM email_enrichment_runs ler
           LEFT JOIN email_candidates ec ON ec.lead_id = ler.lead_id
           WHERE ec.id IS NULL
         )`
      ).run() as { changes: number };

      return NextResponse.json({
        reset: result.changes,
        message: result.changes > 0
          ? `Cleared ${result.changes} stale enrichment run(s) with no email candidates. These leads will be re-enriched on next waterfall pass.`
          : "No stale enrichment runs found (all runs have at least one email candidate).",
      });
    } else if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
      // Reset specific leads by ID
      const placeholders = leadIds.map(() => "?").join(",");
      result = db.prepare(
        `DELETE FROM email_enrichment_runs WHERE lead_id IN (${placeholders})`
      ).run(...leadIds) as { changes: number };
    } else {
      // Reset by age + status — leads that have runs but no good email
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      result = db.prepare(
        `DELETE FROM email_enrichment_runs
         WHERE created_at < ?
           AND lead_id IN (
             SELECT l.id FROM leads l
             WHERE l.enrichment_status = ?
           )`
      ).run(cutoffDate, statusFilter) as { changes: number };
    }

    return NextResponse.json({
      reset: result.changes,
      message: result.changes > 0
        ? `Cleared ${result.changes} stale enrichment run(s). These leads will be re-enriched on next waterfall pass.`
        : "No matching enrichment runs found to reset.",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/email-enrichment/reset
 *
 * Diagnostic: find leads that have enrichment runs but no email candidates
 * (the classic stale-cache symptom).
 */
export async function GET() {
  try {
    const db = getDb();

    const staleLeads = db.prepare(
      `SELECT ler.lead_id, ler.providers_attempted, ler.best_email,
              ler.created_at as run_date, l.enrichment_status, l.business_name
       FROM email_enrichment_runs ler
       LEFT JOIN email_candidates ec ON ec.lead_id = ler.lead_id
       JOIN leads l ON l.id = ler.lead_id
       WHERE ec.id IS NULL
         AND l.enrichment_status NOT IN ('icp_rejected', 'pre_filtered', 'no_website')
       ORDER BY ler.created_at DESC
       LIMIT 100`
    ).all() as {
      lead_id: number;
      providers_attempted: string;
      best_email: string | null;
      run_date: string;
      enrichment_status: string;
      business_name: string;
    }[];

    return NextResponse.json({
      stale_count: staleLeads.length,
      leads: staleLeads,
      hint: staleLeads.length > 0
        ? "POST to this endpoint to clear stale runs and allow re-enrichment."
        : "No stale enrichment cache found.",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
