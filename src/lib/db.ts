import Database from "better-sqlite3";
import path from "path";
import { readFileSync } from "fs";
import { getLeadCosts } from "@/lib/cost-tracker";

// Re-export shared types from domain layer for backward compatibility.
// Consumers that imported { Lead, LeadFilters } from "@/lib/db" continue to work.
export type { Lead, LeadFilters } from "@/domain/types";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.resolve(process.cwd(), "paradise_leads.db");

// Use global so the singleton is shared across all Next.js route bundles
// (Turbopack compiles each route separately; module-level vars are not shared)
declare global {
  // eslint-disable-next-line no-var
  var __paradiseDb: Database.Database | undefined;
}

export function resetDb(): void {
  if (global.__paradiseDb) {
    global.__paradiseDb.close();
    global.__paradiseDb = undefined;
  }
}

export function getDb(): Database.Database {
  if (!global.__paradiseDb) {
    global.__paradiseDb = new Database(DB_PATH);
    global.__paradiseDb.pragma("journal_mode = WAL");
    global.__paradiseDb.pragma("busy_timeout = 5000");
    global.__paradiseDb.pragma("synchronous = NORMAL");
    createTables(global.__paradiseDb);
  }
  return global.__paradiseDb;
}

function createTables(db: Database.Database) {
  const schemaPath = path.resolve(__dirname, "../infrastructure/db/schema.sql");
  try {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  } catch {
    // Fallback: if schema.sql can't be read (e.g. bundled environment),
    // use inline schema to ensure the app still works.
    db.exec(FALLBACK_SCHEMA);
  }
  runMigrations(db);
}

/**
 * Idempotent column migrations — SQLite has no "ADD COLUMN IF NOT EXISTS",
 * so we check PRAGMA table_info before each ALTER.
 */
function runMigrations(db: Database.Database) {
  const hasColumn = (table: string, col: string): boolean => {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      return rows.some((r) => r.name === col);
    } catch { return false; }
  };
  if (!hasColumn("scraped_content", "emails_found")) {
    try { db.exec("ALTER TABLE scraped_content ADD COLUMN emails_found TEXT"); }
    catch (e) { console.warn("[DB MIGRATE] add emails_found failed:", e); }
  }
  if (!hasColumn("scraped_content", "phones_found")) {
    try { db.exec("ALTER TABLE scraped_content ADD COLUMN phones_found TEXT"); }
    catch (e) { console.warn("[DB MIGRATE] add phones_found failed:", e); }
  }
}

// Inline fallback — kept in sync with infrastructure/db/schema.sql
const FALLBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    phone TEXT,
    website TEXT,
    google_rating REAL,
    review_count INTEGER,
    business_types TEXT,
    latitude REAL,
    longitude REAL,
    source TEXT DEFAULT 'google_maps',
    search_query TEXT,
    search_location TEXT,
    is_chain INTEGER DEFAULT 0,
    high_review_flag INTEGER DEFAULT 0,
    no_website_flag INTEGER DEFAULT 0,
    scraped_at TEXT NOT NULL,
    enrichment_status TEXT DEFAULT 'pending',
    raw_data TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id);
  CREATE INDEX IF NOT EXISTS idx_leads_enrichment_status ON leads(enrichment_status);
  CREATE INDEX IF NOT EXISTS idx_leads_city_state ON leads(city, state);
  CREATE INDEX IF NOT EXISTS idx_leads_search_query ON leads(search_query);

  CREATE TABLE IF NOT EXISTS scraped_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    homepage_text TEXT,
    about_text TEXT,
    all_text TEXT,
    pages_scraped INTEGER DEFAULT 0,
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrichment_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scoring_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    score INTEGER NOT NULL,
    confidence TEXT,
    recommended_action TEXT,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outreach_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    outreach_json TEXT NOT NULL,
    followup_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS linkedin_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    linkedin_url TEXT,
    owner_name_from_linkedin TEXT,
    owner_title_from_linkedin TEXT,
    linkedin_headline TEXT,
    rate_limited INTEGER DEFAULT 0,
    data_quality TEXT DEFAULT 'normal',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suppression_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outreach_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    outreach_data_id INTEGER,
    outcome TEXT NOT NULL,
    tier_used TEXT,
    score_at_send INTEGER,
    notes TEXT,
    outcome_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    email TEXT NOT NULL,
    provider TEXT NOT NULL,
    confidence_score REAL DEFAULT 0,
    verification_status TEXT DEFAULT 'unverified',
    verification_method TEXT,
    is_primary INTEGER DEFAULT 0,
    owner_name TEXT,
    owner_title TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_email_candidates_lead_id ON email_candidates(lead_id);
  CREATE INDEX IF NOT EXISTS idx_email_candidates_primary ON email_candidates(lead_id, is_primary);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_email_candidates_unique ON email_candidates(lead_id, email, provider);

  CREATE TABLE IF NOT EXISTS email_enrichment_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    providers_attempted TEXT NOT NULL,
    providers_hit TEXT,
    best_email TEXT,
    best_provider TEXT,
    best_verification_status TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_email_runs_lead_id ON email_enrichment_runs(lead_id);
