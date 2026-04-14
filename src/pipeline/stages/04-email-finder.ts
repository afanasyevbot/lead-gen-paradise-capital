import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { WaterfallEmailFinder } from "@/lib/enrichment/email/waterfall";
import { EmailRepository } from "@/infrastructure/db/email.repository";
import { getDb } from "@/lib/db";
import type { EmailLookupInput } from "@/lib/enrichment/email/provider.interface";
import { trackProviderCost } from "@/lib/cost-tracker";

/**
 * Build a lookup input from lead data + enrichment + linkedin.
 */
function buildLookupInput(
  lead: { id: number; business_name: string; website: string | null; enrichment_json: string; owner_name_from_linkedin: string | null },
): EmailLookupInput {
  let enrichment: Record<string, unknown> = {};
  try {
    enrichment = JSON.parse(lead.enrichment_json);
  } catch { /* empty */ }

  // Get domain from website
  let domain = "";
  if (lead.website) {
    domain = lead.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }

  // Get owner name from enrichment or LinkedIn
  const fullName = (enrichment.owner_name as string) || lead.owner_name_from_linkedin || null;
  const title = (enrichment.owner_title as string) || null;

  // Split name
  const nameParts = fullName?.trim().split(/\s+/) || [];
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(" ") || null;

  return {
    domain,
    fullName,
    firstName,
    lastName,
    title,
    companyName: lead.business_name,
  };
}

export const emailFinderStage: PipelineStage = {
  name: "email-finder",
  description: "Finding founder emails (waterfall enrichment)",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const db = getDb();
    const emailRepo = new EmailRepository(db);
    const waterfall = new WaterfallEmailFinder();

    const leads = emailRepo.getLeadsNeedingEmail(ctx.limit);
    let found = 0;
    let verified = 0;
    let notFound = 0;

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      ctx.onItemProgress(i + 1, leads.length, lead.business_name);

      try {
        const input = buildLookupInput(lead);

        if (!input.domain) {
          notFound++;
          continue;
        }

        const result = await waterfall.findEmail(input);

        // Track cost per provider actually attempted
        for (const provider of (result.providersAttempted ?? [])) {
          trackProviderCost(lead.id, "email-finder", provider);
        }

        // Save all candidates
        emailRepo.saveCandidates(lead.id, result.candidates);
        emailRepo.saveRun(lead.id, result);

        if (result.bestEmail) {
          emailRepo.setPrimary(lead.id, result.bestEmail);
          found++;
          if (result.bestVerificationStatus === "valid") verified++;
        } else {
          notFound++;
        }
      } catch (err) {
        console.error(`[EmailWaterfall] Failed for ${lead.business_name}:`, err);
        notFound++;
      }
    }

    return {
      emails_found: found,
      emails_verified: verified,
      emails_not_found: notFound,
      leads_processed: leads.length,
      providers_available: waterfall.providerCount,
    };
  },
};
