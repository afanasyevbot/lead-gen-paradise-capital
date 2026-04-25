import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enrichLeads } from "@/lib/enrichment/extract";
import { findFounderEmails, findEmailForLead } from "@/lib/enrichment/email-finder";
import { scoreLeads } from "@/lib/enrichment/score";
import { generateOutreachEmails } from "@/lib/enrichment/outreach";
import { findLinkedInProfiles } from "@/lib/scraper/linkedin";
import { scrapeLeadWebsiteById } from "@/lib/scraper/website";

/**
 * POST /api/leads/[id]/actions
 *
 * Run a single pipeline stage on one specific lead.
 * Body: { action: "extract" | "find-email" | "score" | "outreach" }
 *
 * This temporarily sets the lead to the correct status for that stage,
 * runs it, then returns results. Useful when you want to re-run a
 * specific step after researching a lead manually.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leadId = Number(id);
    const db = getDb();
    const body = await req.json();
    const { action } = body as { action: string };

    // Verify lead exists
    const lead = db.prepare("SELECT id, enrichment_status FROM leads WHERE id = ?").get(leadId) as
      | { id: number; enrichment_status: string }
      | undefined;
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    switch (action) {
      case "scrape-website": {
        const scrapeResult = await scrapeLeadWebsiteById(leadId);
        if (!scrapeResult.success) {
          return NextResponse.json({ error: scrapeResult.error || "Scrape failed" }, { status: 400 });
        }
        return NextResponse.json({ success: true, action: "scrape-website" });
      }

      case "linkedin": {
        // LinkedIn discovery uses Google search — no scraped content needed
        // Clear existing linkedin data so it gets re-processed
        try { db.prepare("DELETE FROM linkedin_data WHERE lead_id = ?").run(leadId); } catch { /* */ }

        const result = await findLinkedInProfiles(1, undefined, leadId);
        return NextResponse.json({ success: true, action: "linkedin", ...result });
      }

      case "extract": {
        // Need scraped content to extract
        const hasScraped = db.prepare("SELECT id FROM scraped_content WHERE lead_id = ?").get(leadId);
        if (!hasScraped) {
          return NextResponse.json({ error: "No scraped content — scrape the website first" }, { status: 400 });
        }

        // Clear existing enrichment so it gets re-processed
        try { db.prepare("DELETE FROM enrichment_data WHERE lead_id = ?").run(leadId); } catch { /* */ }

        const result = await enrichLeads(1, undefined, leadId);

        if (result.enriched === 0 && result.failed > 0) {
          return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
        }

        return NextResponse.json({ success: true, action: "extract", ...result });
      }

      case "find-email": {
        // Need enrichment data first
        const hasEnrichment = db.prepare("SELECT id FROM enrichment_data WHERE lead_id = ?").get(leadId);
        if (!hasEnrichment) {
          return NextResponse.json({ error: "No enrichment data — run extract first" }, { status: 400 });
        }

        // Use targeted single-lead lookup with full waterfall details
        const emailResult = await findEmailForLead(leadId);
        return NextResponse.json({
          success: true,
          action: "find-email",
          email: emailResult.email,
          source: emailResult.source,
          waterfall: emailResult.waterfall,
        });
      }

      case "score": {
        // Need enrichment data
        const hasEnrichment2 = db.prepare("SELECT id FROM enrichment_data WHERE lead_id = ?").get(leadId);
        if (!hasEnrichment2) {
          return NextResponse.json({ error: "No enrichment data — run extract first" }, { status: 400 });
        }

        // Clear existing score
        try { db.prepare("DELETE FROM scoring_data WHERE lead_id = ?").run(leadId); } catch { /* */ }

        const result = await scoreLeads(1, undefined, leadId);

        if (result.scored === 0 && result.failed > 0) {
          return NextResponse.json({ error: "Scoring failed" }, { status: 500 });
        }

        return NextResponse.json({ success: true, action: "score", ...result });
      }

      case "outreach": {
        // Need scoring data
        const hasScore = db.prepare("SELECT id FROM scoring_data WHERE lead_id = ?").get(leadId);
        if (!hasScore) {
          return NextResponse.json({ error: "No score data — run score first" }, { status: 400 });
        }

        // Clear existing outreach
        try { db.prepare("DELETE FROM outreach_data WHERE lead_id = ?").run(leadId); } catch { /* */ }

        const result = await generateOutreachEmails(body.minScore || 1, 1, undefined, leadId);
        return NextResponse.json({ success: true, action: "outreach", ...result });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
