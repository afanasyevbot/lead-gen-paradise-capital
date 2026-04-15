import { getDb, setLeadStatus } from "@/lib/db";
import { acquireBrowser, releaseBrowser, randomUserAgent } from "@/infrastructure/scraper/browser-pool";
import type { ProgressCallback } from "@/domain/types";
import type { Page } from "playwright";

const TARGET_SLUGS = ["contact", "contact-us", "about", "about-us", "our-story", "our-team", "team", "leadership", "history", "company", "services"];
const MAX_PAGE_TEXT = 6000;
const MAX_TOTAL_TEXT = 28000;
const HARD_TIMEOUT_MS = 45000; // 45s hard ceiling per site — kills hanging scrapes

/** Wrap an async operation with an absolute timeout that rejects if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[TIMEOUT] ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Errors that mean the domain/site is permanently unreachable.
 * These leads should be marked no_website (terminal), not scrape_failed (retryable).
 */
function isTerminalError(err: string): boolean {
  return (
    err.includes("ERR_NAME_NOT_RESOLVED") ||
    err.includes("chromewebdata") ||          // chrome-error://chromewebdata/ = dead domain
    err.includes("ERR_ADDRESS_UNREACHABLE") ||
    err.includes("ERR_NAME_RESOLUTION_FAILED") ||
    err.includes("ERR_INTERNET_DISCONNECTED") ||
    err.includes("ERR_TOO_MANY_REDIRECTS")    // redirect loop — site permanently unscrapable
  );
}

function cleanText(text: string): string {
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  const noise = [
    /Accept\s+(All\s+)?Cookies?/gi,
    /We use cookies.*?\./gi,
    /Skip to (main )?content/gi,
    /Toggle navigation/gi,
  ];
  for (const pattern of noise) {
    text = text.replace(pattern, "");
  }
  return text.trim();
}

interface ScrapeResult {
  url: string;
  pages_scraped: number;
  total_text_length: number;
  homepage_text: string;
  about_text: string;
  all_text: string;
  error: string | null;
  terminalError?: boolean; // true = domain is dead, mark no_website not scrape_failed
}

