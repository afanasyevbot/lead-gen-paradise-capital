/**
 * Hook Extractor
 *
 * Analyzes a lead's blog posts, podcast appearances, and published articles
 * using Claude to extract specific quotes or themes for subject line hooks.
 *
 * The goal: find ONE killer subject line angle that makes the owner think
 * "wait, this person actually reads my stuff" before they even open the email.
 */

import { createAnthropicClient } from "./client";
import { getDb } from "@/lib/db";
import { callAnthropicWithRetry } from "./retry";

const SYSTEM_PROMPT = `You are a subject line copywriter for Paul Niccum at Paradise Capital. Your job is to analyze a business owner's own published content — blog posts, podcast appearances, articles — and extract the SINGLE most compelling quote, theme, or insight to reference in an email subject line.

WHY THIS MATTERS:
Most cold emails use generic subject lines like "Quick question" or "Opportunity for [Business Name]." These get deleted. But if Paul's subject line references something the owner ACTUALLY SAID or WROTE, they'll open it. That's the goal: get the open.

WHAT YOU'RE LOOKING FOR:

1. DIRECT QUOTES (highest value):
   - Something the owner said about their business philosophy
   - A prediction about their industry
   - A personal story they shared publicly
   - Something contrarian or opinionated they wrote
   Example: Owner wrote "I didn't build this marina to hand it to a corporation"
   → Subject: "Not handing it to a corporation"

2. THEMES (high value):
   - What topics do they consistently write/talk about?
   - What problems do they highlight in their industry?
   - What values come through in their content?
   Example: Owner's blog repeatedly discusses skilled labor shortages
   → Subject: "The labor problem you keep writing about"

3. MILESTONES (medium value):
   - Awards, recognitions, or achievements mentioned
   - Growth milestones shared publicly
   - Community involvement highlighted
   Example: Podcast interview about winning "Best Marina 2024"
   → Subject: "After Best Marina 2024 — what's next?"

4. PASSIONS (medium value — great for personal connection):
   - Hobbies, causes, or personal interests mentioned
   - Faith community involvement
   - Charitable work or volunteer activities
   Example: Blog post about annual charity fishing tournament
   → Subject: "Your fishing tournament (and a thought about the marina)"

SUBJECT LINE RULES:
- 3-8 words maximum. Shorter is better.
- NEVER include: "opportunity," "acquire," "sell," "exit," "M&A," "offer"
- NEVER use clickbait formulas: "You won't believe..." "One thing about..."
- Should feel like a text message subject, not a marketing email
- Must reference something SPECIFIC from their content — not generic
- Put direct quotes in quotes. Everything else: lowercase, casual tone.
- Generate 3 options ranked by quality

OUTPUT FORMAT — return ONLY valid JSON:
{
  "hooks": [
    {
      "subject_line": "string — the subject line, 3-8 words",
      "source_type": "quote" | "theme" | "milestone" | "passion",
      "source_content": "string — the exact quote or content you're referencing",
      "source_location": "string — which blog post, podcast, or article it came from",
      "why_it_works": "string — 1 sentence on why this will get the open",
      "quality": "A" | "B" | "C"
    }
  ],
  "fallback_subject": "string — a generic but non-boring subject line if the content is thin",
  "content_richness": "rich" | "moderate" | "thin" | "none",
  "analysis_notes": "string — 1-2 sentences summarizing what you learned about this owner from their content"
}`;

type ProgressCallback = (current: number, total: number, item: string) => void;

export interface HookResult {
  hooks: {
    subject_line: string;
    source_type: string;
    source_content: string;
    source_location: string;
    why_it_works: string;
    quality: string;
  }[];
  fallback_subject: string;
  content_richness: string;
  analysis_notes: string;
}

export async function extractContentHooks(
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ extracted: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      hooks_json TEXT NOT NULL,
      best_subject TEXT,
      content_richness TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare(`
    SELECT l.id, l.business_name, l.website,
           ed.data as enrichment_json,
           chr.blog_posts, chr.podcast_appearances, chr.articles
    FROM leads l
    JOIN content_hooks_raw chr ON chr.lead_id = l.id
    LEFT JOIN enrichment_data ed ON ed.lead_id = l.id
    LEFT JOIN content_hooks ck ON ck.lead_id = l.id
    WHERE ck.id IS NULL
    LIMIT ?
  `).all(limit) as {
    id: number;
    business_name: string;
    website: string | null;
    enrichment_json: string | null;
    blog_posts: string | null;
    podcast_appearances: string | null;
    articles: string | null;
  }[];

  const counts = { extracted: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, row.business_name);

    const blogPosts = row.blog_posts ? JSON.parse(row.blog_posts) : [];
    const podcasts = row.podcast_appearances ? JSON.parse(row.podcast_appearances) : [];
    const articles = row.articles ? JSON.parse(row.articles) : [];

    // Skip if no content was found
    if (blogPosts.length === 0 && podcasts.length === 0 && articles.length === 0) {
      counts.skipped++;
      continue;
    }

    const enrichment = row.enrichment_json ? JSON.parse(row.enrichment_json) : {};

    try {
      const result = await callAnthropicWithRetry<HookResult>({
        client,
        maxTokens: 1200,
        system: SYSTEM_PROMPT,
        userContent: `Analyze this owner's published content and extract subject line hooks.

LEAD:
Business: ${row.business_name}
Owner: ${enrichment.owner_name || "Unknown"}
Industry: ${enrichment.industry_category || "Unknown"}
Website: ${row.website || ""}

BLOG POSTS FROM THEIR WEBSITE:
${blogPosts.length > 0
  ? blogPosts.map((p: { title: string; snippet: string; url: string }, i: number) =>
    `${i + 1}. "${p.title}"\n   URL: ${p.url}\n   Excerpt: ${p.snippet}`
  ).join("\n\n")
  : "(no blog posts found)"}

PODCAST APPEARANCES / INTERVIEWS:
${podcasts.length > 0
  ? podcasts.map((p: { title: string; snippet: string; url: string }, i: number) =>
    `${i + 1}. "${p.title}"\n   URL: ${p.url}\n   Description: ${p.snippet}`
  ).join("\n\n")
  : "(no podcast appearances found)"}

PUBLISHED ARTICLES / MEDIA MENTIONS:
${articles.length > 0
  ? articles.map((p: { title: string; snippet: string; url: string }, i: number) =>
    `${i + 1}. "${p.title}"\n   URL: ${p.url}\n   Snippet: ${p.snippet}`
  ).join("\n\n")
  : "(no articles found)"}

BACKGROUND CONTEXT (for understanding, NOT for direct reference in subject lines):
Unique hooks from enrichment: ${JSON.stringify(enrichment.unique_hooks || [])}
Owner details: ${enrichment.owner_personal_details || "none"}`,
      });

      const bestSubject = result.hooks?.[0]?.subject_line || result.fallback_subject || "";

      db.prepare(`
        INSERT OR REPLACE INTO content_hooks
        (lead_id, hooks_json, best_subject, content_richness, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(row.id, JSON.stringify(result), bestSubject, result.content_richness);

      counts.extracted++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}
