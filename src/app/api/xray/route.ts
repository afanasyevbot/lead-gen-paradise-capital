import { NextRequest, NextResponse } from "next/server";
import { createJob, updateJobProgress, completeJob, failJob } from "@/lib/jobs";
import { searchLinkedInXRay } from "@/lib/scraper/linkedin-xray";
import { upsertLead } from "@/lib/db";
import { getDb } from "@/lib/db";

// ─── X-Ray industry presets ──────────────────────────────────────────────────
// Each preset maps to one or more industry keyword(s) used in the Google query.
// The user selects an industry; the scraper runs one search per keyword × location.

export const XRAY_INDUSTRY_PRESETS: Record<string, string[]> = {
  "hvac":                ["hvac", "heating and cooling"],
  "plumbing":            ["plumbing"],
  "marine":              ["marine", "marina", "boat"],
  "manufacturing":       ["manufacturing", "fabrication"],
  "construction":        ["construction", "general contractor"],
  "roofing":             ["roofing"],
  "electrical":          ["electrical contractor"],
  "trucking":            ["trucking", "freight"],
  "landscaping":         ["landscaping", "lawn care"],
  "distribution":        ["distribution", "wholesale"],
  "staffing":            ["staffing agency", "recruiting"],
  "consulting":          ["consulting", "management consulting"],
  "marketing-agency":    ["marketing agency", "advertising agency"],
  "it-services":         ["IT services", "managed services"],
  "accounting":          ["accounting", "CPA"],
  "insurance":           ["insurance agency", "insurance brokerage"],
  "printing":            ["printing company", "commercial printer"],
  "environmental":       ["environmental services", "remediation"],
  "fire-security":       ["fire protection", "security systems"],
  "waste":               ["waste management", "junk removal"],
};

// Default founder/owner titles to search for
const DEFAULT_TITLES = ["founder", "owner", "president", "co-founder", "co-owner"];

/**
 * Pre-populate linkedin_data for a freshly upserted X-Ray lead.
 * This gives the enrichment stage a head-start — it already has the LinkedIn URL
 * and partial owner info without needing to discover them from scratch.
 */
function seedLinkedinData(
  leadId: number,
  linkedinUrl: string,
  ownerName: string | null,
  ownerTitle: string | null,
) {
  try {
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM linkedin_data WHERE lead_id = ?")
      .get(leadId);
    if (existing) return; // already seeded

    db.prepare(`
      INSERT INTO linkedin_data (lead_id, linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(leadId, linkedinUrl, ownerName ?? null, ownerTitle ?? null);
  } catch (e) {
    console.warn(`[XRAY] Could not seed linkedin_data for lead ${leadId}:`, String(e));
  }
}

// ─── POST /api/xray ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      industry: string;
      locations: string[];
      titles?: string[];
      maxPerSearch?: number;
    };

    const { industry, locations, titles, maxPerSearch = 30 } = body;

    if (!industry || !XRAY_INDUSTRY_PRESETS[industry]) {
      return NextResponse.json({ error: "Invalid or missing industry preset" }, { status: 400 });
    }
    if (!locations?.length) {
      return NextResponse.json({ error: "At least one location is required" }, { status: 400 });
    }

    const searchTitles = titles?.length ? titles : DEFAULT_TITLES;
    const industryKeywords = XRAY_INDUSTRY_PRESETS[industry];
    const totalSearches = industryKeywords.length * locations.length;

    const job = createJob("xray" as Parameters<typeof createJob>[0]);

    // Fire and forget
    (async () => {
      const counts = { new: 0, updated: 0, total: 0 };
      let combo = 0;
      updateJobProgress(job.id, { total: totalSearches, stage: "searching" });

      try {
        for (const location of locations) {
          for (const keyword of industryKeywords) {
            combo++;
            updateJobProgress(job.id, {
              current: combo,
              currentItem: `"${keyword}" founders in ${location}`,
            });

            const profiles = await searchLinkedInXRay({
              titles: searchTitles,
              industry: keyword,
              location,
              maxResults: maxPerSearch,
            });

            counts.total += profiles.length;

            for (const profile of profiles) {
              // Map X-Ray profile to the leads table shape
              const leadRecord = {
                place_id: profile.place_id,
                business_name: profile.business_name,
                address: null,
                city: null,
                state: null,
                zip_code: null,
                phone: null,
                website: null,
                google_rating: null,
                review_count: 0,
                business_types: [],
                latitude: null,
                longitude: null,
                source: "linkedin_xray",
                search_query: profile.search_query,
                search_location: profile.location,
                is_chain: 0,
                high_review_flag: 0,
                no_website_flag: 1,   // unknown until scraped
                raw_data: {
                  linkedin_url: profile.linkedin_url,
                  owner_name: profile.owner_name,
                  owner_title: profile.owner_title,
                  snippet: profile.snippet,
                },
              };

              const isNew = upsertLead(leadRecord as unknown as Record<string, unknown>);

              if (isNew) {
                counts.new++;
                // Seed linkedin_data so the pipeline doesn't need to re-discover it
                const db = getDb();
                const row = db
                  .prepare("SELECT id FROM leads WHERE place_id = ?")
                  .get(profile.place_id) as { id: number } | undefined;
                if (row) {
                  seedLinkedinData(row.id, profile.linkedin_url, profile.owner_name, profile.owner_title);
                }
              } else {
                counts.updated++;
              }
            }

            // Polite delay between Google searches to avoid rate limiting
            if (combo < totalSearches) {
              await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
            }
          }
        }

        completeJob(job.id, counts);
      } catch (e) {
        console.error("[XRAY] Job failed:", e);
        failJob(job.id, String(e));
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── GET /api/xray — return available presets ────────────────────────────────

export async function GET() {
  return NextResponse.json({ presets: XRAY_INDUSTRY_PRESETS });
}
