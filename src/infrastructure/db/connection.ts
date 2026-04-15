/**
 * Database Connection
 *
 * Single entry point for database access. Extracted from lib/db.ts
 * to separate connection management from query logic.
 *
 * Re-exports getDb() for backward compatibility — existing code that
 * imports from @/lib/db continues to work unchanged.
 */

import Database from "better-sqlite3";
import path from "path";
import { readFileSync } from "fs";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.resolve(process.cwd(), "paradise_leads.db");

let _db: Database.Database | null = null;

/**
 * Get the singleton database connection.
 * Creates and initializes the database on first call.
 */
export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}

/**
 * Initialize the database schema from the unified schema.sql file.
 * Falls back to inline schema if the file can't be read.
 */
function initSchema(db: Database.Database): void {
  const schemaPath = path.resolve(__dirname, "schema.sql");
  try {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  } catch {
    // Fallback for bundled environments where schema.sql isn't available.
    // This is the same schema — kept in sync manually.
    db.exec(FALLBACK_SCHEMA);
  }
}

/**
 * Close the database connection. Useful for tests and shutdown.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Get a fresh in-memory database for testing.
 * Creates all tables but doesn't persist to disk.
 */
export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const schemaPath = path.resolve(__dirname, "schema.sql");
  try {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  } catch {
    db.exec(FALLBACK_SCHEMA);
  }
  return db;
}

// Inline fallback schema — kept in sync with schema.sql
const FALLBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    address TEXT, city TEXT, state TEXT, zip_code TEXT,
    phone TEXT, website TEXT, google_rating REAL, review_count INTEGER,
    business_types TEXT, latitude REAL, longitude REAL,
    source TEXT DEFAULT 'google_maps', search_query TEXT, search_location TEXT,
    is_chain INTEGER DEFAULT 0, high_review_flag INTEGER DEFAULT 0, no_website_flag INTEGER DEFAULT 0,
    scraped_at TEXT NOT NULL, enrichment_status TEXT DEFAULT 'pending',
    raw_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id);
  CREATE INDEX IF NOT EXISTS idx_leads_enrichment_status ON leads(enrichment_status);
  CREATE INDEX IF NOT EXISTS idx_leads_city_state ON leads(city, state);
  CREATE INDEX IF NOT EXISTS idx_leads_search_query ON leads(search_query);
  CREATE TABLE IF NOT EXISTS scraped_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    homepage_text TEXT, about_text TEXT, all_text TEXT, pages_scraped INTEGER DEFAULT 0, scraped_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS enrichment_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scoring_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    score INTEGER NOT NULL, confidence TEXT, recommended_action TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    outreach_json TEXT NOT NULL, followup_json TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS linkedin_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
    linkedin_url TEXT, owner_name_from_linkedin TEXT, owner_title_from_linkedin TEXT, linkedin_headline TEXT,
    rate_limited INTEGER DEFAULT 0, data_quality TEXT DEFAULT 'normal', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS suppression_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS outreach_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id),
    outreach_data_id INTEGER, outcome TEXT NOT NULL, tier_used TEXT, score_at_send INTEGER,
    notes TEXT, outcome_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS lead_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id),
    stage TEXT NOT NULL, provider TEXT NOT NULL,
    input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_id ON lead_costs(lead_id);
`;
