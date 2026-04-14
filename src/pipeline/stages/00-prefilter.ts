import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { getDb, setLeadStatus } from "@/lib/db";
import { isChain } from "@/lib/config";

// ── PCAP Avoidance Keywords ────────────────────────────────────────────────
// Businesses PCAP explicitly avoids — eliminated free before any AI/API spend.
// Categories:
//   1. Main Street / consumer-facing (restaurants, retail, consumer services)
//   2. Healthcare (medical, dental, therapy, elder care)
//   3. Funeral services

const AVOID_KEYWORDS = [
  // Restaurants & food service
  "restaurant", "cafe", "diner", "bistro", "pizzeria", "sushi", "steakhouse",
  "deli", "bakery", "catering", "food truck", "bar & grill", "bar and grill",
  "brewery", "winery", "tavern", "pub ",
  // Retail
  "retail store", "boutique", "gift shop", "clothing store", "shoe store",
  "jewelry store", "furniture store", "antique", "thrift store",
  // Consumer personal services
  "hair salon", "nail salon", "barber shop", "barbershop", "spa ", "day spa",
  "tattoo", "dry clean", "laundromat",
  // Healthcare
  "medical practice", "medical clinic", "doctor", "physician", "dentist",
  "dental practice", "dental clinic", "orthodontist", "optometrist",
  "chiropractor", "physical therapy", "therapist", "psychiatrist",
  "psychologist", "counseling", "home health", "hospice", "hospital",
  "urgent care", "pharmacy", "nursing home", "assisted living",
  "senior living", "memory care", "home care agency",
  // Funeral
  "funeral home", "funeral services", "funeral parlor", "cremation services",
  "memorial chapel", "mortuary",
];

function isAvoided(businessName: string): boolean {
  const lower = businessName.toLowerCase();
  return AVOID_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Stage 00 — Rule-Based Pre-Filter (FREE)
 *
 * Eliminates obvious non-ICP leads before any API or AI calls.
 * Marks rejects as `pre_filtered` so they're skipped by all downstream stages.
 *
 * Rejection rules:
 * - Known chain business
 * - PCAP avoidance list (main street, healthcare, funeral)
 * - No website AND fewer than 10 reviews (almost certainly not $5M+)
 * - Fewer than 3 reviews total (too small / not established)
 * - Review count >= 1000 (franchise / chain-level volume)
 */
export const preFilterStage: PipelineStage = {
  name: "pre-filter",
  description: "Rule-based ICP pre-filter (free)",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const db = getDb();

    const leads = db
      .prepare(
        `SELECT id, business_name, website, review_count, is_chain, no_website_flag
         FROM leads
         WHERE enrichment_status = 'pending'
         LIMIT ?`
      )
      .all(ctx.limit) as {
        id: number;
        business_name: string;
        website: string | null;
        review_count: number;
        is_chain: number;
        no_website_flag: number;
      }[];

    let passed = 0;
    let filtered = 0;

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      ctx.onItemProgress(i + 1, leads.length, lead.business_name);

      const reviewCount = lead.review_count ?? 0;
      const hasWebsite = !lead.no_website_flag && !!lead.website;

      const reject =
        // Known chain
        lead.is_chain === 1 ||
        isChain(lead.business_name) ||
        // PCAP avoidance: main street, healthcare, funeral
        isAvoided(lead.business_name);

      if (reject) {
        setLeadStatus(lead.id, "pre_filtered");
        filtered++;
      } else {
        // Leave as pending — scrape stage picks it up
        passed++;
      }
    }

    return { pre_filter_passed: passed, pre_filter_rejected: filtered };
  },
};
