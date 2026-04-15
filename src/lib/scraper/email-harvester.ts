/**
 * Email Harvester
 *
 * Extracts emails from a Playwright Page using multiple strategies, not just
 * innerText scanning. Most business sites hide emails in:
 *   - <a href="mailto:..."> hrefs (visible text is often just "Contact us")
 *   - Cloudflare email protection (<a data-cfemail="...">) — hex-encoded
 *   - Obfuscated patterns: "john [at] company [dot] com"
 *   - data- attributes / JSON-LD / JavaScript variables
 *
 * Relying on innerText misses all of these.
 */

import type { Page } from "playwright";

// Two regex constants. The `g` flag advances `lastIndex` on `.test()` which
// makes a single shared instance return different results on successive calls —
// a subtle source of missed matches. Use `_G` for match loops, plain for tests.
const EMAIL_REGEX_G = () => /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
const EMAIL_REGEX = /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i;
// Reject images, fonts, and other asset-URL-looking addresses
const ASSET_TLD_RE = /@[\w.-]+\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|eot|ico|mp4|mp3|pdf)$/i;

/**
 * Decode Cloudflare email protection hex string.
 * Cloudflare replaces <a href="mailto:x@y.com"> with
 * <a data-cfemail="<hex>"> where <hex> XOR-encodes the email.
 *
 * Algorithm: first byte is the XOR key, remaining bytes are the email
 * chars XORed with that key.
 */
export function decodeCfEmail(hex: string): string | null {
  if (!hex || hex.length < 4 || hex.length % 2 !== 0) return null;
  if (!/^[a-f0-9]+$/i.test(hex)) return null;
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let email = "";
    for (let i = 2; i < hex.length; i += 2) {
      email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    }
    return EMAIL_REGEX.test(email) ? email : null;
  } catch { return null; }
}

/**
 * Deobfuscate common "john [at] company [dot] com" style patterns.
 * ONLY touches bracketed/parenthesised forms. We deliberately do NOT replace
 * the bare " at " / " dot " because that corrupts normal prose ("based at
 * Dallas" → "based@Dallas") and the subsequent email regex then extracts
 * fake addresses with misleading confidence.
 */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
    .replace(/\s*\{\s*at\s*\}\s*/gi, "@")
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    .replace(/\s*\{\s*dot\s*\}\s*/gi, ".");
}

/** Return true if the address looks like junk (asset URL, placeholder, too long). */
function isJunkEmail(e: string): boolean {
  if (e.length > 80) return true;
  if (ASSET_TLD_RE.test(e)) return true;
  if (/@(sentry|example|test|domain|yourdomain|email|site)\.(io|com|org)/.test(e)) return true;
  if (/@\d+x\./.test(e)) return true; // "image@2x.png"
  return false;
}

export interface HarvestResult {
  emails: string[]; // deduped, lowercased
  phones: string[]; // deduped
}

/**
 * Harvest emails from a loaded Playwright page.
 * Pulls from four sources and merges:
 *   1. mailto: hrefs (most reliable)
 *   2. Cloudflare data-cfemail attributes (decoded)
 *   3. Regex over full HTML (catches inline scripts, JSON-LD)
 *   4. Regex over deobfuscated text (catches "[at]" / "[dot]")
 */
