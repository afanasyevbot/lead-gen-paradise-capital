/**
 * Stage 16 — LinkedIn Profile Visit
 *
 * Visits actual linkedin.com/in/[slug] profile pages using an injected
 * session cookie (li_at). Only runs on leads that:
 *   1. Have a LinkedIn URL already discovered (from stage 02-linkedin)
 *   2. Score 6 or higher (not worth the rate-limit risk on weak leads)
 *   3. Have NOT already been visited (profile_visited_at IS NULL)
 *
 * Requires a LinkedIn session cookie saved at data/linkedin-session.json.
 * If no cookie is configured the stage is a no-op (returns immediately).
 */

import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { visitLinkedInProfile, hasLinkedInSession } from "@/lib/scraper/linkedin-profile";
import { getDb } from "@/lib/db";

// Kept for reference but no longer used — stage now runs BEFORE scoring so
// that extract + score can use real LinkedIn work history for age estimation
// and founder detection. ICP screen (stage 00b) is the upstream quality gate.
const _MIN_SCORE_FOR_VISIT = 6;
void _MIN_SCORE_FOR_VISIT;
const CONCURRENCY = 1; // LinkedIn is sensitive — run sequentially

export const linkedinProfileStage: PipelineStage = {
  name: "linkedin-profile",
  description: "Visiting LinkedIn profiles",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const counts = { visited: 0, skipped: 0, failed: 0, no_session: 0 };

    if (!hasLinkedInSession()) {
      console.log("[LI-PROFILE STAGE] No LinkedIn session configured — skipping");
      counts.no_session = 1;
      return counts;
    }

    const db = getDb();

    // Ensure the profile columns exist (safe to run repeatedly)
    try {
      db.exec(`ALTER TABLE linkedin_data ADD COLUMN profile_data TEXT`);
    } catch { /* column already exists */ }
    try {
      db.exec(`ALTER TABLE linkedin_data ADD COLUMN profile_visited_at TEXT`);
    } catch { /* column already exists */ }

    // Fetch leads that have a LinkedIn URL and haven't been visited yet.
    // The ICP screen (stage 00b) has already filtered out obvious non-ICP
    // leads, so everything remaining is worth the profile-visit cost.
    // Ordering: prefer leads that reached 'scraped' status (ICP passed).
    const rows = db.prepare(`
      SELECT l.id, l.business_name, ld.linkedin_url
      FROM leads l
      JOIN linkedin_data ld ON ld.lead_id = l.id
      WHERE ld.linkedin_url IS NOT NULL
        AND ld.linkedin_url != ''
        AND (ld.profile_visited_at IS NULL)
        AND l.enrichment_status IN ('scraped', 'enriched', 'scored')
      ORDER BY l.id DESC
      LIMIT ?
    `).all(ctx.limit) as {
      id: number;
      business_name: string;
      linkedin_url: string;
    }[];

    if (rows.length === 0) {
      console.log("[LI-PROFILE STAGE] No eligible leads to visit");
      return counts;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      ctx.onItemProgress(i + 1, rows.length, row.business_name);

      try {
        const profile = await visitLinkedInProfile(row.linkedin_url);

        if (!profile.session_valid && profile.error?.includes("expired")) {
          // Session is dead — stop the whole batch
          console.warn("[LI-PROFILE STAGE] Session expired — stopping batch");
          counts.failed++;
          break;
        }

        if (profile.error && !profile.session_valid) {
          counts.failed++;
          continue;
        }

        // Store the profile data back into linkedin_data
        const profileData = {
          name: profile.name,
          headline: profile.headline,
          location: profile.location,
          connections: profile.connections,
          about_text: profile.about_text,
          experience: profile.experience,
          education: profile.education,
          session_valid: profile.session_valid,
        };

        db.prepare(`
          UPDATE linkedin_data
          SET profile_data = ?,
              profile_visited_at = datetime('now'),
              owner_name_from_linkedin = COALESCE(NULLIF(owner_name_from_linkedin, ''), ?),
              owner_title_from_linkedin = COALESCE(NULLIF(owner_title_from_linkedin, ''), ?),
              linkedin_headline = COALESCE(NULLIF(linkedin_headline, ''), ?)
          WHERE lead_id = ?
        `).run(
          JSON.stringify(profileData),
          profile.name,
          profile.headline,
          profile.headline,
          row.id,
        );

        counts.visited++;
        console.log(`[LI-PROFILE STAGE] ✓ ${row.business_name}`);
      } catch (e) {
        counts.failed++;
        console.error(`[LI-PROFILE STAGE] Error on ${row.business_name}:`, e);
      }
    }

    return counts;
  },
};