async function scrapeWebsite(url: string, timeoutMs = 22000): Promise<ScrapeResult> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  const result: ScrapeResult = {
    url,
    pages_scraped: 0,
    total_text_length: 0,
    homepage_text: "",
    about_text: "",
    all_text: "",
    error: null,
  };

  const browser = await acquireBrowser();
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let page: import("playwright").Page | null = null;
  try {
    context = await browser.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, // handle expired/mismatched SSL certs on small business sites
    });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Load homepage with progressive fallbacks
    const loadPage = async (targetUrl: string): Promise<boolean> => {
      // Attempt 1: normal domcontentloaded
      try {
        await page!.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page!.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        return true;
      } catch (e) {
        const errStr = String(e);
        if (isTerminalError(errStr)) throw e; // re-throw terminal errors immediately

        // Attempt 2: commit (first byte received) — handles Cloudflare / heavy JS
        if (errStr.includes("Timeout") || errStr.includes("timeout")) {
          try {
            await page!.goto(targetUrl, { waitUntil: "commit", timeout: timeoutMs });
            await new Promise((r) => setTimeout(r, 3000)); // let JS render
            return true;
          } catch { /* fall through */ }
        }
        throw e;
      }
    };

    try {
      await loadPage(url);
    } catch (e) {
      const errStr = String(e);
      const friendlyError = (s: string) => {
        if (s.includes("ERR_TOO_MANY_REDIRECTS")) return "redirect loop";
        if (s.includes("ERR_NAME_NOT_RESOLVED") || s.includes("ERR_NAME_RESOLUTION_FAILED")) return "domain not found";
        if (s.includes("ERR_ADDRESS_UNREACHABLE")) return "host unreachable";
        if (s.includes("ERR_SSL") || s.includes("ERR_CERT")) return "SSL error";
        if (s.includes("ERR_CONNECTION_REFUSED")) return "connection refused";
        if (s.includes("ERR_CONNECTION_RESET")) return "connection reset";
        if (s.includes("Timeout") || s.includes("timeout")) return "timed out";
        return "failed to load";
      };
      // Try http:// fallback for SSL / connection errors on https
      if (
        url.startsWith("https://") && !isTerminalError(errStr) && (
          errStr.includes("ERR_SSL") ||
          errStr.includes("ERR_CERT") ||
          errStr.includes("ERR_CONNECTION_RESET") ||
          errStr.includes("ERR_CONNECTION_REFUSED")
        )
      ) {
        const httpUrl = url.replace("https://", "http://");
        try {
          await loadPage(httpUrl);
          url = httpUrl;
        } catch (e2) {
          const s2 = String(e2);
          result.error = friendlyError(s2);
          result.terminalError = isTerminalError(s2);
          return result;
        }
      } else {
        result.error = friendlyError(errStr);
        result.terminalError = isTerminalError(errStr);
        return result;
      }
    }

    // Verify we didn't land on a browser error page
    const currentUrl = page!.url();
    if (currentUrl.startsWith("chrome-error://") || currentUrl.startsWith("about:")) {
      result.error = `Domain unreachable (${currentUrl})`;
      result.terminalError = true;
      return result;
    }

    // Fix #2: explicitly close page before context to avoid resource leak
    const homepageText = cleanText(await page.innerText("body")).slice(0, MAX_PAGE_TEXT);
    result.homepage_text = homepageText;
    result.pages_scraped = 1;

    const allTexts = [`=== HOMEPAGE (${url}) ===\n${homepageText}`];
    let totalLen = homepageText.length;

    // Find about links
    const aboutUrls = await findAboutLinks(page!, url);

    // Scrape about pages
    const aboutTexts: string[] = [];
    for (const aboutUrl of aboutUrls) {
      if (totalLen >= MAX_TOTAL_TEXT) break;
      try {
        await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        const text = cleanText(await page.innerText("body")).slice(0, MAX_PAGE_TEXT);
        if (text.length > 100) {
          aboutTexts.push(text);
          allTexts.push(`=== ABOUT PAGE (${aboutUrl}) ===\n${text}`);
          totalLen += text.length;
          result.pages_scraped++;
        }
      } catch { /* skip */ }
    }

    result.about_text = aboutTexts.join("\n\n");
    result.all_text = allTexts.join("\n\n").slice(0, MAX_TOTAL_TEXT);
    result.total_text_length = result.all_text.length;
  } catch (e) {
    result.error = String(e);
  } finally {
    // Fix #2: close page explicitly before context — belt-and-suspenders resource cleanup
    try { if (page && !page.isClosed()) await page.close(); } catch { /* already closed */ }
    try { if (context) await context.close(); } catch { /* already closed */ }
    await releaseBrowser();
  }

  return result;
}

async function findAboutLinks(page: import("playwright").Page, baseUrl: string): Promise<string[]> {
  const aboutKeywords = new Set([
    "about", "about us", "our story", "our team", "team",
    "leadership", "history", "company", "who we are", "meet the team",
    "our company", "about the company", "founders", "owner",
    // Contact pages — emails and direct contact info live here
    "contact", "contact us", "get in touch", "reach us", "reach out",
    // Services pages — revenue signals and business scope
    "services", "our services", "what we do",
  ]);

  let links: { href: string; text: string }[] = [];
  try {
    links = await page.$$eval("a[href]", (els) =>
      els.map((el) => ({
        href: (el as HTMLAnchorElement).href,
        text: (el.textContent || "").trim().toLowerCase(),
      }))
    );
  } catch {
    return tryUrlPatterns(baseUrl);
  }

  const baseHost = new URL(baseUrl).hostname;
  const found: string[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    if (!link.href || link.href.startsWith("#") || link.href.startsWith("mailto:")) continue;
    const matchesKeyword = [...aboutKeywords].some((kw) => link.text.includes(kw));
    if (!matchesKeyword) continue;

    try {
      const linkUrl = new URL(link.href, baseUrl);
      if (linkUrl.hostname !== baseHost) continue;
      const normalized = linkUrl.href.replace(/\/$/, "");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        found.push(linkUrl.href);
      }
    } catch { /* skip */ }
  }

  if (found.length === 0) return tryUrlPatterns(baseUrl);

  // Prioritize contact pages first (emails!), then about/team pages
  found.sort((a, b) => {
    const score = (u: string) => /contact|reach|touch/i.test(u) ? -1 : 0;
    return score(a) - score(b);
  });
  return found.slice(0, 7);
}

