import { NextRequest, NextResponse } from "next/server";
import { getLeadDetail, getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lead = getLeadDetail(Number(id));
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/leads/[id] — remove a lead and all related data */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leadId = Number(id);
    const db = getDb();

    // Check lead exists
    const lead = db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId);
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Delete all related data
    const tables = [
      "scraped_content", "enrichment_data", "scoring_data", "outreach_data",
      "linkedin_data",
    ];
    // Optional tables (may not exist yet)
    const optionalTables = [
      "social_intros", "content_hooks", "social_signals", "founder_profiles",
      "succession_news", "legacy_outreach", "succession_audits", "tenure_legacy_emails",
      "founder_emails",
    ];

    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE lead_id = ?`).run(leadId);
    }
    for (const table of optionalTables) {
      try { db.prepare(`DELETE FROM ${table} WHERE lead_id = ?`).run(leadId); } catch { /* table may not exist */ }
    }
    db.prepare("DELETE FROM leads WHERE id = ?").run(leadId);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** PATCH /api/leads/[id] — reset enrichment (clear pipeline data, set status back) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leadId = Number(id);
    const db = getDb();
    const body = await req.json();

    const lead = db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId);
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (body.action === "reset") {
      // Clear all enrichment data but keep the lead and scraped content
      const enrichTables = [
        "enrichment_data", "scoring_data", "outreach_data",
      ];
      const optionalEnrich = [
        "social_intros", "content_hooks", "social_signals", "founder_profiles",
        "succession_news", "legacy_outreach", "succession_audits", "tenure_legacy_emails",
        "founder_emails",
      ];

      for (const table of enrichTables) {
        db.prepare(`DELETE FROM ${table} WHERE lead_id = ?`).run(leadId);
      }
      for (const table of optionalEnrich) {
        try { db.prepare(`DELETE FROM ${table} WHERE lead_id = ?`).run(leadId); } catch { /* */ }
      }

      // Check if scraped content exists to set correct status
      const hasScraped = db.prepare("SELECT id FROM scraped_content WHERE lead_id = ?").get(leadId);
      const newStatus = hasScraped ? "scraped" : "pending";
      db.prepare("UPDATE leads SET enrichment_status = ?, updated_at = ? WHERE id = ?")
        .run(newStatus, new Date().toISOString(), leadId);

      return NextResponse.json({ success: true, newStatus });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
