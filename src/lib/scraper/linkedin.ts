import { getDb } from "@/lib/db";
import type { BrowserContext } from "playwright";
import type { LinkedInResult, ProgressCallback } from "@/domain/types";
import { acquireBrowser, releaseBrowser, randomUserAgent } from "@/infrastructure/scraper/browser-pool";

const MAX_SEARCH_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 15_000; // 15 seconds if Google rate-limits us

/**
 * Search Google for a business owner's LinkedIn profile.
 * Reuses an existing browser context for speed.
 */
async function findLinkedInProfile(
  context: BrowserContext,
  businessName: string,
  ownerName: string | null,
  city: string | null,
  state: string | null,
): Promise<LinkedInResult> {
  const result: LinkedInResult = {
    linkedin_url: null,
    owner_name_from_linkedin: null,
    owner_title_from_linkedin: null,
    linkedin_headline: null,
    error: null,
  };

  // Build the search query list. Google/Serper penalise long OR-chains
  // (often returns 0 results or "query not allowed"), so we run a small
  // sequence of simple queries in priority order and stop at the first hit.
  const location = [city, state].filter(Boolean).join(" ");
  const titles = ["founder", "owner", "president", "CEO", "principal", "proprietor"];
  const queries: string[] = [];
  if (ownerName && ownerName !== "null") {
    queries.push(`site:linkedin.com/in "${ownerName}" "${businessName}"`);
    queries.push(`site:linkedin.com/in "${ownerName}" ${location}`);
  } else {
    for (const title of titles) {
      queries.push(`site:linkedin.com/in "${businessName}" "${title}" ${location}`.trim());
    }
    // Fallback: business name + location, no title (catches founders with
    // non-standard titles like "Head Honcho" or just the company name)
    queries.push(`site:linkedin.com/in "${businessName}" ${location}`.trim());
  }
  const query = queries[0]!;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  const page = await context.newPage();
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1500);

    // Detect Google rate limiting / CAPTCHA
    const pageContent = await page.content();
    if (
      pageContent.includes("unusual traffic") ||
      pageContent.includes("captcha") ||
      pageContent.includes("CAPTCHA") ||
      pageContent.includes("Our systems have detected unusual traffic") ||
      pageContent.includes("sorry/index")
    ) {
      result.error = "Google rate limit detected (CAPTCHA)";
      result.rate_limited = true;
      return result;
    }

    // Accept cookies if prompted
    try {
      const btn = page.locator("button:has-text('Accept all')");
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ignore */ }

    // Extract LinkedIn URLs from search results
    const links = await page.$$eval("a[href]", (els) =>
      els
        .map((el) => ({
          href: (el as HTMLAnchorElement).href,
          text: (el.textContent || "").trim(),
        }))
        .filter((l) => l.href.includes("linkedin.com/in/"))
    );

    if (links.length === 0) {
      // Try extracting from Google's redirect URLs
      const allLinks = await page.$$eval("a", (els) =>
        els.map((el) => ({
          href: (el as HTMLAnchorElement).href,
          text: (el.textContent || "").trim(),
        }))
      );

      for (const link of allLinks) {
        const linkedinMatch = link.href.match(/linkedin\.com\/in\/[a-zA-Z0-9\-]+/);
        if (linkedinMatch) {
          result.linkedin_url = `https://www.${linkedinMatch[0]}`;
          const parts = link.text.split(" - ");
          if (parts.length >= 1) {
            result.owner_name_from_linkedin = parts[0].trim();
          }
          if (parts.length >= 2) {
            result.owner_title_from_linkedin = parts[1].trim();
          }
          if (parts.length >= 2) {
            result.linkedin_headline = parts.slice(1).join(" - ").trim();
          }
          break;
        }
      }
    } else {
      const first = links[0];
      const urlMatch = first.href.match(/linkedin\.com\/in\/[a-zA-Z0-9\-]+/);
      result.linkedin_url = urlMatch
        ? `https://www.${urlMatch[0]}`
        : first.href;

      const parts = first.text.split(" - ");
      if (parts.length >= 1) {
        result.owner_name_from_linkedin = parts[0]
          .replace(/\s*\|.*$/, "")
          .replace(/LinkedIn$/, "")
          .trim();
      }
      if (parts.length >= 2) {
        result.owner_title_from_linkedin = parts[1].trim();
      }
      if (parts.length >= 2) {
        result.linkedin_headline = parts
          .slice(1)
          .join(" - ")
          .replace(/\s*\|?\s*LinkedIn\s*$/, "")
          .trim();
      }
    }
  } catch (e) {
    result.error = String(e);
  } finally {
    await page.close();
  }

  return result;
}

