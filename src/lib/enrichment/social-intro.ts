/**
 * Social Intro Generator
 *
 * Takes a lead's LinkedIn "About" section, recent Twitter/X posts, and
 * press releases to draft a 3-sentence intro that feels human and unscripted.
 *
 * This replaces the generic outreach opener with something that feels like
 * Paul actually follows the owner's work — because he does.
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";

const SYSTEM_PROMPT = `You are drafting 3-sentence email openers for Paul Niccum, Managing Partner at Paradise Capital, a lower middle market M&A advisory firm.

YOUR GOAL: Write an opening that makes the recipient think "this person actually knows me" — not "this is a mail merge." The intro replaces a generic "I came across your business" with something specific and genuine.

INPUTS YOU'LL RECEIVE:
- LinkedIn "About" section text (the owner's own words about themselves)
- Recent Twitter/X posts (what they're publicly talking about)
- Recent press releases or news mentions
- Basic business and enrichment data for context

RULES FOR THE 3-SENTENCE INTRO:

Sentence 1 — THE NOTICE:
Reference something SPECIFIC from their social presence. Not "I saw your LinkedIn" (lazy), but the actual content. Examples:
- "Your post about [specific topic] caught my attention — not many marina owners are thinking about [thing they mentioned]."
- "I read your piece about [topic] and it reminded me of a conversation I had with another [industry] owner last month."
- "Congratulations on [press release thing] — that's a serious milestone for any [industry] business."

Sentence 2 — THE BRIDGE:
Connect what you noticed to WHY you're reaching out, without being salesy. This should feel like a natural human thought, not a scripted pivot.
- "It got me thinking about how business owners in your position start weighing their options after building something that significant."
- "Owners who've built what you have often reach a point where they want to understand what comes next — even if 'next' is five years away."

Sentence 3 — THE SOFTENER:
A genuinely warm, zero-pressure line that makes it feel safe to respond.
- "No agenda — I'd just enjoy hearing your take on [related topic] over coffee sometime."
- "I realize I'm a stranger in your inbox, but your [specific detail] tells me we'd have a good conversation."

ABSOLUTE RULES:
- Total: 40-60 words. Shorter is always better.
- NEVER use: "exciting opportunity," "strategic," "maximize value," "exit," "sell your business"
- NEVER fabricate details. If the social data is thin, use what you have. Better to reference one real thing well than three made-up things.
- If Twitter posts are about personal interests (fishing, family, faith), that's GOLD — Paul connects on personal level first, business second.
- If no social data is usable, write a "I noticed [specific website detail]" fallback instead of forcing social references.
- The tone should feel like a text message from a smart friend, not a business email.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "intro_text": "string — the 3-sentence opener, ready to paste into an email",
  "source_used": "linkedin" | "twitter" | "press_release" | "website_fallback",
  "specific_reference": "string — the exact detail from their social presence that you referenced, so Paul can verify it's real",
  "confidence": "high" | "medium" | "low",
  "notes_for_paul": "string — 1 sentence explaining why you chose this angle, so Paul can decide if it feels right"
}`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export interface SocialIntro {
  intro_text: string;
  source_used: string;
  specific_reference: string;
  confidence: string;
  notes_for_paul: string;
}

export async function generateSocialIntros(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ generated: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_intros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      intro_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Get leads with social signals that don't have intros yet
  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website, l.city, l.state,
           ed.data as enrichment_json,
           ss.linkedin_about, ss.twitter_posts, ss.press_releases,
           sc.all_text
    FROM leads l
    JOIN social_signals ss ON ss.lead_id = l.id
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN scraped_content sc ON sc.lead_id = l.id
    LEFT JOIN social_intros si ON si.lead_id = l.id
    WHERE si.id IS NULL
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    city: string | null;
    state: string | null;
    enrichment_json: string | null;
    linkedin_about: string | null;
    twitter_posts: string | null;
    press_releases: string | null;
    all_text: string | null;
  }[];

  const counts = { generated: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};
    const twitterPosts = row.twitter_posts ? JSON.parse(row.twitter_posts) : [];
    const pressReleases = row.press_releases ? JSON.parse(row.press_releases) : [];

    // Skip if we have no social data at all
    if (!row.linkedin_about && twitterPosts.length === 0 && pressReleases.length === 0) {
      // Fall back to website text if available
      if (!row.all_text || row.all_text.length < 100) {
        counts.skipped++;
        continue;
      }
    }

    try {
      const result = await callAnthropicWithRetry<SocialIntro>({
        client,
        maxTokens: 800,
        system: SYSTEM_PROMPT,
        userContent: `Draft a 3-sentence personal intro for this lead.

LEAD:
Business: ${row.business_name}
Owner: ${enrichment.owner_name || "Unknown"}
Location: ${row.city || ""}, ${row.state || ""}
Industry: ${enrichment.industry_category || "Unknown"}
Website: ${row.website || ""}

LINKEDIN ABOUT SECTION:
${row.linkedin_about || "(not available)"}

RECENT TWITTER/X POSTS:
${twitterPosts.length > 0 ? twitterPosts.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n") : "(no tweets found)"}

RECENT PRESS RELEASES / NEWS:
${pressReleases.length > 0 ? pressReleases.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n") : "(no press releases found)"}

ENRICHMENT CONTEXT (for background — DO NOT reference directly):
Unique hooks: ${JSON.stringify(enrichment.unique_hooks || [])}
Succession signals: ${enrichment.succession_signals || "none"}
Owner details: ${enrichment.owner_personal_details || "none"}

${(!row.linkedin_about && twitterPosts.length === 0 && pressReleases.length === 0)
  ? `FALLBACK — no social data available. Use this website text instead:\n${(row.all_text || "").slice(0, 2000)}`
  : ""}`,
      });

      db.prepare(`
        INSERT OR REPLACE INTO social_intros (lead_id, intro_json, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(row.id, JSON.stringify(result));

      counts.generated++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
