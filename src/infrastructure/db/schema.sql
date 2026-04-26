-- Paradise Capital Lead Gen — Unified Database Schema
-- Single source of truth for all table definitions.
-- Used by db.ts at startup via createTables().

-- ─── Core Tables ────────────────────────────────────────────────────────────

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

-- ─── Scraped Content ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scraped_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
  homepage_text TEXT,
  about_text TEXT,
  all_text TEXT,
  pages_scraped INTEGER DEFAULT 0,
  scraped_at TEXT NOT NULL
);

-- ─── Enrichment Pipeline Tables ─────────────────────────────────────────────

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
  created_at TEXT NOT NULL,
  sent_at TEXT,           -- timestamp when pushed to Instantly (NULL = generated but not sent)
  sent_campaign_id TEXT   -- which Instantly campaign it was sent to
);

-- ─── LinkedIn Data ──────────────────────────────────────────────────────────

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

-- ─── Suppression & Compliance ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suppression_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Email Candidates (waterfall enrichment) ────────────────────────────────

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

-- ─── Email Enrichment Runs (audit trail) ────────────────────────────────────

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

-- ─── Pipeline Cost Tracking ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_id ON lead_costs(lead_id);

-- ─── Outreach Outcomes ──────────────────────────────────────────────────────

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

-- ─── Founder Emails (waterfall result, one row per lead) ────────────────────
-- JOINed by /api/instantly/{ready,push}, /api/pipeline/{summary,scored-leads}
-- and /api/email-enrichment/reset. Must exist at startup, not be created
-- lazily by email-finder.ts (which produces 500s on a fresh DB).

CREATE TABLE IF NOT EXISTS founder_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
  email TEXT,
  email_source TEXT,
  owner_name TEXT,
  confidence TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_founder_emails_lead_id ON founder_emails(lead_id);