function tryUrlPatterns(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, "");
  return TARGET_SLUGS.map((slug) => `${base}/${slug}`);
}

const BLOCKED_DOMAINS = [
  "google.com", "linkedin.com", "facebook.com", "instagram.com",
  "twitter.com", "x.com", "yelp.com", "bbb.org", "yellowpages.com",
  "mapquest.com", "angieslist.com", "houzz.com", "thumbtack.com",
  "angi.com", "homeadvisor.com", "manta.com", "whitepages.com",
  "bizapedia.com", "opencorporates.com", "crunchbase.com",
];

function isBlockedUrl(href: string): boolean {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch { return true; }
}

/**
 * Run a single Google search query and return the first usable organic result URL.
 * Returns null if rate-limited, no results, or all results are blocked directories.
 */
async function runGoogleSearch(query: string, page: Page): Promise<string | null> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1500);

    const content = await page.content();
    if (content.includes("unusual traffic") || content.includes("captcha")) {
      console.warn(`[WEBSITE DISCOVERY] Google rate limit hit — query: "${query}"`);
      return null;
    }

    const urls = await page.$$eval("div#search a[href]", (links) =>
      links.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith("http"))
    );

    for (const href of urls) {
      if (!isBlockedUrl(href)) {
        const url = new URL(href);
        return `${url.protocol}//${url.hostname}`;
      }
    }
    return null;
  } catch (err) {
    console.error(`[WEBSITE DISCOVERY] Search failed — query: "${query}":`, err);
    return null;
  }
}

interface XRayLeadContext {
  businessName: string;
  ownerName?: string | null;
  ownerTitle?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Google search for a company's website using their business name.
 * Used for X-Ray leads that have a company name from LinkedIn but no website URL.
 * Tries a chain of progressively broader queries before giving up.
 */
async function discoverWebsite(ctx: XRayLeadContext, page: Page): Promise<string | null> {
  const { businessName, ownerName, ownerTitle, city, state } = ctx;
  const location = [city, state].filter(Boolean).join(", ");

  // Build a fallback query chain — most specific first, broadest last
  const queries: string[] = [];

  // 1. Exact business name (original approach)
  queries.push(`"${businessName}" official website`);

  // 2. Business name + location (helps disambiguate common names)
  if (location) queries.push(`"${businessName}" ${location} website`);

  // 3. Owner name + title + location (useful when business_name is the person's name)
  if (ownerName && ownerTitle && location) {
    queries.push(`"${ownerName}" ${ownerTitle} ${location} company website`);
  } else if (ownerName && location) {
    queries.push(`"${ownerName}" ${location} company website`);
  }

  // 4. Owner name + title only (broadest — no location)
  if (ownerName && ownerTitle) {
    queries.push(`"${ownerName}" "${ownerTitle}" company site`);
  } else if (ownerName) {
    queries.push(`"${ownerName}" founder owner company`);
  }

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    let result: string | null = null;
    try {
      result = await runGoogleSearch(query, page);
    } catch { /* continue to next query */ }

    if (result) {
      if (i > 0) {
        console.log(`[WEBSITE DISCOVERY] Found via fallback query ${i + 1} for "${businessName}": ${result}`);
      }
      return result;
    }

    // Anti-detection delay between queries (skip after last attempt)
    if (i < queries.length - 1) {
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }
  }