`;

// Lead and LeadFilters are re-exported from @/domain/types above.
// Import them here for local use in this file.
import type { Lead, LeadFilters, EnrichmentStatus } from "@/domain/types";
import { validateTransition } from "@/domain/lead";

/**
 * Set a lead's enrichment status with transition validation.
 * Throws if the transition is not allowed by the state machine.
 * Use this instead of raw SQL UPDATE everywhere in the pipeline.
 */
export function setLeadStatus(leadId: number, newStatus: EnrichmentStatus): void {
  const db = getDb();
  const row = db
    .prepare("SELECT enrichment_status FROM leads WHERE id = ?")
    .get(leadId) as { enrichment_status: string } | undefined;

  if (!row) throw new Error(`Lead ${leadId} not found`);

  const currentStatus = row.enrichment_status as EnrichmentStatus;

  // Allow same-status updates (idempotent retries) without throwing
  if (currentStatus !== newStatus) {
    validateTransition(currentStatus, newStatus);
  }

  db.prepare(
    "UPDATE leads SET enrichment_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newStatus, leadId);
}

export function getLeads(filters: LeadFilters = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("enrichment_status = ?");
    params.push(filters.status);
  }
  if (filters.minRating != null) {
    conditions.push("google_rating >= ?");
    params.push(filters.minRating);
  }
  if (filters.hasWebsite) {
    conditions.push("website IS NOT NULL AND website != ''");
  }
  if (filters.excludeChains) {
    conditions.push("is_chain = 0");
  }
  if (filters.search) {
    conditions.push("business_name LIKE ?");
    params.push(`%${filters.search}%`);
  }
  if (filters.scoreTier === "high") {
    conditions.push("s.score >= 7");
  } else if (filters.scoreTier === "medium") {
    conditions.push("s.score >= 4 AND s.score < 7");
  } else if (filters.scoreTier === "low") {
    conditions.push("s.score < 4 AND s.score IS NOT NULL");
  } else if (filters.scoreTier === "unscored") {
    conditions.push("s.score IS NULL");
  }
  if (filters.hasEmail === true) {
    conditions.push("fe.email IS NOT NULL");
  } else if (filters.hasEmail === false) {
    conditions.push("fe.email IS NULL");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortCol = filters.sortBy || "id";
  const sortDir = filters.sortOrder === "asc" ? "ASC" : "DESC";
  const allowedCols = [
    "id", "business_name", "city", "state",
    "enrichment_status", "created_at", "updated_at", "score",
  ];
  const safeSort = allowedCols.includes(sortCol) ? sortCol : "id";
  const sortExpr = safeSort === "score" ? "s.score" : `l.${safeSort}`;

  const pageSize = filters.pageSize || 50;
  const page = filters.page || 1;
  const offset = (page - 1) * pageSize;

  // Qualify conditions with table prefix for the JOIN
  const qualifiedWhere = where
    .replace(/enrichment_status/g, "l.enrichment_status")
    .replace(/google_rating/g, "l.google_rating")
    .replace(/website /g, "l.website ")
    .replace(/is_chain/g, "l.is_chain")
    .replace(/business_name/g, "l.business_name");

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM leads l
       LEFT JOIN scoring_data s ON s.lead_id = l.id
       LEFT JOIN email_candidates fe ON fe.lead_id = l.id AND fe.is_primary = 1
       ${qualifiedWhere}`
    )
    .get(...params) as { count: number };

  const leads = db
    .prepare(
      `SELECT l.*, s.score as exit_score,
              json_extract(s.data, '$.reasoning') as score_reason,
              fe.email as founder_email, fe.provider as email_source
       FROM leads l
       LEFT JOIN scoring_data s ON s.lead_id = l.id
       LEFT JOIN email_candidates fe ON fe.lead_id = l.id AND fe.is_primary = 1
       ${qualifiedWhere}
       ORDER BY ${sortExpr} ${sortDir} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as (Lead & { exit_score: number | null; score_reason: string | null; founder_email: string | null; email_source: string | null })[];

  return { leads, total: total.count, page, pageSize };
}

export function getLeadDetail(id: number) {
  const db = getDb();

  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Lead | undefined;
  if (!lead) return null;

  const scraped = db
    .prepare("SELECT * FROM scraped_content WHERE lead_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  const enrichment = db
    .prepare("SELECT * FROM enrichment_data WHERE lead_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  const scoring = db
    .prepare("SELECT * FROM scoring_data WHERE lead_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  const outreach = db
    .prepare("SELECT * FROM outreach_data WHERE lead_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  const linkedin = db
    .prepare("SELECT * FROM linkedin_data WHERE lead_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  // Deep enrichment data (social intros + content hooks)
  let socialIntro = null;
  try {
    const si = db.prepare("SELECT * FROM social_intros WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    socialIntro = si ? JSON.parse(si.intro_json as string) : null;
  } catch { /* table may not exist yet */ }

  let contentHooks = null;
  try {
    const ch = db.prepare("SELECT * FROM content_hooks WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    contentHooks = ch ? JSON.parse(ch.hooks_json as string) : null;
  } catch { /* table may not exist yet */ }

  let socialSignals = null;
  try {
    const ss = db.prepare("SELECT * FROM social_signals WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    if (ss) {
      socialSignals = {
        linkedin_about: ss.linkedin_about as string | null,
        twitter_posts: ss.twitter_posts ? JSON.parse(ss.twitter_posts as string) : [],
        press_releases: ss.press_releases ? JSON.parse(ss.press_releases as string) : [],
      };
    }
  } catch { /* table may not exist yet */ }

  // Founder profile, succession news, legacy outreach
  let founderProfile = null;
  try {
    const fp = db.prepare("SELECT * FROM founder_profiles WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    founderProfile = fp ? JSON.parse(fp.profile_json as string) : null;
  } catch { /* table may not exist yet */ }

  let successionNews = null;
  try {
    const sn = db.prepare("SELECT * FROM succession_news WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    if (sn) {
      successionNews = {
        owner_signals: sn.owner_signals ? JSON.parse(sn.owner_signals as string) : [],
        industry_signals: sn.industry_signals ? JSON.parse(sn.industry_signals as string) : [],
        total_signals: sn.total_signals as number,
        strongest_signal: sn.strongest_signal as string | null,
      };
    }
  } catch { /* table may not exist yet */ }

  let legacyOutreach = null;
  try {
    const lo = db.prepare("SELECT * FROM legacy_outreach WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    legacyOutreach = lo ? JSON.parse(lo.outreach_json as string) : null;
  } catch { /* table may not exist yet */ }

  let successionAudit = null;
  try {
    const sa = db.prepare("SELECT * FROM succession_audits WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    successionAudit = sa ? JSON.parse(sa.audit_json as string) : null;
  } catch { /* table may not exist yet */ }

  let tenureLegacyEmail = null;
  try {
    const tle = db.prepare("SELECT * FROM tenure_legacy_emails WHERE lead_id = ?").get(id) as Record<string, unknown> | undefined;
    tenureLegacyEmail = tle ? JSON.parse(tle.email_json as string) : null;
  } catch { /* table may not exist yet */ }

  // Cost tracking (best-effort — table may not exist on older DBs)
  let costs = null;
  try { costs = getLeadCosts(id); } catch { /* cost table not yet created */ }

  return {
    ...lead,
    scraped: scraped || null,
    enrichment: enrichment ? JSON.parse(enrichment.data as string) : null,
    scoring: scoring ? JSON.parse(scoring.data as string) : null,
    scoringMeta: scoring
      ? { score: scoring.score, confidence: scoring.confidence, recommended_action: scoring.recommended_action }
      : null,
    outreach: outreach ? JSON.parse(outreach.outreach_json as string) : null,
    followups: outreach?.followup_json
      ? JSON.parse(outreach.followup_json as string)
      : null,
    linkedin: linkedin
      ? {
          linkedin_url: linkedin.linkedin_url as string | null,
          owner_name: linkedin.owner_name_from_linkedin as string | null,
          owner_title: linkedin.owner_title_from_linkedin as string | null,
          headline: linkedin.linkedin_headline as string | null,
        }
      : null,
    socialIntro,
    contentHooks,
    socialSignals,
    founderProfile,
    successionNews,
    legacyOutreach,
    successionAudit,
    tenureLegacyEmail,
    costs,
  };
}

export function getStats() {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM leads").get() as { c: number }).c;

  const byStatus = db
    .prepare("SELECT enrichment_status, COUNT(*) as c FROM leads GROUP BY enrichment_status")
    .all() as { enrichment_status: string; c: number }[];

  const topStates = db
    .prepare(
      "SELECT state, COUNT(*) as c FROM leads WHERE state IS NOT NULL GROUP BY state ORDER BY c DESC LIMIT 10"
    )
    .all() as { state: string; c: number }[];

  const topQueries = db
    .prepare(
      "SELECT search_query, COUNT(*) as c FROM leads WHERE search_query IS NOT NULL GROUP BY search_query ORDER BY c DESC LIMIT 10"
    )
    .all() as { search_query: string; c: number }[];

  const withWebsite = (
    db.prepare("SELECT COUNT(*) as c FROM leads WHERE website IS NOT NULL AND website != ''").get() as { c: number }
  ).c;
  const noWebsite = (db.prepare("SELECT COUNT(*) as c FROM leads WHERE no_website_flag = 1").get() as { c: number }).c;
  const chains = (db.prepare("SELECT COUNT(*) as c FROM leads WHERE is_chain = 1").get() as { c: number }).c;
  const highReviews = (db.prepare("SELECT COUNT(*) as c FROM leads WHERE high_review_flag = 1").get() as { c: number }).c;

  // Score distribution
  const scores = db
    .prepare("SELECT score, COUNT(*) as c FROM scoring_data GROUP BY score ORDER BY score")
    .all() as { score: number; c: number }[];

  // Recent leads
  const recent = db
    .prepare("SELECT id, business_name, city, state, enrichment_status, updated_at FROM leads ORDER BY updated_at DESC LIMIT 10")
    .all() as Pick<Lead, "id" | "business_name" | "city" | "state" | "enrichment_status" | "updated_at">[];

  // ── M&A-specific metrics ────────────────────────────────────────────────

  // Average exit-readiness score
  const avgScoreRow = db.prepare("SELECT AVG(score) as avg FROM scoring_data").get() as { avg: number | null };
  const avgScore = avgScoreRow.avg ? Math.round(avgScoreRow.avg * 10) / 10 : null;

  // Score tiers — Paradise Capital outreach tiers
  const scoreTiers = db.prepare(`
    SELECT
      SUM(CASE WHEN score >= 7 THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN score >= 4 AND score < 7 THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN score < 4 THEN 1 ELSE 0 END) as low,
      SUM(CASE WHEN score >= 8 THEN 1 ELSE 0 END) as legacy_8_plus,
      SUM(CASE WHEN score = 7 THEN 1 ELSE 0 END) as legacy_7,
      SUM(CASE WHEN score BETWEEN 5 AND 6 THEN 1 ELSE 0 END) as seed_planter,
      SUM(CASE WHEN score < 5 THEN 1 ELSE 0 END) as below_threshold
    FROM scoring_data
  `).get() as { high: number; medium: number; low: number; legacy_8_plus: number; legacy_7: number; seed_planter: number; below_threshold: number } | undefined;

  // Source breakdown
  const bySources = db
    .prepare("SELECT source, COUNT(*) as c FROM leads GROUP BY source")
    .all() as { source: string; c: number }[];

  // Top prospects by exit-readiness score
  const topProspects = db
    .prepare(`
      SELECT l.id, l.business_name, l.city, l.state, l.enrichment_status, s.score, s.confidence
      FROM leads l
      JOIN scoring_data s ON s.lead_id = l.id
      ORDER BY s.score DESC, l.updated_at DESC
      LIMIT 10
    `)
    .all() as { id: number; business_name: string; city: string | null; state: string | null; enrichment_status: string; score: number; confidence: string | null }[];

  // Leads with founder email (from founder_emails table or enrichment_data)
  let withEmail = 0;
  try {
    withEmail = (db.prepare(
      `SELECT COUNT(*) as c FROM (
         SELECT lead_id FROM founder_emails WHERE email IS NOT NULL
         UNION
         SELECT lead_id FROM enrichment_data WHERE json_extract(data, '$.owner_email') IS NOT NULL AND json_extract(data, '$.owner_email') != ''
       )`
    ).get() as { c: number }).c;
  } catch {
    // Fallback: try founder_emails only, then enrichment_data only
    try {
      withEmail = (db.prepare("SELECT COUNT(*) as c FROM founder_emails WHERE email IS NOT NULL").get() as { c: number }).c;
    } catch {
      try {
        withEmail = (db.prepare("SELECT COUNT(*) as c FROM enrichment_data WHERE json_extract(data, '$.owner_email') IS NOT NULL AND json_extract(data, '$.owner_email') != ''").get() as { c: number }).c;
      } catch { /* neither table exists yet */ }
    }
  }

  // Email source breakdown
  let emailBreakdown = { website: 0, apollo: 0, not_found: 0 };
  try {
    const emailRows = db.prepare(
      `SELECT email_source, COUNT(*) as c FROM founder_emails GROUP BY email_source`
    ).all() as { email_source: string; c: number }[];
    for (const row of emailRows) {
      if (row.email_source === "website_personal" || row.email_source === "website_generic") {
        emailBreakdown.website += row.c;
      } else if (row.email_source === "apollo") {
        emailBreakdown.apollo += row.c;
      } else if (row.email_source === "not_found") {
        emailBreakdown.not_found += row.c;
      }
    }
  } catch { /* founder_emails table may not exist yet */ }

  return {
    total,
    withWebsite,
    noWebsite,
    chains,
    highReviews,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.enrichment_status, r.c])),
    topStates: Object.fromEntries(topStates.map((r) => [r.state, r.c])),
    topQueries: Object.fromEntries(topQueries.map((r) => [r.search_query, r.c])),
    scores: Object.fromEntries(scores.map((r) => [r.score, r.c])),
    recent,
    avgScore,
    scoreTiers: scoreTiers || { high: 0, medium: 0, low: 0, legacy_8_plus: 0, legacy_7: 0, seed_planter: 0, below_threshold: 0 },
    bySource: Object.fromEntries(bySources.map((r) => [r.source, r.c])),
    topProspects,
    withEmail,
    emailBreakdown,
  };
}

// Cross-source dedup key — same business discovered via Google Maps and
// LinkedIn X-Ray should collide, even though their place_id hashes differ.
// Key is website hostname when available, otherwise normalized business name
// + city. Not cryptographically strong — just stable.
function normalizedKey(lead: Record<string, unknown>): string | null {
  const website = (lead.website as string | null) || null;
  if (website) {
    try {
      const host = new URL(website.startsWith("http") ? website : `https://${website}`)
        .hostname.replace(/^www\./, "").toLowerCase();
      if (host) return `host:${host}`;
    } catch { /* fall through */ }
  }
  const name = String(lead.business_name || "").toLowerCase().trim()
    .replace(/[,.]/g, " ")
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|pc|pa|llp|lp)\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const city = String(lead.city || "").toLowerCase().trim();
  if (!name) return null;
  return `name:${name}|${city}`;
}

