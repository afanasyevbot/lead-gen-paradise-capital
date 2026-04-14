/**
 * Scrapes social signals for a lead:
 * 1. LinkedIn "About" section (via Google cache/snippet — no login required)
 * 2. Recent Twitter/X posts (via Google search — no API required)
 * 3. Latest press releases (via Google News search)
 *
 * All scraping uses Playwright + Google search to avoid API costs and auth walls.
 */

import { getDb } from "@/lib/db";

type ProgressCallback = (current: number, total: number, item: string) => void;

export interface SocialSignals {
  linkedin_about: string | null;
  twitter_posts: string[];
  press_releases: string[];
  error: string | null;
}

const DELAY_BETWEEN_SEARCHES_MS = 3000;

// ─── Scrape LinkedIn About section via Google snippet ───────────────────────

async function scrapeLinkedInAbout(
  ownerName: string | null,
  businessName: string,
  linkedinUrl: string | null,
): Promise<string | null> {
  const { chromium } = await import("playwright");

  // If we have a direct LinkedIn URL, search for it specifically
  let query: string;
  if (linkedinUrl) {
    query = `site:linkedin.com "${linkedinUrl.split("/in/")[1]?.replace(/-/g, " ") || ownerName || businessName}" about`;
  } else if (ownerName) {
    query = `site:linkedin.com/in "${ownerName}" "${businessName}" about`;
  } else {
    return null; // Can't search without a name
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    // Check for rate limiting
    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return null;
    }

    // Extract snippets from search results — these often contain the LinkedIn "About"
    const snippets = await page.$$eval(".VwiC3b, .IsZvec, [data-sncf]", (els) =>
      els.map((el) => (el.textContent || "").trim()).filter((t) => t.length > 30)
    );

    // Look for the longest snippet that seems like a bio/about section
    const aboutSnippet = snippets
      .filter((s) =>
        !s.includes("Sign in") &&
        !s.includes("Join LinkedIn") &&
        !s.includes("View profile")
      )
      .sort((a, b) => b.length - a.length)[0] || null;

    return aboutSnippet;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

// ─── Scrape recent Twitter/X posts via Google search ────────────────────────

async function scrapeTwitterPosts(
  ownerName: string | null,
  businessName: string,
): Promise<string[]> {
  const { chromium } = await import("playwright");

  // Search for recent tweets from the business or owner
  const searchTarget = ownerName || businessName;
  const query = `site:twitter.com OR site:x.com "${searchTarget}" -retweet`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=qdr:y`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return [];
    }

    // Extract tweet snippets from Google search results
    const snippets = await page.$$eval(".VwiC3b, .IsZvec", (els) =>
      els.map((el) => (el.textContent || "").trim())
        .filter((t) => t.length > 20 && t.length < 500)
    );

    // Take up to 5 most recent-looking tweets
    return snippets.slice(0, 5);
  } catch {
    return [];
  } finally {
    await browser.close();
  }
}

// ─── Scrape press releases via Google News search ───────────────────────────

async function scrapePressReleases(businessName: string): Promise<string[]> {
  const { chromium } = await import("playwright");

  const query = `"${businessName}" press release OR announcement OR news`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Use Google News tab for press releases
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=qdr:y`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return [];
    }

    // Extract news result titles and snippets
    const results = await page.$$eval("[role='heading'], .n0jPhd, .VwiC3b, .IsZvec, .GI74Re", (els) =>
      els.map((el) => (el.textContent || "").trim())
        .filter((t) => t.length > 15 && t.length < 300)
    );

    // Deduplicate and take top 3
    const unique = [...new Set(results)];
    return unique.slice(0, 3);
  } catch {
    return [];
  } finally {
    await browser.close();
  }
}

// ─── Main: gather all social signals for a lead ─────────────────────────────

async function gatherSocialSignals(
  businessName: string,
  ownerName: string | null,
  linkedinUrl: string | null,
): Promise<SocialSignals> {
  const result: SocialSignals = {
    linkedin_about: null,
    twitter_posts: [],
    press_releases: [],
    error: null,
  };

  try {
    // Stagger searches to avoid Google rate limiting
    result.linkedin_about = await scrapeLinkedInAbout(ownerName, businessName, linkedinUrl);
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SEARCHES_MS));

    result.twitter_posts = await scrapeTwitterPosts(ownerName, businessName);
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SEARCHES_MS));

    result.press_releases = await scrapePressReleases(businessName);
  } catch (e) {
    result.error = String(e);
  }

  return result;
}

// ─── Batch processor: gather signals for multiple leads ─────────────────────

export async function gatherAllSocialSignals(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ gathered: number; skipped: number; failed: number }> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      linkedin_about TEXT,
      twitter_posts TEXT,
      press_releases TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Get enriched leads that don't have social signals yet
  const rows = db.prepare(`
    SELECT l.id, l.business_name,
           ed.data as enrichment_json,
           ld.linkedin_url
    FROM leads l
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN linkedin_data ld ON ld.lead_id = l.id
    LEFT JOIN social_signals ss ON ss.lead_id = l.id
    WHERE ss.id IS NULL
      AND l.enrichment_status IN ('enriched', 'scored', 'outreach_generated')
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    enrichment_json: string | null;
    linkedin_url: string | null;
  }[];

  const counts = { gathered: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    let ownerName: string | null = null;
    if (row.enrichment_json) {
      try {
        const enrichment = JSON.parse(row.enrichment_json);
        ownerName = enrichment.owner_name || null;
      } catch { /* ignore */ }
    }

    // Skip if we have no owner name and no LinkedIn URL — not enough to search
    if (!ownerName && !row.linkedin_url) {
      counts.skipped++;
      continue;
    }

    try {
      const signals = await gatherSocialSignals(
        row.business_name,
        ownerName,
        row.linkedin_url,
      );

      db.prepare(`
        INSERT OR REPLACE INTO social_signals
        (lead_id, linkedin_about, twitter_posts, press_releases, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        signals.linkedin_about,
        JSON.stringify(signals.twitter_posts),
        JSON.stringify(signals.press_releases),
      );

      counts.gathered++;

      // Delay between leads to avoid Google rate limiting
      const delay = 3000 + Math.random() * 3000;
      await new Promise((r) => setTimeout(r, delay));
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