export async function harvestContactsFromPage(page: Page): Promise<HarvestResult> {
  const emails = new Set<string>();
  const phones = new Set<string>();

  try {
    // 1. mailto: hrefs
    const mailtos: string[] = await page.$$eval(
      "a[href^='mailto:']",
      (els) => els.map((a) => (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0]),
    );
    for (const m of mailtos) {
      const addr = m.trim().toLowerCase();
      if (addr && EMAIL_REGEX.test(addr) && !isJunkEmail(addr)) emails.add(addr);
    }
  } catch { /* ignore */ }

  try {
    // 2. Cloudflare protected emails
    const cfHex: string[] = await page.$$eval(
      "[data-cfemail]",
      (els) => els.map((el) => el.getAttribute("data-cfemail") || ""),
    );
    for (const hex of cfHex) {
      const decoded = decodeCfEmail(hex);
      if (decoded) emails.add(decoded.toLowerCase());
    }
  } catch { /* ignore */ }

  try {
    // 3. Full HTML regex (catches inline JS, JSON-LD schema blocks)
    const html = await page.content();
    const fromHtml = html.match(EMAIL_REGEX_G()) ?? [];
    for (const e of fromHtml) {
      const lower = e.toLowerCase();
      if (isJunkEmail(lower)) continue;
      emails.add(lower);
    }

    // 4. Deobfuscated text regex
    const text = await page.innerText("body").catch(() => "");
    const deob = deobfuscate(text);
    const fromText = deob.match(EMAIL_REGEX_G()) ?? [];
    for (const e of fromText) {
      const lower = e.toLowerCase();
      if (isJunkEmail(lower)) continue;
      emails.add(lower);
    }

    // Phones — capture from tel: hrefs + text
    const telHrefs: string[] = await page
      .$$eval("a[href^='tel:']", (els) => els.map((a) => (a as HTMLAnchorElement).href.replace(/^tel:/i, "")))
      .catch(() => [] as string[]);
    for (const t of telHrefs) {
      const cleaned = t.replace(/[^\d+]/g, "");
      if (cleaned.length >= 10) phones.add(cleaned);
    }
  } catch { /* ignore */ }

  return {
    emails: [...emails],
    phones: [...phones],
  };
}

/**
 * Harvest from a raw HTML+text pair (e.g. already-scraped content in DB)
 * when we don't have a live Playwright page.
 */
export function harvestContactsFromStored(html: string, text: string): HarvestResult {
  const emails = new Set<string>();

  // Extract mailto hrefs via string parsing
  const mailtoRe = /mailto:([^"'?\s<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) {
    emails.add(m[1].toLowerCase());
  }

  // Cloudflare emails
  const cfRe = /data-cfemail=["']([a-f0-9]+)["']/gi;
  while ((m = cfRe.exec(html)) !== null) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded) emails.add(decoded.toLowerCase());
  }

  // HTML regex
  const fromHtml = html.match(EMAIL_REGEX_G()) ?? [];
  for (const e of fromHtml) {
    const lower = e.toLowerCase();
    if (isJunkEmail(lower)) continue;
    emails.add(lower);
  }

  // Deobfuscated text
  const deob = deobfuscate(text);
  const fromText = deob.match(EMAIL_REGEX_G()) ?? [];
  for (const e of fromText) {
    const lower = e.toLowerCase();
    if (isJunkEmail(lower)) continue;
    emails.add(lower);
  }

  return { emails: [...emails], phones: [] };
}

/**
 * Given a lead's domain and a list of harvested emails, pick the best one.
 * Preference:
 *   1. Personal @ own-domain     (john@acme.com)
 *   2. Personal @ other-domain   (john@gmail.com — rare but real)
 *   3. Generic @ own-domain      (info@acme.com)
 *   4. Generic @ other-domain
 */
export const GENERIC_PREFIXES = /^(info|contact|hello|support|admin|sales|enquir\w*|inquir\w*|mail|office|noreply|no-?reply|webmaster|team|help|service|care|general|main|marketing|billing|accounts?)@/i;

export function rankEmails(emails: string[], domain: string): string[] {
  const norm = domain.replace(/^www\./, "").toLowerCase();
  const scored = emails
    .map((e) => {
      const parts = e.split("@");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
      const [local, host] = parts;
      const isOwnDomain = host === norm || host.endsWith(`.${norm}`);
      const isGeneric = GENERIC_PREFIXES.test(e);
      let score = 0;
      if (isOwnDomain) score += 10;
      if (!isGeneric) score += 5;
      // Prefer shorter local parts (john@ > jsmith123@)
      score -= Math.min(5, Math.floor(local.length / 3));
      return { e, score };
    })
    .filter((x): x is { e: string; score: number } => x !== null);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.e);
}
