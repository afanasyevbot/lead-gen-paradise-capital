import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/admin/weekly-report
//
// Invoked by the Railway "weekly-report-cron" service on a weekly schedule.
// Queries the live paradise_leads.db for past-7-day activity and posts a
// summary to Slack via SLACK_WEBHOOK_URL.
//
// Auth: requires `Authorization: Bearer $REPORT_TOKEN` header matching the
// REPORT_TOKEN env var on this service.

export const dynamic = "force-dynamic";

async function postToSlack(webhook: string, text: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

type ErrorRow = { enrichment_status: string; c: number };

function buildReport(stats: {
  total: number;
  scraped: number;
  enriched: number;
  exported: number;
  errors: ErrorRow[];
  stale: number;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  const errorsLine = stats.errors.length
    ? stats.errors.map((e) => `   • \`${e.enrichment_status}\`: ${e.c}`).join("\n")
    : "   • None ✅";

  const errorIcon = stats.errors.length ? "⚠️" : "✅";
  const staleIcon = stats.stale > 0 ? "⚠️" : "✅";
  const overallHealthy = stats.errors.length === 0 && stats.stale === 0;

  return [
    `📊 *Lead Gen Pipeline Report — ${date} (Past 7 Days)*`,
    ``,
    `*Database:* \`paradise_leads.db\` (${stats.total} total leads)`,
    ``,
    `✅ *Leads Scraped:* ${stats.scraped}`,
    `✅ *Leads Enriched:* ${stats.enriched}`,
    `✅ *Leads Exported (outreach generated):* ${stats.exported}`,
    ``,
    `${errorIcon} *Errors:* ${stats.errors.reduce((a, e) => a + e.c, 0)} leads in error state`,
    errorsLine,
    ``,
    `${staleIcon} *Pipeline Health — Stale Leads:* ${stats.stale} leads sitting in \`pending\` status for 7+ days`,
    ``,
    overallHealthy
      ? `*Overall status:* ✅ Pipeline is healthy across all stages.`
      : `*Overall status:* ⚠️ Pipeline is running but has items to clean up above.`,
  ].join("\n");
}

export async function POST(req: Request) {
  const expected = process.env.REPORT_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "REPORT_TOKEN not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      { error: "SLACK_WEBHOOK_URL not configured" },
      { status: 500 },
    );
  }

  try {
    const db = getDb();
    const stats = {
      total: (db.prepare("SELECT COUNT(*) as c FROM leads").get() as { c: number }).c,
      scraped: (db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE datetime(created_at) >= datetime('now','-7 days')",
        )
        .get() as { c: number }).c,
      enriched: (db
        .prepare(
          "SELECT COUNT(*) as c FROM enrichment_data WHERE datetime(created_at) >= datetime('now','-7 days')",
        )
        .get() as { c: number }).c,
      exported: (db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE enrichment_status='outreach_generated' AND datetime(updated_at) >= datetime('now','-7 days')",
        )
        .get() as { c: number }).c,
      errors: db
        .prepare(
          "SELECT enrichment_status, COUNT(*) as c FROM leads WHERE enrichment_status LIKE '%failed%' GROUP BY enrichment_status",
        )
        .all() as ErrorRow[],
      stale: (db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE enrichment_status='pending' AND datetime(created_at) <= datetime('now','-7 days')",
        )
        .get() as { c: number }).c,
    };

    if (stats.total === 0) {
      const msg =
        `🚨 *Lead Gen Pipeline Report — ${new Date().toISOString().slice(0, 10)}*\n\n` +
        `❌ *Database is empty* — no leads found.`;
      await postToSlack(webhook, msg);
      return NextResponse.json({ ok: false, reason: "empty-db" }, { status: 200 });
    }

    const text = buildReport(stats);
    await postToSlack(webhook, text);
    return NextResponse.json({ ok: true, stats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    try {
      await postToSlack(
        webhook,
        `🚨 *Lead Gen Weekly Report Failed*\n\`\`\`${message}\`\`\``,
      );
    } catch {
      /* webhook itself failed — already logged */
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
