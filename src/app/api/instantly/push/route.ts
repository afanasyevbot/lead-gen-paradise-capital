import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pushLeadsBulk, dbLeadToInstantlyLead } from "@/lib/instantly";
import { createSuppressionTable, bulkCheckSuppression } from "@/lib/suppression";

/**
 * POST /api/instantly/push
 *
 * Push one or more leads to an Instantly campaign.
 * Body: { campaignId: string, leadIds: number[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { campaignId, leadIds } = body as {
      campaignId: string;
      leadIds: number[];
    };

    if (!campaignId) {
      return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
    }
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: "leadIds array is required" }, { status: 400 });
    }

    const db = getDb();
    const placeholders = leadIds.map(() => "?").join(",");

    const rows = db.prepare(`
      SELECT l.id, l.business_name, l.phone, l.website, l.city, l.state,
             ed.data as enrichment_json,
             sd.data as scoring_json,
             od.outreach_json,
             od.sent_at as already_sent_at,
             od.sent_campaign_id as already_sent_campaign_id,
             fe.email as waterfall_email,
             fe.owner_name as waterfall_owner_name
      FROM leads l
      LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
      LEFT JOIN scoring_data sd ON sd.lead_id = l.id
      LEFT JOIN outreach_data od ON od.lead_id = l.id
      LEFT JOIN founder_emails fe ON fe.lead_id = l.id AND fe.email IS NOT NULL
      WHERE l.id IN (${placeholders})
        AND (od.sent_at IS NULL OR od.lead_id IS NULL)
    `).all(...leadIds) as {
      id: number;
      business_name: string;
      phone: string | null;
      website: string | null;
      city: string | null;
      state: string | null;
      enrichment_json: string | null;
      scoring_json: string | null;
      outreach_json: string | null;
      already_sent_at: string | null;
      already_sent_campaign_id: string | null;
      waterfall_email: string | null;
      waterfall_owner_name: string | null;
    }[];

    // Convert DB rows to Instantly leads
    const instantlyLeads = [];
    const skipped: { id: number; name: string; reason: string }[] = [];

    for (const row of rows) {
      // Fix #7: Skip leads already pushed to Instantly — idempotency guard
      if (row.already_sent_at) {
        skipped.push({
          id: row.id,
          name: row.business_name,
          reason: `Already sent on ${row.already_sent_at} to campaign ${row.already_sent_campaign_id ?? "unknown"}`,
        });
        continue;
      }

      const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : null;
      const scoring = row.scoring_json ? JSON.parse(row.scoring_json) : null;
      const outreach = row.outreach_json ? JSON.parse(row.outreach_json) : null;

      // Prefer waterfall-found email over Claude-extracted email
      // (waterfall is verified; extracted email is scraped from website text and unverified)
      const effectiveEnrichment = enrichment
        ? {
            ...enrichment,
            owner_email: row.waterfall_email || enrichment.owner_email || null,
            owner_name: enrichment.owner_name || row.waterfall_owner_name || null,
          }
        : row.waterfall_email
          ? { owner_email: row.waterfall_email, owner_name: row.waterfall_owner_name }
          : null;

      const lead = dbLeadToInstantlyLead(
        { business_name: row.business_name, phone: row.phone, website: row.website, city: row.city, state: row.state },
        effectiveEnrichment,
        scoring,
        outreach,
      );

      if (lead) {
        instantlyLeads.push(lead);
      } else {
        skipped.push({
          id: row.id,
          name: row.business_name,
          reason: "No email found (checked enrichment data and waterfall results)",
        });
      }
    }

    if (instantlyLeads.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No leads have owner emails — cannot push to Instantly without email addresses",
        skipped,
      }, { status: 400 });
    }

    // Check suppression list
    createSuppressionTable(db);
    const allEmails = instantlyLeads.map(l => l.email);
    const suppressedEmails = bulkCheckSuppression(db, allEmails);

    const suppressed: { email: string; reason: string }[] = [];
    const cleanLeads = instantlyLeads.filter(l => {
      if (suppressedEmails.has(l.email.toLowerCase())) {
        suppressed.push({ email: l.email, reason: "Email on suppression list" });
        return false;
      }
      return true;
    });

    if (cleanLeads.length === 0) {
      return NextResponse.json({
        success: false,
        error: "All leads with emails are on the suppression list",
        skipped,
        suppressed,
      }, { status: 400 });
    }

    const result = await pushLeadsBulk(campaignId, cleanLeads);

    // Stamp sent_at on outreach_data for every lead that was successfully sent
    if (result.success) {
      const sentEmails = new Set(cleanLeads.map(l => l.email.toLowerCase()));
      const sentRows = rows.filter(r => {
        const email = (r.waterfall_email || (r.enrichment_json ? JSON.parse(r.enrichment_json).owner_email : null) || "").toLowerCase();
        return sentEmails.has(email);
      });
      const stamp = db.prepare(
        `UPDATE outreach_data SET sent_at = datetime('now'), sent_campaign_id = ? WHERE lead_id = ?`
      );
      for (const r of sentRows) {
        try { stamp.run(campaignId, r.id); } catch { /* best-effort */ }
      }
    }

    return NextResponse.json({
      ...result,
      skipped,
      suppressed,
      total_requested: leadIds.length,
      total_with_email: instantlyLeads.length,
      total_after_suppression: cleanLeads.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
