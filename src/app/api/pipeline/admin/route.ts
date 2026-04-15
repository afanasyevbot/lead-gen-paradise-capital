/**
 * POST /api/pipeline/admin
 *
 * Admin actions that manipulate lead state without running the full pipeline:
 *   - retry_scrape_failed: flip stale scrape_failed → pending so they get retried
 *   - backfill_linkedin:   flip eligible leads back so LinkedIn stage picks them up
 *   - delete_noisy:        remove parse-failure / noise-token leads
 *
 * body: { action: "retry_scrape_failed" | "backfill_linkedin" | "delete_noisy" }
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();
  const now = new Date().toISOString();

  if (action === "retry_scrape_failed") {
    const res = db.prepare(`
      UPDATE leads
      SET enrichment_status = 'pending', updated_at = ?
      WHERE enrichment_status = 'scrape_failed'
        AND updated_at < datetime('now', '-7 days')
        AND website IS NOT NULL AND website != ''
    `).run(now);
    return NextResponse.json({ ok: true, action, affected: res.changes });
  }

  if (action === "backfill_linkedin") {
    // Leads that are scraped/enriched/scored but have no linkedin_data row yet.
    // Flip back to 'scraped' so stage 16 (linkedinProfileStage) picks them up.
    const res = db.prepare(`
      UPDATE leads
      SET enrichment_status = 'scraped', updated_at = ?
      WHERE id IN (
        SELECT l.id FROM leads l
        LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
        WHERE l.enrichment_status IN ('scraped','enriched','scored')
          AND ld.lead_id IS NULL
      )
    `).run(now);
    return NextResponse.json({ ok: true, action, affected: res.changes });
  }

  if (action === "delete_noisy") {
    // Find IDs of noise-name leads
    const rows = db.prepare(`
      SELECT id FROM leads
      WHERE lower(trim(business_name)) IN ('linkedin','google','facebook','-','','n/a','unknown')
    `).all() as { id: number }[];
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return NextResponse.json({ ok: true, action, affected: 0 });

    const placeholders = ids.map(() => "?").join(",");
    const FK_TABLES = [
      "scraped_content","enrichment_data","scoring_data","outreach_data","linkedin_data",
      "social_signals","content_hooks_raw","social_intros","content_hooks","founder_profiles",
      "succession_news","legacy_outreach","succession_audits","tenure_legacy_emails","founder_emails",
      "email_candidates","email_enrichment_runs","outreach_outcomes","lead_costs",
    ];
    const tx = db.transaction(() => {
      for (const t of FK_TABLES) {
        try { db.prepare(`DELETE FROM ${t} WHERE lead_id IN (${placeholders})`).run(...ids); }
        catch { /* table may not exist */ }
      }
      db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();
    return NextResponse.json({ ok: true, action, affected: ids.length });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
