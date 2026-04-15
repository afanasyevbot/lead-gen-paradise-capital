/**
 * POST /api/pipeline/admin
 *
 * Admin actions that manipulate lead state without running the full pipeline:
 *   - retry_scrape_failed: flip stale scrape_failed → pending so they get retried
 *   - backfill_linkedin:   flip eligible leads back so LinkedIn stage picks them up
 *   - delete_noisy:        remove parse-failure / noise-token leads
 *   - rescan_emails:       re-run the website harvester over already-scraped content
 *
 * body: { action: "retry_scrape_failed" | "backfill_linkedin" | "delete_noisy" | "rescan_emails" }
 *
 * Auth: requires header `x-admin-secret: $ADMIN_SECRET` (env). If ADMIN_SECRET is
 * unset, the route accepts localhost-only requests so local development works.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { harvestContactsFromStored } from "@/lib/scraper/email-harvester";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (expected && expected.length > 0) {
    const got = req.headers.get("x-admin-secret");
    return got === expected;
  }
  // No secret configured — allow only loopback requests (local dev).
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    const rows = db.prepare(`
      SELECT id FROM leads
      WHERE lower(trim(business_name)) IN ('linkedin','google','facebook','-','','n/a','unknown')
    `).all() as { id: number }[];
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return NextResponse.json({ ok: true, action, affected: 0 });

    const placeholders = ids.map(() => "?").join(",");
    // Discover FK tables at runtime instead of hardcoding — any per-lead table
    // declared with REFERENCES leads(id) is included. Future-proof.
    const fkTables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name != 'leads' AND sql LIKE '%REFERENCES leads%'`
      )
      .all() as { name: string }[];

    const tx = db.transaction(() => {
      for (const t of fkTables) {
        try { db.prepare(`DELETE FROM ${t.name} WHERE lead_id IN (${placeholders})`).run(...ids); }
        catch { /* column may not exist on this table */ }
      }
      db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();
    return NextResponse.json({ ok: true, action, affected: ids.length, fkTablesCleaned: fkTables.length });
  }

  if (action === "rescan_emails") {
    // Re-run the harvester over already-scraped content so existing leads
    // get emails_found populated without re-invoking Playwright.
    // NOTE filter now also excludes rows last rescanned recently (avoids the
    // "click-forever" loop where 0-hit rows keep being re-scanned).
    const rows = db.prepare(`
      SELECT sc.lead_id, sc.homepage_text, sc.about_text, sc.all_text
      FROM scraped_content sc
      WHERE sc.emails_found IS NULL
        AND (sc.homepage_text IS NOT NULL OR sc.all_text IS NOT NULL)
      LIMIT 2000
    `).all() as {
      lead_id: number;
      homepage_text: string | null;
      about_text: string | null;
      all_text: string | null;
    }[];

    const upd = db.prepare(
      "UPDATE scraped_content SET emails_found = ?, phones_found = COALESCE(phones_found, '[]') WHERE lead_id = ?"
    );

    let updated = 0;
    let hitsWithEmails = 0;
    let emailsFound = 0;
    const tx = db.transaction(() => {
      for (const r of rows) {
        const text = [r.homepage_text, r.about_text, r.all_text].filter(Boolean).join("\n");
        if (!text) continue;
        const { emails } = harvestContactsFromStored("", text);
        // Always write the result (even '[]') so this row isn't re-scanned
        // next time the button is clicked. That's the whole point — no
        // unbounded self-loop.
        upd.run(JSON.stringify(emails), r.lead_id);
        updated++;
        if (emails.length > 0) {
          hitsWithEmails++;
          emailsFound += emails.length;
        }
      }
    });
    tx();
    return NextResponse.json({
      ok: true, action,
      affected: updated,
      hitsWithEmails,
      emailsFound,
      scanned: rows.length,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
