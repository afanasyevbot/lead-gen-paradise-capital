#!/usr/bin/env node
/**
 * Weekly Lead Gen Pipeline Report
 *
 * Queries the paradise_leads.db for the past 7 days of activity and posts
 * a summary to Slack via an incoming webhook.
 *
 * Runs as a standalone Railway cron service. Does NOT touch the main app —
 * opens the DB read-only so it cannot corrupt data.
 *
 * Required env vars:
 *   SLACK_WEBHOOK_URL  Slack incoming webhook posting to #lead-gen
 *   DATABASE_PATH      (optional) defaults to /data/paradise_leads.db
 */

import Database from "better-sqlite3";

const DB_PATH = process.env.DATABASE_PATH || "/data/paradise_leads.db";
const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function postToSlack(text) {
  if (!WEBHOOK_URL) {
    console.error("SLACK_WEBHOOK_URL not set — skipping Slack post");
    console.log(text);
    return;
  }
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

function buildHealthyReport(stats) {
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

async function main() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    await postToSlack(
      `🚨 *Lead Gen Pipeline Report — ${new Date().toISOString().slice(0, 10)}*\n\n` +
        `❌ *Database Error:* Could not open \`${DB_PATH}\`\n` +
        `\`\`\`${err.message}\`\`\``,
    );
    process.exit(1);
  }

  try {
    const stats = {
      total: db.prepare("SELECT COUNT(*) as c FROM leads").get().c,
      scraped: db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE datetime(created_at) >= datetime('now','-7 days')",
        )
        .get().c,
      enriched: db
        .prepare(
          "SELECT COUNT(*) as c FROM enrichment_data WHERE datetime(created_at) >= datetime('now','-7 days')",
        )
        .get().c,
      exported: db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE enrichment_status='outreach_generated' AND datetime(updated_at) >= datetime('now','-7 days')",
        )
        .get().c,
      errors: db
        .prepare(
          "SELECT enrichment_status, COUNT(*) as c FROM leads WHERE enrichment_status LIKE '%failed%' GROUP BY enrichment_status",
        )
        .all(),
      stale: db
        .prepare(
          "SELECT COUNT(*) as c FROM leads WHERE enrichment_status='pending' AND datetime(created_at) <= datetime('now','-7 days')",
        )
        .get().c,
    };

    if (stats.total === 0) {
      await postToSlack(
        `🚨 *Lead Gen Pipeline Report — ${new Date().toISOString().slice(0, 10)}*\n\n` +
          `❌ *Database is empty* — no leads found in \`${DB_PATH}\`.`,
      );
      process.exit(1);
    }

    await postToSlack(buildHealthyReport(stats));
    console.log("Weekly report posted to Slack");
  } finally {
    db.close();
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await postToSlack(
      `🚨 *Lead Gen Weekly Report Failed*\n\`\`\`${err.stack || err.message}\`\`\``,
    );
  } catch {
    /* webhook itself failed — already logged */
  }
  process.exit(1);
});
