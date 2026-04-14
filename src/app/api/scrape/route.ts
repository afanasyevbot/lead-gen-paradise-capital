import { NextRequest, NextResponse } from "next/server";
import { createJob, updateJobProgress, completeJob, failJob } from "@/lib/jobs";
import { searchPlaces, interQueryDelay } from "@/lib/scraper/google-maps";
import { upsertLead } from "@/lib/db";
import { SEARCH_PRESETS } from "@/lib/config";
import fs from "fs";
import path from "path";

function loadAllPresets(): Record<string, string[]> {
  const merged = { ...SEARCH_PRESETS };
  try {
    const customPath = path.join(process.cwd(), "data", "custom-presets.json");
    if (fs.existsSync(customPath)) {
      const custom = JSON.parse(fs.readFileSync(customPath, "utf-8"));
      Object.assign(merged, custom);
    }
  } catch { /* ignore */ }
  return merged;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      preset,
      queries: customQueries,
      locations,
      minRating,
      minReviews,
    } = body as {
      preset?: string;
      queries?: string[];
      locations: string[];
      minRating?: number;
      minReviews?: number;
    };

    if (!locations?.length) {
      return NextResponse.json({ error: "At least one location is required" }, { status: 400 });
    }

    const allPresets = loadAllPresets();
    const queries: string[] = [...(customQueries || [])];
    if (preset && allPresets[preset]) {
      queries.push(...allPresets[preset]);
    }
    if (!queries.length) {
      return NextResponse.json({ error: "Provide preset or queries" }, { status: 400 });
    }

    const job = createJob("scrape");

    // Fire and forget — don't await
    (async () => {
      const counts = { new: 0, updated: 0, skipped: 0, total: 0 };
      const totalCombos = queries.length * locations.length;
      updateJobProgress(job.id, { total: totalCombos, stage: "scraping" });

      try {
        let combo = 0;
        for (const location of locations) {
          for (const query of queries) {
            combo++;

            // Anti-detection: random delay between queries (skip first)
            if (combo > 1) {
              updateJobProgress(job.id, {
                current: combo,
                currentItem: `Waiting before next search...`,
              });
              await interQueryDelay();
            }

            updateJobProgress(job.id, {
              current: combo,
              currentItem: `${query} in ${location}`,
            });

            const leads = await searchPlaces(query, location);
            counts.total += leads.length;

            for (const lead of leads) {
              if (minRating && (lead.google_rating ?? 0) < minRating) {
                counts.skipped++;
                continue;
              }
              if (minReviews && (lead.review_count ?? 0) < minReviews) {
                counts.skipped++;
                continue;
              }
              const isNew = upsertLead(lead as unknown as Record<string, unknown>);
              if (isNew) counts.new++;
              else counts.updated++;
            }
          }
        }
        completeJob(job.id, counts);
      } catch (e) {
        failJob(job.id, String(e));
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
