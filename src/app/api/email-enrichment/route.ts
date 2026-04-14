import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { WaterfallEmailFinder } from "@/lib/enrichment/email/waterfall";
import { EmailRepository } from "@/infrastructure/db/email.repository";

/**
 * POST /api/email-enrichment
 *
 * Run waterfall email enrichment on leads.
 * Body: { leadIds?: number[], limit?: number }
 *
 * - leadIds: run on specific leads
 * - limit: run on the next N leads needing emails (default 10)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leadIds, limit = 10 } = body as { leadIds?: number[]; limit?: number };

    const db = getDb();
    const emailRepo = new EmailRepository(db);
    const waterfall = new WaterfallEmailFinder();

    // Get leads to process
    let leads: { id: number; business_name: string; website: string | null; enrichment_json: string; owner_name_from_linkedin: string | null }[];

    if (leadIds && leadIds.length > 0) {
      // Specific leads
      leads = db.prepare(
        `SELECT l.id, l.business_name, l.website,
                ed.data as enrichment_json,
                ld.owner_name_from_linkedin
         FROM leads l
         JOIN enrichment_data ed ON ed.lead_id = l.id
         LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
         WHERE l.id IN (${leadIds.map(() => "?").join(",")})`,
      ).all(...leadIds) as typeof leads;
    } else {
      leads = emailRepo.getLeadsNeedingEmail(limit);
    }

    let found = 0;
    let verified = 0;
    let notFound = 0;
    let failed = 0;

    for (const lead of leads) {
      try {
        let domain = "";
        if (lead.website) {
          domain = lead.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        }
        if (!domain) { notFound++; continue; }

        let enrichment: Record<string, unknown> = {};
        try { enrichment = JSON.parse(lead.enrichment_json); } catch { /* */ }

        const fullName = (enrichment.owner_name as string) || lead.owner_name_from_linkedin || null;
        const nameParts = fullName?.trim().split(/\s+/) || [];

        const result = await waterfall.findEmail({
          domain,
          fullName,
          firstName: nameParts[0] || null,
          lastName: nameParts.slice(1).join(" ") || null,
          title: (enrichment.owner_title as string) || null,
          companyName: lead.business_name,
        });

        emailRepo.saveCandidates(lead.id, result.candidates);
        emailRepo.saveRun(lead.id, result);

        if (result.bestEmail) {
          emailRepo.setPrimary(lead.id, result.bestEmail);
          found++;
          if (result.bestVerificationStatus === "valid") verified++;
        } else {
          notFound++;
        }
      } catch {
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      leads_processed: leads.length,
      emails_found: found,
      emails_verified: verified,
      emails_not_found: notFound,
      failed,
      providers_configured: waterfall.configuredProviders,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/email-enrichment
 *
 * Get email enrichment stats.
 */
export async function GET() {
  try {
    const db = getDb();
    const emailRepo = new EmailRepository(db);
    const stats = emailRepo.getStats();
    const waterfall = new WaterfallEmailFinder();

    return NextResponse.json({
      ...stats,
      configuredProviders: waterfall.configuredProviders,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