/**
 * Find LinkedIn profiles for leads that have been enriched.
 * Uses owner_name from enrichment data if available for better matching.
 * Reuses a single browser instance across all leads for speed.
 */
export async function findLinkedInProfiles(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ found: number; not_found: number; failed: number; skipped: number }> {
  const db = getDb();

  // linkedin_data table is created by the unified schema in db.ts.
  // No duplicate CREATE TABLE needed here.

  const rows = db
    .prepare(
      `SELECT l.id, l.business_name, l.city, l.state,
              ed.data as enrichment_json
       FROM leads l
       LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
       LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
       WHERE ld.id IS NULL
         AND l.enrichment_status NOT IN ('pending', 'scrape_failed')
       LIMIT ?`
    )
    .all(limit) as {
      id: number;
      business_name: string;
      city: string | null;
      state: string | null;
      enrichment_json: string | null;
    }[];

  const counts = { found: 0, not_found: 0, failed: 0, skipped: 0 };

  if (rows.length === 0) return counts;

  // Randomize processing order so rate-limited leads aren't always the same ones
  for (let j = rows.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [rows[j], rows[k]] = [rows[k], rows[j]];
  }

  // Acquire shared browser from pool for the entire batch
  const browser = await acquireBrowser();

  try {
    const context = await browser.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });

    let batchRateLimited = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      onProgress?.(i + 1, rows.length, row.business_name);

      // Anti-detection: random delay between LinkedIn searches (skip first)
      if (i > 0) {
        const delay = 3000 + Math.floor(Math.random() * 5000); // 3-8s
        await new Promise((r) => setTimeout(r, delay));
      }

      let ownerName: string | null = null;
      if (row.enrichment_json) {
        try {
          const enrichment = JSON.parse(row.enrichment_json);
          ownerName = enrichment.owner_name || null;
        } catch { /* ignore */ }
      }

      try {
        let result: LinkedInResult | null = null;
        let succeeded = false;

        for (let attempt = 0; attempt <= MAX_SEARCH_RETRIES; attempt++) {
          result = await findLinkedInProfile(
            context,
            row.business_name,
            ownerName,
            row.city,
            row.state,
          );

          if (result.rate_limited) {
            batchRateLimited = true;
            if (attempt < MAX_SEARCH_RETRIES) {
              const backoff = RATE_LIMIT_BACKOFF_MS * (attempt + 1);
              console.warn(
                `[LinkedIn] Google rate limit hit for "${row.business_name}". ` +
                `Backing off ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${MAX_SEARCH_RETRIES})`
              );
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            } else {
              console.warn(
                `[LinkedIn] Google rate limit persists after ${MAX_SEARCH_RETRIES} retries. Skipping remaining leads.`
              );
              counts.failed++;
              return counts;
            }
          }

          if (result.error && !result.rate_limited) {
            if (attempt < MAX_SEARCH_RETRIES) {
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            counts.failed++;
            break;
          }

          succeeded = true;
          break;
        }

        if (!succeeded || !result) {
          if (!result?.rate_limited) counts.failed++;
          continue;
        }

        const dataQuality = !result.linkedin_url
          ? "not_found"
          : batchRateLimited
            ? "degraded_rate_limited"
            : "normal";

        db.prepare(
          `INSERT OR REPLACE INTO linkedin_data
           (lead_id, linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, linkedin_headline, rate_limited, data_quality, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          row.id,
          result.linkedin_url,
          result.owner_name_from_linkedin,
          result.owner_title_from_linkedin,
          result.linkedin_headline,
          batchRateLimited ? 1 : 0,
          dataQuality,
        );

        if (result.linkedin_url) {
          counts.found++;
        } else {
          counts.not_found++;
        }

        // Delay between searches to avoid Google rate limiting (2-4 seconds with jitter)
        const delay = 2000 + Math.random() * 2000;
        await new Promise((r) => setTimeout(r, delay));
      } catch {
        counts.failed++;
      }
    }
  } finally {
    await releaseBrowser();
  }

  return counts;
}
