/**
 * Succession & Exit News Scanner
 *
 * Searches local business news for keywords associated with a founder's name
 * that signal they may be thinking about selling, retiring, or transitioning:
 * - "Succession planning"
 * - "Selling my business"
 * - "Next chapter"
 * - "Retirement"
 * - "Business transition"
 * - "Legacy"
 * - "Stepping down"
 *
 * Also searches industry-level news for consolidation or M&A activity
 * that creates natural conversation starters.
 */

import { getDb } from "@/lib/db";

type ProgressCallback = (current: number, total: number, item: string) => void;

const EXIT_KEYWORDS = [
  "succession planning",
  "selling my business",
  "next chapter",
  "retirement",
  "stepping down",
  "business transition",
  "legacy",
  "passing the torch",
  "new ownership",
  "acquisition",
  "business for sale",
  "exit planning",
  "winding down",
  "handing over",
];

const INDUSTRY_KEYWORDS = [
  "consolidation",
  "private equity",
  "M&A activity",
  "industry rollup",
  "acquisition spree",
  "market consolidation",
];

interface NewsResult {
  title: string;
  snippet: string;
  url: string;
  date: string;
  keyword_matched: string;
  type: "owner_exit_signal" | "industry_trend";
}

// ─── Search local news for owner-specific exit signals ──────────────────────

async function searchOwnerExitNews(
  ownerName: string,
  businessName: string,
  city: string | null,
  state: string | null,
): Promise<NewsResult[]> {
  const { chromium } = await import("playwright");
  const results: NewsResult[] = [];

  // Build search queries — one for the owner, one for the business
  const location = [city, state].filter(Boolean).join(", ");
  const queries = [
    `"${ownerName}" "${businessName}" (${EXIT_KEYWORDS.slice(0, 5).map(k => `"${k}"`).join(" OR ")})`,
    `"${businessName}" ${location} (${EXIT_KEYWORDS.slice(5).map(k => `"${k}"`).join(" OR ")})`,
  ];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    for (const query of queries) {
      // Use Google News search
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=qdr:y2`,
        { waitUntil: "domcontentloaded", timeout: 15000 },
      );
      await page.waitForTimeout(2000);

      const content = await page.content();
      if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
        break;
      }

      // Extract news results
      const newsItems = await page.$$eval("#search .SoaBEf, #search .WlydOe, #rso .g", (els: Element[]) =>
        els.slice(0, 5).map((el: Element) => {
          const titleEl = el.querySelector("[role='heading'], .n0jPhd, .mCBkyc, h3");
          const snippetEl = el.querySelector(".GI74Re, .VwiC3b, .IsZvec, .st");
          const dateEl = el.querySelector(".LfVVr, .WG9SHc, time, .OSrXXb");
          const linkEl = el.querySelector("a");
          return {
            title: (titleEl?.textContent || "").trim(),
            snippet: (snippetEl?.textContent || "").trim(),
            date: (dateEl?.textContent || "").trim(),
            url: (linkEl as HTMLAnchorElement)?.href || "",
          };
        }).filter((r: { title: string; snippet: string }) => r.title.length > 5),
      );

      // Match keywords
      for (const item of newsItems) {
        const combinedText = `${item.title} ${item.snippet}`.toLowerCase();
        for (const keyword of EXIT_KEYWORDS) {
          if (combinedText.includes(keyword.toLowerCase())) {
            results.push({
              ...item,
              keyword_matched: keyword,
              type: "owner_exit_signal",
            });
            break; // One keyword match per result
          }
        }
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch { /* ignore */ }
  finally {
    await browser.close();
  }

  return results;
}

// ─── Search for industry-level M&A/consolidation news ───────────────────────

async function searchIndustryNews(
  industryCategory: string,
  state: string | null,
): Promise<NewsResult[]> {
  const { chromium } = await import("playwright");
  const results: NewsResult[] = [];

  if (!industryCategory || industryCategory === "Unknown") return results;

  const query = `"${industryCategory}" ${state || ""} (${INDUSTRY_KEYWORDS.map(k => `"${k}"`).join(" OR ")})`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=qdr:y`,
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    await page.waitForTimeout(2000);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("CAPTCHA")) {
      return results;
    }

    const newsItems = await page.$$eval("#search .SoaBEf, #search .WlydOe, #rso .g", (els: Element[]) =>
      els.slice(0, 3).map((el: Element) => {
        const titleEl = el.querySelector("[role='heading'], .n0jPhd, .mCBkyc, h3");
        const snippetEl = el.querySelector(".GI74Re, .VwiC3b, .IsZvec");
        const dateEl = el.querySelector(".LfVVr, .WG9SHc, time, .OSrXXb");
        const linkEl = el.querySelector("a");
        return {
          title: (titleEl?.textContent || "").trim(),
          snippet: (snippetEl?.textContent || "").trim(),
          date: (dateEl?.textContent || "").trim(),
          url: (linkEl as HTMLAnchorElement)?.href || "",
        };
      }).filter((r: { title: string }) => r.title.length > 5),
    );

    for (const item of newsItems) {
      const combinedText = `${item.title} ${item.snippet}`.toLowerCase();
      for (const keyword of INDUSTRY_KEYWORDS) {
        if (combinedText.includes(keyword.toLowerCase())) {
          results.push({
            ...item,
            keyword_matched: keyword,
            type: "industry_trend",
          });
          break;
        }
      }
    }
  } catch { /* ignore */ }
  finally {
    await browser.close();
  }

  return results;
}

// ─── Main batch processor ───────────────────────────────────────────────────

export async function scanSuccessionNews(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ scanned: number; signals_found: number; skipped: number; failed: number }> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS succession_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      owner_signals TEXT,
      industry_signals TEXT,
      total_signals INTEGER DEFAULT 0,
      strongest_signal TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.city, l.state,
           ed.data as enrichment_json
    FROM leads l
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN succession_news sn ON sn.lead_id = l.id
    WHERE sn.id IS NULL
      AND l.enrichment_status NOT IN ('pending', 'scrape_failed')
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    city: string | null;
    state: string | null;
    enrichment_json: string | null;
  }[];

  const counts = { scanned: 0, signals_found: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const ownerName = enrichment.owner_name || null;

    if (!ownerName) {
      counts.skipped++;
      // Store empty result to avoid re-scanning
      db.prepare(`
        INSERT OR REPLACE INTO succession_news
        (lead_id, owner_signals, industry_signals, total_signals, strongest_signal, created_at)
        VALUES (?, '[]', '[]', 0, NULL, datetime('now'))
      `).run(row.id);
      continue;
    }

    try {
      // Search for owner-specific exit signals
      const ownerSignals = await searchOwnerExitNews(
        ownerName,
        row.business_name,
        row.city,
        row.state,
      );
      await new Promise((r) => setTimeout(r, 3000));

      // Search for industry-level M&A news
      const industrySignals = await searchIndustryNews(
        enrichment.industry_category || "",
        row.state,
      );

      const totalSignals = ownerSignals.length + industrySignals.length;
      const strongest = ownerSignals[0]?.keyword_matched || industrySignals[0]?.keyword_matched || null;

      db.prepare(`
        INSERT OR REPLACE INTO succession_news
        (lead_id, owner_signals, industry_signals, total_signals, strongest_signal, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(
        row.id,
        JSON.stringify(ownerSignals),
        JSON.stringify(industrySignals),
        totalSignals,
        strongest,
      );

      counts.scanned++;
      if (totalSignals > 0) counts.signals_found++;

      // Delay between leads
      const delay = 4000 + Math.random() * 3000;
      await new Promise((r) => setTimeout(r, delay));
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
