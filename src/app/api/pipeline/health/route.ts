/**
 * GET /api/pipeline/health
 *
 * Surfaces coverage gaps, funnel leaks, and attention-required items so the
 * UI can warn the user when a stage is silently under-performing.
 *
 * Covers:
 *   - Stage coverage: what % of prerequisite leads have the next-stage data
 *   - Funnel leak: scored → outreach conversion + leak reasons
 *   - Attention queue: data-integrity issues worth a human look
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  // ─── Stage coverage ────────────────────────────────────────────────
  // For each major stage, compare "leads eligible" vs "leads that have data"
  const scraped = (db.prepare("SELECT COUNT(*) as c FROM scraped_content").get() as { c: number }).c;
  const enriched = (db.prepare("SELECT COUNT(*) as c FROM enrichment_data").get() as { c: number }).c;
  const scored = (db.prepare("SELECT COUNT(*) as c FROM scoring_data").get() as { c: number }).c;
  const outreach = (db.prepare("SELECT COUNT(*) as c FROM outreach_data").get() as { c: number }).c;
  const linkedin = (db.prepare("SELECT COUNT(*) as c FROM linkedin_data").get() as { c: number }).c;
  const emailsFound = (db.prepare(
    "SELECT COUNT(*) as c FROM founder_emails WHERE status = 'found'"
  ).get() as { c: number }).c;
  const emailsAttempted = (db.prepare(
    "SELECT COUNT(*) as c FROM founder_emails"
  ).get() as { c: number }).c;

  const totalLeads = (db.prepare("SELECT COUNT(*) as c FROM leads").get() as { c: number }).c;
  const leadsWithWebsite = (db.prepare(
    "SELECT COUNT(*) as c FROM leads WHERE website IS NOT NULL AND website != ''"
  ).get() as { c: number }).c;

  const stages = [
    { name: "scrape", have: scraped, eligible: leadsWithWebsite, warnBelow: 0.8 },
    { name: "linkedin", have: linkedin, eligible: scraped, warnBelow: 0.5 },
    { name: "enrich", have: enriched, eligible: scraped, warnBelow: 0.9 },
    { name: "score", have: scored, eligible: enriched, warnBelow: 0.95 },
    { name: "email", have: emailsFound, eligible: scored, warnBelow: 0.3 },
    { name: "outreach", have: outreach, eligible: scored, warnBelow: 0.2 },
  ].map((s) => ({
    ...s,
    pct: s.eligible > 0 ? s.have / s.eligible : 0,
    warn: s.eligible > 0 && s.have / s.eligible < s.warnBelow,
  }));

  // ─── Funnel leak: scored → outreach ──────────────────────────────
  const funnelStatuses = db.prepare(`
    SELECT enrichment_status, COUNT(*) as c
    FROM leads
    GROUP BY enrichment_status
  `).all() as { enrichment_status: string; c: number }[];
  const byStatus: Record<string, number> = {};
  for (const r of funnelStatuses) byStatus[r.enrichment_status] = r.c;

  const funnel = {
    scored: byStatus.scored ?? 0,
    outreach_generated: byStatus.outreach_generated ?? 0,
    outreach_failed: byStatus.outreach_failed ?? 0,
    conversion_pct: (byStatus.scored ?? 0) > 0
      ? (byStatus.outreach_generated ?? 0) / ((byStatus.scored ?? 0) + (byStatus.outreach_generated ?? 0))
      : 0,
    stuck_in_scored: byStatus.scored ?? 0,
  };

  // ─── Attention queue ────────────────────────────────────────────
  const noisyNames = (db.prepare(`
    SELECT COUNT(*) as c FROM leads
    WHERE lower(business_name) IN ('linkedin','google','facebook','-','','n/a','unknown')
       OR business_name LIKE '%— %(%Florida%)'
  `).get() as { c: number }).c;

  const staleScrapeFailed = (db.prepare(`
    SELECT COUNT(*) as c FROM leads
    WHERE enrichment_status = 'scrape_failed'
      AND updated_at < datetime('now', '-7 days')
  `).get() as { c: number }).c;

  const unverifiedFounders = (db.prepare(`
    SELECT COUNT(*) as c FROM enrichment_data ed
    JOIN leads l ON l.id = ed.lead_id
    WHERE json_extract(ed.data, '$.is_likely_founder') = 1
      AND (json_extract(ed.data, '$.founder_evidence') IS NULL
           OR length(json_extract(ed.data, '$.founder_evidence')) < 10)
  `).get() as { c: number }).c;

  const lowConfHighScore = (db.prepare(`
    SELECT COUNT(*) as c FROM scoring_data
    WHERE confidence = 'low' AND score >= 6
  `).get() as { c: number }).c;

  const attention = {
    noisy_names: noisyNames,
    stale_scrape_failed: staleScrapeFailed,
    unverified_founders: unverifiedFounders,
    low_conf_high_score: lowConfHighScore,
    emails_not_found: emailsAttempted - emailsFound,
    email_miss_rate: emailsAttempted > 0 ? (emailsAttempted - emailsFound) / emailsAttempted : 0,
  };

  return NextResponse.json({
    total_leads: totalLeads,
    stages,
    funnel,
    attention,
    byStatus,
  });
}
