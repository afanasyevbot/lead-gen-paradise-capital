/**
 * Blog & Podcast Scraper
 *
 * Finds and scrapes a lead's blog posts, podcast appearances, or published
 * articles to extract quotes and themes for subject line hooks.
 *
 * Search strategy:
 * 1. Check if the business website has a /blog, /news, /articles page
 * 2. Google search for podcast appearances or interviews
 * 3. Extract the most usable content for hook generation
 */

import { getDb } from "@/lib/db";

type ProgressCallback = (current: number, total: number, item: string) => void;

export interface ContentHookRaw {
  blog_posts: { title: string; snippet: string; url: string }[];
  podcast_appearances: { title: string; snippet: string; url: string }[];
  articles: { title: string; snippet: string; url: string }[];
  error: string | null;
}

const BLOG_SLUGS = ["blog", "news", "articles", "insights", "resources", "press", "media", "stories"];

// ─── Scrape website for blog posts ──────────────────────────────────────────

async function scrapeBlogPosts(
  websiteUrl: string,
): Promise<{ title: string; snippet: string; url: string }[]> {
  const { chromium } = await import("playwright");

  if (!websiteUrl.startsWith("http")) {
    websiteUrl = `https://${websiteUrl}`;
  }

  const baseUrl = new URL(websiteUrl).origin;
  const results: { title: string; snippet: string; url: string }[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Try common blog paths
    for (const slug of BLOG_SLUGS) {
      const blogUrl = `${baseUrl}/${slug}`;
      try {
        const response = await page.goto(blogUrl, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });

        if (!response || response.status() >= 400) continue;

        await page.waitForTimeout(1500);

        // Extract article-like links from the page
        const links = await page.$$eval(
          "article a, .post a, .blog-post a, [class*='article'] a, [class*='post'] a, h2 a, h3 a",
          (els) => els.map((el) => ({
            title: (el.textContent || "").trim(),
            url: (el as HTMLAnchorElement).href,
          })).filter((l) => l.title.length > 10 && l.title.length < 200),
        );

        if (links.length > 0) {
          // Take the first 3 blog post links and scrape snippets
          for (const link of links.slice(0, 3)) {
            try {
              await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 10000 });
              await page.waitForTimeout(1000);

              const snippet = await page.$eval(
                "article p, .post-content p, .entry-content p, main p, [class*='content'] p",
                (el) => (el.textContent || "").trim().slice(0, 300),
              ).catch(() => "");

              if (snippet.length > 30) {
                results.push({ title: link.title, snippet, url: link.url });
              }
            } catch { /* skip individual post errors */ }
          }
          break; // Found blog posts, no need to try other slugs
        }
      } catch { /* slug not found, try next */ }
    }
  } catch { /* browser error */ }
  finally {
    await browser.close();
  }

  return results;
}

// ─── Search for podcast appearances via Google ──────────────────────────────

async function scrapePodcastAppearances(
  ownerName: string | null,
  businessName: string,
): Promise<{ title: string; snippet: string; url: string }[]> {
  const { chromium } = await import("playwright");

  const searchTarget = ownerName || businessName;
  const query = `"${searchTarget}" podcast OR interview OR "guest on" OR "episode" -site:linkedin.com`;

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

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return [];
    }

    // Extract search results
    const results = await page.$$eval("#search .g", (els) =>
      els.slice(0, 5).map((el) => {
        const titleEl = el.querySelector("h3");
        const snippetEl = el.querySelector(".VwiC3b, .IsZvec, [data-sncf]");
        const linkEl = el.querySelector("a");
        return {
          title: (titleEl?.textContent || "").trim(),
          snippet: (snippetEl?.textContent || "").trim(),
          url: (linkEl as HTMLAnchorElement)?.href || "",
        };
      }).filter((r) =>
        r.title.length > 5 &&
        r.snippet.length > 20 &&
        (r.title.toLowerCase().includes("podcast") ||
         r.title.toLowerCase().includes("interview") ||
         r.title.toLowerCase().includes("episode") ||
         r.snippet.toLowerCase().includes("podcast") ||
         r.snippet.toLowerCase().includes("interview"))
      ),
    );

    return results.slice(0, 3);
  } catch {
    return [];
  } finally {
    await browser.close();
  }
}

// ─── Search for articles/mentions via Google ────────────────────────────────

async function scrapeArticleMentions(
  ownerName: string | null,
  businessName: string,
): Promise<{ title: string; snippet: string; url: string }[]> {
  const { chromium } = await import("playwright");

  const query = `"${businessName}" ${ownerName ? `"${ownerName}"` : ""} article OR feature OR profile OR spotlight -site:linkedin.com -site:facebook.com`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=qdr:y2`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return [];
    }

    const results = await page.$$eval("#search .g", (els) =>
      els.slice(0, 3).map((el) => {
        const titleEl = el.querySelector("h3");
        const snippetEl = el.querySelector(".VwiC3b, .IsZvec");
        const linkEl = el.querySelector("a");
        return {
          title: (titleEl?.textContent || "").trim(),
          snippet: (snippetEl?.textContent || "").trim(),
          url: (linkEl as HTMLAnchorElement)?.href || "",
        };
      }).filter((r) => r.title.length > 5 && r.snippet.length > 20),
    );

    return results;
  } catch {
    return [];
  } finally {
    await browser.close();
  }
}

// ─── Main batch processor ───────────────────────────────────────────────────

export async function gatherContentHooks(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ gathered: number; skipped: number; failed: number }> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_hooks_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      blog_posts TEXT,
      podcast_appearances TEXT,
      articles TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website,
           ed.data as enrichment_json
    FROM leads l
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN content_hooks_raw ch ON ch.lead_id = l.id
    WHERE ch.id IS NULL
      AND l.website IS NOT NULL
      AND l.enrichment_status IN ('enriched', 'scored', 'outreach_generated')
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    enrichment_json: string | null;
  }[];

  const counts = { gathered: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    let ownerName: string | null = null;
    if (row.enrichment_json) {
      try {
        ownerName = JSON.parse(row.enrichment_json).owner_name || null;
      } catch { /* ignore */ }
    }

    try {
      // Scrape blog posts from their website
      const blogPosts = row.website ? await scrapeBlogPosts(row.website) : [];
      await new Promise((r) => setTimeout(r, 2000));

      // Search for podcast appearances
      const podcasts = await scrapePodcastAppearances(ownerName, row.business_name);
      await new Promise((r) => setTimeout(r, 3000));

      // Search for article mentions
      const articles = await scrapeArticleMentions(ownerName, row.business_name);

      if (blogPosts.length === 0 && podcasts.length === 0 && articles.length === 0) {
        counts.skipped++;
        // Still save empty result so we don't re-scrape
        db.prepare(`
          INSERT OR REPLACE INTO content_hooks_raw
          (lead_id, blog_posts, podcast_appearances, articles, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(row.id, "[]", "[]", "[]");
        continue;
      }

      db.prepare(`
        INSERT OR REPLACE INTO content_hooks_raw
        (lead_id, blog_posts, podcast_appearances, articles, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        JSON.stringify(blogPosts),
        JSON.stringify(podcasts),
        JSON.stringify(articles),
      );

      counts.gathered++;

      // Delay between leads
      const delay = 3000 + Math.random() * 3000;
      await new Promise((r) => setTimeout(r, delay));
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