// R1: Reject obvious parse-failure names at insert time. Caught by audit:
// X-Ray parser sometimes emits "LinkedIn" / "Google" / "— hvac (Tampa…)" as
// business_name when the search snippet is malformed.
const NOISE_NAMES = new Set([
  "linkedin", "google", "facebook", "facebook.com", "instagram",
  "twitter", "x.com", "youtube", "tiktok", "-", "", "n/a", "unknown",
]);
function isNoiseName(name: string): boolean {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return true;
  if (NOISE_NAMES.has(n)) return true;
  // "Paul Suhar — hvac (Tampa, Florida)" style — search-fragment concat
  if (/—\s*(hvac|plumb|heating|cooling|roof|landscap|painter)\b.*\([^)]+\)$/i.test(n)) return true;
  return false;
}

export function upsertLead(lead: Record<string, unknown>): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  // R1: Reject noise-token names before they pollute the DB.
  if (isNoiseName(String(lead.business_name || ""))) {
    console.warn(`[UPSERT] Rejected noise-token name: "${lead.business_name}" (source=${lead.source})`);
    return false;
  }

  // R2: X-Ray leads must have either a website OR a linkedin_url in raw_data.
  // A name-only X-Ray row is unactionable.
  if (lead.source === "linkedin_xray") {
    const raw = (lead.raw_data as Record<string, unknown>) || {};
    const hasWebsite = !!lead.website;
    const hasLinkedIn = !!raw.linkedin_url || !!raw.profile_url;
    if (!hasWebsite && !hasLinkedIn) {
      console.warn(`[UPSERT] Rejected X-Ray lead with no website/linkedin_url: "${lead.business_name}"`);
      return false;
    }
  }

  // Primary dedup: place_id hash (deterministic for same-source rediscovery).
  let existing = db
    .prepare("SELECT id FROM leads WHERE place_id = ?")
    .get(lead.place_id as string) as { id: number } | undefined;

  // Secondary dedup: normalized key (collapses cross-source duplicates —
  // e.g. same business from Google Maps AND LinkedIn X-Ray).
  if (!existing) {
    const key = normalizedKey(lead);
    if (key) {
      const byKey = db
        .prepare(`
          SELECT id, place_id FROM leads
          WHERE (
            (website IS NOT NULL AND website != ''
             AND lower(replace(replace(replace(website, 'https://', ''), 'http://', ''), 'www.', '')) LIKE ?)
            OR
            (lower(business_name) = ? AND lower(COALESCE(city, '')) = ?)
          )
          LIMIT 1
        `)
        .get(
          key.startsWith("host:") ? `${key.slice(5)}%` : "___no_match___",
          String(lead.business_name || "").toLowerCase().trim(),
          String(lead.city || "").toLowerCase().trim(),
        ) as { id: number; place_id: string } | undefined;
      if (byKey) existing = { id: byKey.id };
    }
  }

  if (existing) {
    db.prepare(`
      UPDATE leads SET
        business_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
        phone = ?, website = ?, google_rating = ?, review_count = ?,
        business_types = ?, latitude = ?, longitude = ?,
        is_chain = ?, high_review_flag = ?, no_website_flag = ?,
        scraped_at = ?, raw_data = ?, updated_at = ?
      WHERE place_id = ?
    `).run(
      lead.business_name, lead.address ?? null, lead.city ?? null,
      lead.state ?? null, lead.zip_code ?? null, lead.phone ?? null,
      lead.website ?? null, lead.google_rating ?? null, lead.review_count ?? null,
      JSON.stringify(lead.business_types ?? []),
      lead.latitude ?? null, lead.longitude ?? null,
      lead.is_chain ?? 0, lead.high_review_flag ?? 0, lead.no_website_flag ?? 0,
      now, JSON.stringify(lead.raw_data ?? {}), now,
      lead.place_id,
    );
    return false;
  }

  db.prepare(`
    INSERT INTO leads (
      place_id, business_name, address, city, state, zip_code,
      phone, website, google_rating, review_count,
      business_types, latitude, longitude, source,
      search_query, search_location,
      is_chain, high_review_flag, no_website_flag,
      scraped_at, enrichment_status, raw_data, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.place_id, lead.business_name, lead.address ?? null,
    lead.city ?? null, lead.state ?? null, lead.zip_code ?? null,
    lead.phone ?? null, lead.website ?? null, lead.google_rating ?? null,
    lead.review_count ?? null,
    JSON.stringify(lead.business_types ?? []),
    lead.latitude ?? null, lead.longitude ?? null,
    lead.source ?? "google_maps",
    lead.search_query ?? null, lead.search_location ?? null,
    lead.is_chain ?? 0, lead.high_review_flag ?? 0, lead.no_website_flag ?? 0,
    now, "pending", JSON.stringify(lead.raw_data ?? {}), now, now,
  );
  return true;
}
