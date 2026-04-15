import { createHash } from "crypto";
import { isChain } from "@/lib/config";
import { acquireBrowser, releaseBrowser, randomUserAgent } from "@/infrastructure/scraper/browser-pool";

const MAX_RESULTS_PER_SEARCH = 60;

// ── Anti-detection: randomized timing ──────────────────────────────────
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, randInt(minMs, maxMs)));
}

// Slight viewport variations to avoid fingerprinting
function randomViewport(): { width: number; height: number } {
  const widths = [1280, 1366, 1440, 1536, 1600, 1920];
  const heights = [800, 900, 1024, 864, 1080];
  return {
    width: widths[Math.floor(Math.random() * widths.length)],
    height: heights[Math.floor(Math.random() * heights.length)],
  };
}

// Delay between separate search queries — longer = less detectable
const INTER_QUERY_DELAY_MIN = 15_000;
const INTER_QUERY_DELAY_MAX = 30_000;
export async function interQueryDelay(): Promise<void> {
  const ms = randInt(INTER_QUERY_DELAY_MIN, INTER_QUERY_DELAY_MAX);
  console.log(`[GMAPS] Waiting ${(ms / 1000).toFixed(1)}s before next query...`);
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Inject stealth overrides into every page to mask Playwright automation.
 * Must be called after context.newPage() and before page.goto().
 */
async function injectStealthScripts(page: import("playwright").Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove the webdriver flag — #1 bot signal
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Fake a realistic plugin list (headless has 0 plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        (arr as unknown as { length: number }).length = arr.length;
        return arr;
      },
    });

    // Fake languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });

    // Fake hardware concurrency (headless often reports 1)
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });

    // Remove automation-related Chrome properties
    // @ts-ignore
    delete (window as unknown as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    // @ts-ignore
    delete (window as unknown as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    // @ts-ignore
    delete (window as unknown as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // Spoof permissions API
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery.call(window.navigator.permissions, parameters);
    }
  });
}

