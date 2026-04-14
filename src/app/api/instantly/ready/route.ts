import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/instantly/ready
 *
 * Returns leads that are ready to push to Instantly:
 *   - enrichment_status = 'outreach_generated'
 *   - have a founder email (from founder_emails waterfall)
 *   - sent_at IS NULL (not yet pushed)
 */
export async function GET() {
  try {
    const db = getDb();

    // Ensure sent_at column exists (safe migration)
    try {
      db.prepare("ALTER TABLE outreach_data ADD COLUMN sent_at TEXT").run();
    } catch { /* column already exists */ }
    try {
      db.prepare("ALTER TABLE outreach_data ADD COLUMN sent_campaign_id TEXT").run();
    } catch { /* column already exists */ }

    const rows = db.prepare(`
      SELECT
        l.id,
        l.business_name,
        l.city,
        l.state,
        fe.email        AS owner_email,
        fe.owner_name   AS owner_name,
        sd.score        AS score
      FROM leads l
      JOIN outreach_data od ON od.lead_id = l.id
      LEFT JOIN founder_emails fe ON fe.lead_id = l.id AND fe.email IS NOT NULL
      LEFT JOIN scoring_data sd ON sd.lead_id = l.id
      WHERE l.enrichment_status = 'outreach_generated'
        AND fe.email IS NOT NULL
        AND (od.sent_at IS NULL)
      ORDER BY COALESCE(sd.score, 0) DESC, l.business_name ASC
    `).all() as {
      id: number;
      business_name: string;
      city: string | null;
      state: string | null;
      owner_email: string | null;
      owner_name: string | null;
      score: number | null;
    }[];

    return NextResponse.json({ leads: rows, total: rows.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
