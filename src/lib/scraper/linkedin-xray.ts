import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface XRayProfile {
  place_id: string;
  business_name: string;
  owner_name: string | null;
  owner_title: string | null;
  linkedin_url: string;
  snippet: string;
  location: string;
  source: "linkedin_xray";
  search_query: string;
}

export interface XRaySearchOptions {
  titles: string[];     // e.g. ["founder", "owner", "president"]
  industry: string;     // e.g. "hvac"
  location: string;     // e.g. "Tampa, Florida"
  maxResults?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePlaceId(linkedinUrl: string): string {
  return createHash("sha256").update(`xray|${linkedinUrl.toLowerCase()}`).digest("hex").slice(0, 16);
}

/**
 * Parse a LinkedIn Google snippet title into name / title / company.
 * Common formats:
 *   "John Doe - Founder & CEO - Doe HVAC Services | LinkedIn"
 *   "John Doe - Founder at Company Name | LinkedIn"
 *   "John Doe | LinkedIn"
 */
function parseLinkedInSnippetTitle(raw: string): {
  name: string;
  ownerTitle: string | null;
  company: string | null;
} {
  const title = raw.replace(/\s*\|\s*LinkedIn\s*$/, "").trim();
  const parts = title.split(/\s*[-–]\s*/);

  const name = parts[0]?.trim() || "";
  let ownerTitle: string | null = null;
  let company: string | null = null;

  if (parts.length >= 3) {
    ownerTitle = parts[1]?.trim() || null;
    company = parts.slice(2).join(" - ").trim() || null;
  } else if (parts.length === 2) {
    const second = parts[1]?.trim() || "";
    const atMatch = second.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) {
      ownerTitle = atMatch[1].trim();
      company = atMatch[2].trim();
    } else {
      ownerTitle = second || null;
    }
  }

  // Strip generic suffixes from company name
  if (company) {
    company = company.replace(/\s*\|\s*LinkedIn.*$/, "").trim();
  }

  return { name, ownerTitle, company };
}

function cleanLinkedInUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Keep only origin + /in/slug — drop query params and trailing slash
    const pathMatch = u.pathname.match(/^\/in\/[^/]+/);
    if (pathMatch) return `${u.origin}${pathMatch[0]}`;
  } catch { /* ignore */ }
  return raw.split("?")[0].replace(/\/$/, "");
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

/**
 * Run one Serper search and return raw organic results.
 * Simple queries (one title, no OR operators) avoid Serper's "Query not allowed" block.
 */
async function runSerperSearch(
  apiKey: string,
  query: string,
  num: number,
): Promise<Array<{ link: string; title: string; snippet?: string }>> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: Math.min(num, 100),
      gl: "us",
      hl: "en",
      // Use siteSearch param instead of site: in query — more reliable with Serper
      siteSearch: "linkedin.com/in",
      siteSearchType: "include",
    }),
  });

  if (!res.ok) {
    throw new Error(`Serper API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as {
    organic?: Array<{ link: string; title: string; snippet?: string }>;
  };
  console.log(`[XRAY] query="${query}" → ${data.organic?.length ?? 0} results`);
  return data.organic ?? [];
}

/**
 * Search Google using site:linkedin.com/in X-Ray syntax to find founder/owner
 * profiles without hitting LinkedIn directly (no login required).
 *
 * Runs one simple query per title to avoid Serper's OR-operator block.
 * Returns parsed profile stubs ready to be upserted as leads.
 */
export async function searchLinkedInXRay(opts: XRaySearchOptions): Promise<XRayProfile[]> {
  const { titles, industry, location, maxResults = 40 } = opts;

  // Read at runtime — NOT from a module-level const (Turbopack inlines those at build time)
  const apiKey = String(process.env["SERPER_API_KEY"] || process.env["serper"] || "");
  if (!apiKey) throw new Error("SERPER_API_KEY is not set — add it in Railway Variables");

  const results: XRayProfile[] = [];
  const seen = new Set<string>();

  // Use city only — LinkedIn profiles use "Tampa, FL" not "Tampa, Florida"
  const cityOnly = location.split(",")[0].trim();

  // Run one query per title — avoids Serper blocking complex OR queries on site:linkedin.com/in
  const perTitle = Math.ceil(maxResults / titles.length);
  for (const title of titles) {
    if (results.length >= maxResults) break;

    // Don't quote industry — avoids case-sensitivity issues (hvac vs HVAC)
    // Don't quote city — LinkedIn uses short forms ("Tampa, FL") not full state names
    // intitle: matches the LinkedIn headline (current role), not buried past roles
    const query = `intitle:"${title}" ${industry} ${cityOnly}`;
    let organic: Array<{ link: string; title: string; snippet?: string }>;
    try {
      organic = await runSerperSearch(apiKey, query, perTitle);
    } catch (e) {
      console.warn(`[XRAY] Search failed for title "${title}":`, String(e));
      continue;
    }

    for (const item of organic) {
      if (results.length >= maxResults) break;
      if (!item.link?.includes("linkedin.com/in/")) continue;
      const cleanUrl = cleanLinkedInUrl(item.link);
      if (seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);

      const parsed = parseLinkedInSnippetTitle(item.title ?? "");
      if (!parsed.name) continue;

      const businessName = parsed.company || `${parsed.name} — ${industry} (${location})`;

      results.push({
        place_id: makePlaceId(cleanUrl),
        business_name: businessName,
        owner_name: parsed.name || null,
        owner_title: parsed.ownerTitle || null,
        linkedin_url: cleanUrl,
        snippet: (item.snippet ?? "").slice(0, 500),
        location,
        source: "linkedin_xray",
        search_query: query,
      });
    }

    // Polite delay between per-title queries
    if (titles.indexOf(title) < titles.length - 1) {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
  }

  console.log(`[XRAY] "${industry}" in "${location}": found ${results.length} profiles`);
  return results;
}