  console.log(`[WEBSITE DISCOVERY] All ${queries.length} queries exhausted for "${businessName}" — no website found`);
  return null;
}

export async function scrapeLeadsWebsites(
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<{ scraped: number; failed: number; skipped: number; no_website: number; xray_websites_found: number; xray_linkedin_only: number }> {
  const db = getDb();

  // scraped_content table is created by the unified schema in db.ts.

  // ── Step 1: Discover websites for X-Ray leads ─────────────────────────────
  // X-Ray leads come from LinkedIn with a company name but no website URL.
  // Search Google for their company website and update the lead record.
  const xrayNoWebsite = db
    .prepare(
      `SELECT id, business_name, city, state, raw_data FROM leads
       WHERE enrichment_status = 'pending'
       AND source = 'linkedin_xray'
       AND (website IS NULL OR website = '') LIMIT ?`
    )
    .all(limit) as { id: number; business_name: string; city: string | null; state: string | null; raw_data: string | null }[];

  let xrayWebsitesFound = 0;
  let xrayNoWebsiteFound = 0;
  if (xrayNoWebsite.length > 0) {
    const browser = await acquireBrowser();
    const ctx = await browser.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();

    for (let i = 0; i < xrayNoWebsite.length; i++) {
      const xray = xrayNoWebsite[i];
      onProgress?.(i + 1, xrayNoWebsite.length, `Finding website: ${xray.business_name}`);

      // Parse raw_data for owner name/title stored at X-Ray ingest time
      let rawData: Record<string, unknown> = {};
      try { rawData = JSON.parse(xray.raw_data ?? "{}"); } catch { /* ignore */ }

      const xrayCtx: XRayLeadContext = {
        businessName: xray.business_name,
        ownerName: rawData.owner_name as string | null,
        ownerTitle: rawData.owner_title as string | null,
        city: xray.city,
        state: xray.state,
      };

      let website: string | null = null;
      try {
        // Up to 4 queries × ~20s each — allow 90s total
        website = await withTimeout(discoverWebsite(xrayCtx, page), 90000, `discover:${xray.business_name}`);
      } catch { /* timeout or error — treat as not found */ }
      if (website) {
        db.prepare("UPDATE leads SET website = ?, no_website_flag = 0, updated_at = datetime('now') WHERE id = ?")
          .run(website, xray.id);
        xrayWebsitesFound++;
      } else {
        // No website found — promote to scraped with empty content so extract
        // can still use LinkedIn data (name, title, headline)
        db.prepare(
          `INSERT OR IGNORE INTO scraped_content (lead_id, homepage_text, about_text, all_text, pages_scraped, scraped_at)
           VALUES (?, '', '', '', 0, datetime('now'))`
        ).run(xray.id);
        setLeadStatus(xray.id, "scraped");
        xrayNoWebsiteFound++;
      }

      // Anti-detection: random delay between Google searches
      if (i < xrayNoWebsite.length - 1) {
        await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000)); // 4-10s
      }
    }

    try { await page.close(); } catch { /* */ }
    try { await ctx.close(); } catch { /* */ }
    await releaseBrowser();
  }

  // ── Step 2: Mark non-X-Ray leads with no website as terminal ──────────────
  const noWebsiteLeads = db
    .prepare(
      `SELECT id FROM leads WHERE enrichment_status = 'pending'
       AND source != 'linkedin_xray'
       AND (website IS NULL OR website = '') LIMIT ?`
    )
    .all(limit) as { id: number }[];
  for (const { id } of noWebsiteLeads) {
    try { setLeadStatus(id, "no_website"); } catch { /* best-effort */ }
  }

  // ── Step 3: Scrape all pending leads that now have websites ───────────────
  // This includes X-Ray leads whose websites were just discovered above
  const leads = db
    .prepare(
      `SELECT * FROM leads WHERE enrichment_status = 'pending'
       AND website IS NOT NULL AND website != '' LIMIT ?`
    )
    .all(limit) as { id: number; website: string; business_name: string }[];

  const counts = { scraped: 0, failed: 0, skipped: 0, no_website: noWebsiteLeads.length, xray_websites_found: xrayWebsitesFound, xray_linkedin_only: xrayNoWebsiteFound };

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    onProgress?.(i + 1, leads.length, lead.business_name);

    // Check if already scraped
    const existing = db.prepare("SELECT id FROM scraped_content WHERE lead_id = ?").get(lead.id);
    if (existing) {
      counts.skipped++;
      continue;
    }

    let result: Awaited<ReturnType<typeof scrapeWebsite>>;
    try {
      result = await withTimeout(scrapeWebsite(lead.website), HARD_TIMEOUT_MS, lead.business_name);
    } catch (e) {
      // Hard timeout or unexpected crash — mark as failed and move on
      console.error(`[SCRAPE] Hard timeout/crash for ${lead.business_name}:`, String(e));
      counts.failed++;
      setLeadStatus(lead.id, "scrape_failed");
      continue;
    }

    if (result.error || result.total_text_length < 150) {
      counts.failed++;
      if (result.terminalError) {
        try { setLeadStatus(lead.id, "no_website"); } catch { /* ignore */ }
      } else {
        setLeadStatus(lead.id, "scrape_failed");
      }
    } else {
      counts.scraped++;
      db.prepare(
        `INSERT OR REPLACE INTO scraped_content (lead_id, homepage_text, about_text, all_text, pages_scraped, scraped_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).run(lead.id, result.homepage_text, result.about_text, result.all_text, result.pages_scraped);
      setLeadStatus(lead.id, "scraped");
    }
  }

  return counts;
}

/**
 * Scrape the website for a single specific lead by ID.
 * Used by the per-lead action endpoint so scraping can be triggered
 * from the Leads page without touching other pending leads.
 */
export async function scrapeLeadWebsiteById(
  leadId: number,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const lead = db
    .prepare("SELECT id, website, business_name, enrichment_status FROM leads WHERE id = ?")
    .get(leadId) as { id: number; website: string | null; business_name: string; enrichment_status: string } | undefined;

  if (!lead) return { success: false, error: "Lead not found" };

  if (!lead.website) {
    try { setLeadStatus(lead.id, "no_website"); } catch { /* ignore */ }
    return { success: false, error: "Lead has no website URL" };
  }

  let result: Awaited<ReturnType<typeof scrapeWebsite>>;
  try {
    result = await withTimeout(scrapeWebsite(lead.website), HARD_TIMEOUT_MS, lead.business_name);
  } catch (e) {
    try { setLeadStatus(lead.id, "scrape_failed"); } catch { /* ignore */ }
    return { success: false, error: `Scrape timed out: ${String(e)}` };
  }

  if (result.error || result.total_text_length < 150) {
    if (result.terminalError) {
      try { setLeadStatus(lead.id, "no_website"); } catch {
        db.prepare("UPDATE leads SET enrichment_status = 'no_website', updated_at = datetime('now') WHERE id = ?").run(lead.id);
      }
      return { success: false, error: result.error || "Dead domain" };
    }
    try { setLeadStatus(lead.id, "scrape_failed"); } catch { /* ignore */ }
    return { success: false, error: result.error || "Too little content scraped" };
  }

  db.prepare(
    `INSERT OR REPLACE INTO scraped_content (lead_id, homepage_text, about_text, all_text, pages_scraped, scraped_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(lead.id, result.homepage_text, result.about_text, result.all_text, result.pages_scraped);

  // Advance status to 'scraped' (handles any current status gracefully)
  try {
    setLeadStatus(lead.id, "scraped");
  } catch {
    // Status machine may reject some transitions (e.g. enriched → scraped).
    // Force it directly — scraping is always safe to redo.
    db.prepare("UPDATE leads SET enrichment_status = 'scraped', updated_at = datetime('now') WHERE id = ?").run(lead.id);
  }

  return { success: true };
}
