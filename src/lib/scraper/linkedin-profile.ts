/**
 * LinkedIn profile visitor — visits actual linkedin.com/in/[slug] pages
 * using an injected session cookie (li_at) so no login wall is hit.
 *
 * Returns structured profile data: about text, experience, education.
 * Falls back gracefully if session is expired or profile is private.
 */

import { acquireBrowser, releaseBrowser, randomUserAgent } from "@/infrastructure/scraper/browser-pool";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInExperienceItem {
  title: string;
  company: string;
  duration: string;
}

export interface LinkedInEducationItem {
  school: string;
  degree: string;
  years: string;
}

export interface LinkedInProfileData {
  linkedin_url: string;
  name: string | null;
  headline: string | null;
  about_text: string | null;
  location: string | null;
  experience: LinkedInExperienceItem[];
  education: LinkedInEducationItem[];
  connections: string | null;
  session_valid: boolean;
  error: string | null;
}

// ─── Cookie loading ───────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const SESSION_PATH = path.resolve(process.cwd(), "data", "linkedin-session.json");

export function loadLinkedInCookie(): string | null {
  try {
    if (!fs.existsSync(SESSION_PATH)) return null;
    const raw = fs.readFileSync(SESSION_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.li_at || null;
  } catch {
    return null;
  }
}

export function saveLinkedInCookie(liAt: string): void {
  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ li_at: liAt, saved_at: new Date().toISOString() }), "utf-8");
}

export function hasLinkedInSession(): boolean {
  return !!loadLinkedInCookie();
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

export async function visitLinkedInProfile(
  linkedinUrl: string,
): Promise<LinkedInProfileData> {
  const result: LinkedInProfileData = {
    linkedin_url: linkedinUrl,
    name: null,
    headline: null,
    about_text: null,
    location: null,
    experience: [],
    education: [],
    connections: null,
    session_valid: false,
    error: null,
  };

  const liAt = loadLinkedInCookie();
  if (!liAt) {
    result.error = "No LinkedIn session cookie configured";
    return result;
  }

  // Normalize URL
  const profileUrl = linkedinUrl.replace(/^www\./, "https://www.").startsWith("http")
    ? linkedinUrl
    : `https://www.linkedin.com/in/${linkedinUrl.split("/in/").pop()}`;

  const browser = await acquireBrowser();
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  try {
    context = await browser.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Inject the session cookie — this is what bypasses the login wall
    await context.addCookies([
      {
        name: "li_at",
        value: liAt,
        domain: ".linkedin.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ]);

    const page = await context.newPage();
    page.setDefaultTimeout(25000);

    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const currentUrl = page.url();

    // Detect login wall / auth wall
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/authwall") ||
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/uas/login")
    ) {
      result.error = "LinkedIn session expired — cookie needs to be refreshed";
      result.session_valid = false;
      return result;
    }

    result.session_valid = true;

    // ── Extract profile data ───────────────────────────────────────────────
    const profileData = await page.evaluate(() => {
      // Helper: get clean text from element
      const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() || null;

      // ── Name & Headline ─────────────────────────────────────────────────
      const name =
        text(document.querySelector("h1.text-heading-xlarge")) ||
        text(document.querySelector(".pv-top-card--list li:first-child")) ||
        text(document.querySelector("h1"));

      const headline =
        text(document.querySelector(".text-body-medium.break-words")) ||
        text(document.querySelector(".pv-top-card--list .text-body-medium")) ||
        null;

      // ── Location ────────────────────────────────────────────────────────
      const location =
        text(document.querySelector(".pv-top-card--list .text-body-small:not(.inline)")) ||
        text(document.querySelector(".pv-top-card-section__location")) ||
        null;

      // ── Connections ─────────────────────────────────────────────────────
      const connEl = document.querySelector(".pv-top-card--list .t-black--light .link-without-visited-state");
      const connections = text(connEl);

      // ── About ────────────────────────────────────────────────────────────
      // Try expanding "see more" first (may not work without click, but try)
      const aboutSection = document.querySelector("#about");
      let about: string | null = null;
      if (aboutSection) {
        // Walk to the adjacent content container
        let sibling = aboutSection.nextElementSibling;
        while (sibling) {
          const t = sibling.textContent?.replace(/\s+/g, " ").trim();
          if (t && t.length > 20) {
            about = t.slice(0, 2000);
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }
      if (!about) {
        const aboutEl =
          document.querySelector(".pv-about-section .inline-show-more-text") ||
          document.querySelector("[data-generated-suggestion-target='urn:li:fs_aboutPrompt:']");
        about = text(aboutEl);
      }

      // ── Experience ───────────────────────────────────────────────────────
      const experience: Array<{ title: string; company: string; duration: string }> = [];
      const expSection = document.querySelector("#experience");
      if (expSection) {
        let container = expSection.nextElementSibling;
        while (container && !container.id) {
          const items = container.querySelectorAll("li.artdeco-list__item");
          items.forEach((item) => {
            const spans = Array.from(item.querySelectorAll("span[aria-hidden='true']"))
              .map((s) => s.textContent?.trim())
              .filter(Boolean) as string[];

            if (spans.length >= 2) {
              experience.push({
                title: spans[0] || "",
                company: spans[1] || "",
                duration: spans[2] || "",
              });
            }
          });
          if (items.length > 0) break;
          container = container.nextElementSibling;
        }
      }

      // ── Education ────────────────────────────────────────────────────────
      const education: Array<{ school: string; degree: string; years: string }> = [];
      const eduSection = document.querySelector("#education");
      if (eduSection) {
        let container = eduSection.nextElementSibling;
        while (container && !container.id) {
          const items = container.querySelectorAll("li.artdeco-list__item");
          items.forEach((item) => {
            const spans = Array.from(item.querySelectorAll("span[aria-hidden='true']"))
              .map((s) => s.textContent?.trim())
              .filter(Boolean) as string[];

            if (spans.length >= 1) {
              education.push({
                school: spans[0] || "",
                degree: spans[1] || "",
                years: spans[2] || "",
              });
            }
          });
          if (items.length > 0) break;
          container = container.nextElementSibling;
        }
      }

      return { name, headline, location, connections, about, experience, education };
    });

    // If DOM extraction failed for key fields, try page title as fallback
    if (!profileData.name) {
      const title = await page.title();
      // LinkedIn titles: "John Doe - Founder at Company | LinkedIn"
      profileData.name = title.split(" - ")[0].replace("| LinkedIn", "").trim() || null;
    }

    result.name = profileData.name;
    result.headline = profileData.headline;
    result.location = profileData.location;
    result.connections = profileData.connections;
    result.about_text = profileData.about || null;
    result.experience = profileData.experience.slice(0, 10);
    result.education = profileData.education.slice(0, 5);

    console.log(
      `[LI-PROFILE] Visited ${linkedinUrl} → name="${result.name}", ` +
      `about=${result.about_text?.length ?? 0} chars, ` +
      `exp=${result.experience.length}, edu=${result.education.length}`
    );

    // Polite delay
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  } catch (e) {
    result.error = String(e);
    console.error(`[LI-PROFILE] Error visiting ${linkedinUrl}:`, e);
  } finally {
    try { if (context) await context.close(); } catch { /* already closed */ }
    await releaseBrowser();
  }

  return result;
}
