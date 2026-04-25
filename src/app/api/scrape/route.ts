import { NextRequest, NextResponse } from "next/server";
import { createJob, updateJobProgress, completeJob, failJob } from "@/lib/jobs";
import { searchPlaces, interQueryDelay } from "@/lib/scraper/google-maps";
import { upsertLead } from "@/lib/db";
import { SEARCH_PRESETS } from "@/lib/config";
import { acquireLock, releaseLock } from "@/lib/pipeline-lock";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import fs from "fs";
import path from "path";

// Broader fallback terms per industry — used when the primary preset query
// returns suspiciously few leads. Keep these very generic on purpose; they
// widen the net rather than replace the more specific presets.
const QUERY_FALLBACKS: Record<string, string> = {
  hvac: "HVAC",
  plumbing: "plumber",
  marine: "marine services",
  manufacturing: "manufacturer",
  construction: "contractor",
  roofing: "roofing",
  electrical: "electrician",
  trucking: "trucking",
  landscaping: "landscaping",
  "pest-control": "pest control",
  waste: "waste services",
  auto: "auto repair",
  "fire-security": "fire protection",
};

function broadenQuery(original: string, preset: string): string | null {
  const fallback = QUERY_FALLBACKS[preset];
  if (!fallback) return null;
  if (original.toLowerCase() === fallback.toLowerCase()) return null;
  return fallback;
}

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
    const rl = rateLimit(clientKey(req, "scrape"), { capacity: 5, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many scrape requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

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

    // Prevent concurrent scrape jobs — they share the Playwright browser pool
    // and Google rate-limits aggressively. Refuse the request rather than
    // queueing so the caller knows to wait.
    try {
      acquireLock("scrape");
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 409 });
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

            let leads = await searchPlaces(query, location);

            // Low-yield fallback — if a specific query returns <10 leads,
            // rerun with a broader term for the same preset so we don't miss
            // legitimate businesses that don't match the narrow phrasing.
            if (leads.length < 10 && preset && allPresets[preset]) {
              const broader = broadenQuery(query, preset);
              if (broader && broader !== query) {
                await interQueryDelay();
                const extra = await searchPlaces(broader, location);
                // Dedup by place_id before appending
                const seen = new Set(leads.map((l) => l.place_id));
                for (const l of extra) if (!seen.has(l.place_id)) leads.push(l);
              }
            }

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
      } finally {
        releaseLock();
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