function makePlaceId(name: string, address: string): string {
  const raw = `${name.trim().toLowerCase()}|${address.trim().toLowerCase()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function parseAddress(address: string): { city: string | null; state: string | null; zip_code: string | null } {
  const result = { city: null as string | null, state: null as string | null, zip_code: null as string | null };
  if (!address) return result;

  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    result.city = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    const last = parts[parts.length - 1];
    const match = last.match(/([A-Z]{2})\s*(\d{5})?/);
    if (match) {
      result.state = match[1];
      result.zip_code = match[2] || null;
    }
  }
  return result;
}

function extractRatingReviews(text: string): { rating: number | null; reviews: number | null } {
  const match = text.match(/(\d\.\d)\s*\((\d[\d,]*)\)/);
  if (match) {
    return { rating: parseFloat(match[1]), reviews: parseInt(match[2].replace(/,/g, ""), 10) };
  }
  const ratingOnly = text.match(/(\d\.\d)/);
  if (ratingOnly) return { rating: parseFloat(ratingOnly[1]), reviews: null };
  return { rating: null, reviews: null };
}

export interface ScrapedLead {
  place_id: string;
  business_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  review_count: number;
  business_types: string[];
  latitude: number | null;
  longitude: number | null;
  source: string;
  search_query: string;
  search_location: string;
  is_chain: number;
  high_review_flag: number;
  no_website_flag: number;
  raw_data: Record<string, unknown>;
}

export async function searchPlaces(
  query: string,
  location: string,
  maxResults = MAX_RESULTS_PER_SEARCH,
): Promise<ScrapedLead[]> {
  const fullQuery = `${query} in ${location}`;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;

  const leads: ScrapedLead[] = [];

  const browser = await acquireBrowser();
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    const ua = randomUserAgent();
    const vp = randomViewport();
    context = await browser.newContext({
      userAgent: ua,
      viewport: vp,
      locale: "en-US",
    });
    const page = await context.newPage();

    // Inject stealth scripts BEFORE any navigation
    await injectStealthScripts(page);

    // Block unnecessary resources to reduce bandwidth fingerprint
    await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2}", (route) => route.abort());

    console.log(`[GMAPS] Searching: "${query}" in "${location}" (UA: ${ua.slice(0, 40)}..., viewport: ${vp.width}x${vp.height})`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Human-like initial wait — varies between 2-5 seconds
    await randDelay(2000, 5000);

    // Detect Google bot detection / CAPTCHA before proceeding
    const pageContent = await page.content();
    const pageTitle = await page.title();
    const currentUrl = page.url();

    if (
      pageContent.includes("detected unusual traffic") ||
      pageContent.includes("Our systems have detected unusual traffic") ||
      pageContent.includes("captcha") ||
      pageContent.includes("CAPTCHA") ||
      pageContent.includes("g-recaptcha")
    ) {
      console.error(`[GMAPS] BOT DETECTION for "${query}" in "${location}". Page title: "${pageTitle}", URL: ${currentUrl}`);
      return leads;
    }

    // Log page state for debugging
    if (pageContent.includes("consent.google.com") || pageContent.includes("Before you continue")) {
      console.warn(`[GMAPS] Consent/cookie wall detected for "${query}" in "${location}"`);
    }

    // Accept cookies/consent if prompted — handles English, Dutch, French, German, Spanish
    try {
      const consentSelectors = [
        "button:has-text('Accept all')",       // English
        "button:has-text('Alles accepteren')", // Dutch
        "button:has-text('Tout accepter')",    // French
        "button:has-text('Alle akzeptieren')", // German
        "button:has-text('Aceptar todo')",     // Spanish
        "button:has-text('Accetta tutto')",    // Italian
        "form:nth-of-type(2) button",          // Generic fallback — 2nd form = accept
      ];
      let accepted = false;
      for (const selector of consentSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            console.log(`[GMAPS] Accepting consent dialog via: ${selector}`);
            await btn.click();
            await page.waitForTimeout(2000);
            accepted = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (accepted) {
        // After accepting, wait for Maps to load
        await page.waitForSelector("[role='feed'], div.Nv2PK", { timeout: 15000 }).catch(() => {});
      }
    } catch { /* ignore */ }

    // Wait for results
    let feedFound = false;
    try {
      await page.waitForSelector("[role='feed']", { timeout: 10000 });
      feedFound = true;
    } catch {
      try {
        await page.waitForSelector("div.Nv2PK", { timeout: 5000 });
        feedFound = true;
      } catch {
        // Grab diagnostic info before returning empty
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "(empty)");
        console.error(`[GMAPS] NO RESULTS FEED for "${query}" in "${location}". Title: "${pageTitle}", URL: ${currentUrl}, Body preview: ${bodyText}`);
        return leads;
      }
    }

    // Warn on suspiciously low yield — may indicate soft blocking
    const MINIMUM_EXPECTED_YIELD = 3;
    const earlyCount = await page.locator("div.Nv2PK").count();
    if (earlyCount < MINIMUM_EXPECTED_YIELD) {
      console.warn(`[GMAPS] Low yield: ${earlyCount} results for "${query}" in "${location}". May be rate-limited.`);
    } else {
      console.log(`[GMAPS] Found ${earlyCount} initial results for "${query}" in "${location}"`);
    }

    // Scroll to load more results — incremental human-like scrolling
    const feed = page.locator("[role='feed']").first();
    let prevCount = 0;
    let scrollAttempts = 0;

    while (scrollAttempts < 15) {
      const listings = await page.locator("div.Nv2PK").all();
      const currentCount = listings.length;

      if (currentCount >= maxResults) break;
      if (currentCount === prevCount) {
        scrollAttempts++;
        if (scrollAttempts >= 3) {
          const endMarker = page.locator("span.HlvSq");
          if ((await endMarker.count()) > 0) break;
        }
      } else {
        scrollAttempts = 0;
      }
      prevCount = currentCount;

      // Human-like incremental scroll instead of instant jump to bottom
      await feed.evaluate((el) => {
        const step = Math.floor(300 + Math.random() * 300); // 300-600px per tick
        el.scrollTop += step;
      });
      await randDelay(800, 2000);

      // Occasionally do a bigger scroll to seem more natural
      if (Math.random() < 0.3) {
        await feed.evaluate((el) => { el.scrollTop += Math.floor(500 + Math.random() * 400); });
        await randDelay(500, 1200);
      }
    }

    // Extract each listing
    const listings = await page.locator("div.Nv2PK").all();
    console.log(`[GMAPS] Extracting ${Math.min(listings.length, maxResults)} of ${listings.length} listings for "${query}" in "${location}"`);
    let extractFails = 0;
    for (const listing of listings.slice(0, maxResults)) {
      try {
        const lead = await extractListing(listing, page, query, location);
        if (lead) leads.push(lead);
      } catch {
        extractFails++;
      }
    }
    if (extractFails > 0) {
      console.warn(`[GMAPS] ${extractFails} extraction failures for "${query}" in "${location}"`);
    }
  } finally {
    try { if (context) await context.close(); } catch { /* already closed */ }
    await releaseBrowser();
  }

  console.log(`[GMAPS] Finished "${query}" in "${location}": ${leads.length} leads extracted`);
  return leads;
}

async function extractListing(
  listing: Awaited<ReturnType<import("playwright").Page["locator"]>>,
  page: import("playwright").Page,
  searchQuery: string,
  searchLocation: string,
): Promise<ScrapedLead | null> {
  const nameEl = listing.locator("a.hfpxzc").first();
  const name = (await nameEl.getAttribute("aria-label")) || "";
  if (!name) return null;

  await nameEl.click();
  // Human-like wait after clicking a listing — varies 1.5-4s
  await randDelay(1500, 4000);

  let address = "";
  let phone = "";
  let website = "";
  let rating: number | null = null;
  let reviews: number | null = null;
  let category = "";

  try {
    const addrEl = page.locator("button[data-item-id='address']").first();
    if ((await addrEl.count()) > 0) {
      address = ((await addrEl.getAttribute("aria-label")) || "").replace("Address: ", "");
    }
  } catch { /* skip */ }

  try {
    const phoneEl = page.locator("button[data-item-id*='phone']").first();
    if ((await phoneEl.count()) > 0) {
      phone = ((await phoneEl.getAttribute("aria-label")) || "").replace("Phone: ", "");
    }
  } catch { /* skip */ }

  try {
    const webEl = page.locator("a[data-item-id='authority']").first();
    if ((await webEl.count()) > 0) {
      website = (await webEl.getAttribute("href")) || "";
    }
  } catch { /* skip */ }

  try {
    const ratingText = await page.locator("div.F7nice").first().innerText({ timeout: 2000 });
    const parsed = extractRatingReviews(ratingText);
    rating = parsed.rating;
    reviews = parsed.reviews;
  } catch { /* skip */ }

  try {
    const catEl = page.locator("button.DkEaL").first();
    if ((await catEl.count()) > 0) {
      category = await catEl.innerText({ timeout: 1000 });
    }
  } catch { /* skip */ }

  const addrParts = parseAddress(address);
  const reviewCount = reviews ?? 0;

  return {
    place_id: makePlaceId(name, address),
    business_name: name,
    address: address || null,
    city: addrParts.city,
    state: addrParts.state,
    zip_code: addrParts.zip_code,
    phone: phone || null,
    website: website || null,
    google_rating: rating,
    review_count: reviewCount,
    business_types: category ? [category] : [],
    latitude: null,
    longitude: null,
    source: "google_maps",
    search_query: searchQuery,
    search_location: searchLocation,
    is_chain: isChain(name) ? 1 : 0,
    high_review_flag: reviewCount >= 500 ? 1 : 0,
    no_website_flag: website ? 0 : 1,
    raw_data: { name, address, phone, website, rating, reviews, category },
  };
}
