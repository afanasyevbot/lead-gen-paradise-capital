import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ─── In-memory DB setup replicating the schema ──────────────────────────────

const TEST_DB_PATH = path.join(process.cwd(), "test-leads-" + Date.now() + ".db");
let db: Database.Database;

function setupTestDb() {
  db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS scoring_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      score REAL,
      confidence TEXT,
      recommended_action TEXT,
      data TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enrichment_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      data TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function insertLead(data: {
  place_id: string;
  business_name: string;
  city?: string;
  state?: string;
  website?: string;
  google_rating?: number;
  review_count?: number;
  is_chain?: number;
  enrichment_status?: string;
  source?: string;
}) {
  const now = new Date().toISOString();
  return db.prepare(`
    INSERT INTO leads (place_id, business_name, city, state, website, google_rating, review_count,
                       is_chain, enrichment_status, source, scraped_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.place_id,
    data.business_name,
    data.city || null,
    data.state || null,
    data.website || null,
    data.google_rating ?? null,
    data.review_count ?? null,
    data.is_chain ?? 0,
    data.enrichment_status || "pending",
    data.source || "google_maps",
    now, now, now
  );
}

function insertScore(leadId: number, score: number, confidence: string = "medium") {
  db.prepare(`
    INSERT INTO scoring_data (lead_id, score, confidence, recommended_action, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(leadId, score, confidence, "reach_out_warm", "{}", new Date().toISOString());
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Database Leads Operations", () => {
  beforeAll(() => {
    setupTestDb();

    // Seed test data
    insertLead({ place_id: "p1", business_name: "Tampa Marina", city: "Tampa", state: "FL", website: "https://tampamarina.com", google_rating: 4.5, review_count: 120, enrichment_status: "scored" });
    insertLead({ place_id: "p2", business_name: "Gulf Coast HVAC", city: "St. Petersburg", state: "FL", website: "https://gchvac.com", google_rating: 4.8, review_count: 250, enrichment_status: "enriched" });
    insertLead({ place_id: "p3", business_name: "Jiffy Lube Tampa", city: "Tampa", state: "FL", is_chain: 1, enrichment_status: "pending" });
    insertLead({ place_id: "p4", business_name: "Miami Boats", city: "Miami", state: "FL", website: "https://miamiboats.com", google_rating: 3.2, review_count: 15, enrichment_status: "scraped" });
    insertLead({ place_id: "p5", business_name: "Orlando Construction", city: "Orlando", state: "FL", enrichment_status: "outreach_generated", source: "apollo" });

    // Add scores for some leads
    insertScore(1, 8.5, "high");     // Tampa Marina
    insertScore(2, 6.0, "medium");   // Gulf Coast HVAC
    insertScore(4, 3.0, "low");      // Miami Boats
  });

  afterAll(() => {
    db.close();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  });

  describe("Basic queries", () => {
    it("counts all leads", () => {
      const result = db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number };
      expect(result.count).toBe(5);
    });

    it("queries leads with LEFT JOIN on scoring_data", () => {
      const leads = db.prepare(`
        SELECT l.*, s.score as exit_score
        FROM leads l
        LEFT JOIN scoring_data s ON s.lead_id = l.id
        ORDER BY l.id
      `).all() as Array<{ business_name: string; exit_score: number | null }>;

      expect(leads).toHaveLength(5);
      expect(leads[0].exit_score).toBe(8.5);  // Tampa Marina
      expect(leads[1].exit_score).toBe(6.0);  // Gulf Coast HVAC
      expect(leads[2].exit_score).toBeNull();  // Jiffy Lube (no score)
      expect(leads[3].exit_score).toBe(3.0);  // Miami Boats
      expect(leads[4].exit_score).toBeNull();  // Orlando Construction (no score)
    });

    it("sorts by score descending", () => {
      const leads = db.prepare(`
        SELECT l.business_name, s.score as exit_score
        FROM leads l
        LEFT JOIN scoring_data s ON s.lead_id = l.id
        ORDER BY s.score DESC
      `).all() as Array<{ business_name: string; exit_score: number | null }>;

      // Scored leads come first (DESC), then nulls
      expect(leads[0].business_name).toBe("Tampa Marina");
      expect(leads[1].business_name).toBe("Gulf Coast HVAC");
      expect(leads[2].business_name).toBe("Miami Boats");
    });
  });

  describe("Filtering", () => {
    it("filters by enrichment status", () => {
      const leads = db.prepare("SELECT * FROM leads WHERE enrichment_status = ?").all("scored") as Array<{ business_name: string }>;
      expect(leads).toHaveLength(1);
      expect(leads[0].business_name).toBe("Tampa Marina");
    });

    it("filters by business name search", () => {
      const leads = db.prepare("SELECT * FROM leads WHERE business_name LIKE ?").all("%Marina%") as Array<{ business_name: string }>;
      expect(leads).toHaveLength(1);
      expect(leads[0].business_name).toBe("Tampa Marina");
    });

    it("excludes chains", () => {
      const leads = db.prepare("SELECT * FROM leads WHERE is_chain = 0").all() as Array<{ business_name: string }>;
      expect(leads).toHaveLength(4); // All except Jiffy Lube
    });

    it("filters by minimum rating", () => {
      const leads = db.prepare("SELECT * FROM leads WHERE google_rating >= ?").all(4.0) as Array<{ business_name: string }>;
      expect(leads).toHaveLength(2); // Tampa Marina (4.5) and Gulf Coast HVAC (4.8)
    });

    it("filters by website presence", () => {
      const leads = db.prepare("SELECT * FROM leads WHERE website IS NOT NULL AND website != ''").all() as Array<{ business_name: string }>;
      expect(leads).toHaveLength(3); // Tampa Marina, Gulf Coast HVAC, Miami Boats
    });
  });

  describe("Upsert (INSERT OR REPLACE)", () => {
    it("inserts new lead with unique place_id", () => {
      const before = (db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number }).count;
      insertLead({ place_id: "p-new-test", business_name: "New Test Business", city: "Jacksonville", state: "FL" });
      const after = (db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number }).count;
      expect(after).toBe(before + 1);

      // Clean up
      db.prepare("DELETE FROM leads WHERE place_id = ?").run("p-new-test");
    });

    it("rejects duplicate place_id", () => {
      expect(() => {
        db.prepare(`
          INSERT INTO leads (place_id, business_name, scraped_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run("p1", "Duplicate", new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      }).toThrow();
    });
  });

  describe("Pagination", () => {
    it("returns correct page with LIMIT and OFFSET", () => {
      const page1 = db.prepare("SELECT * FROM leads ORDER BY id LIMIT 2 OFFSET 0").all() as Array<{ id: number }>;
      const page2 = db.prepare("SELECT * FROM leads ORDER BY id LIMIT 2 OFFSET 2").all() as Array<{ id: number }>;

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe("Enrichment data", () => {
    it("stores and retrieves enrichment JSON", () => {
      const enrichmentData = {
        owner_name: "John Smith",
        owner_email: "john@test.com",
        owner_title: "Owner",
        source: "apollo",
      };

      db.prepare("INSERT INTO enrichment_data (lead_id, data, created_at) VALUES (?, ?, ?)").run(
        1, JSON.stringify(enrichmentData), new Date().toISOString()
      );

      const result = db.prepare("SELECT data FROM enrichment_data WHERE lead_id = ?").get(1) as { data: string };
      const parsed = JSON.parse(result.data);
      expect(parsed.owner_name).toBe("John Smith");
      expect(parsed.owner_email).toBe("john@test.com");
    });

    it("extracts email with json_extract", () => {
      const result = db.prepare(
        "SELECT COUNT(*) as count FROM enrichment_data WHERE json_extract(data, '$.owner_email') IS NOT NULL"
      ).get() as { count: number };
      expect(result.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Scoring stats", () => {
    it("calculates average score", () => {
      const result = db.prepare("SELECT AVG(score) as avg_score FROM scoring_data").get() as { avg_score: number };
      expect(result.avg_score).toBeCloseTo((8.5 + 6.0 + 3.0) / 3, 1);
    });

    it("calculates score tiers", () => {
      const result = db.prepare(`
        SELECT
          SUM(CASE WHEN score >= 7 THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN score >= 4 AND score < 7 THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN score < 4 THEN 1 ELSE 0 END) as low
        FROM scoring_data
      `).get() as { high: number; medium: number; low: number };

      expect(result.high).toBe(1);   // Tampa Marina (8.5)
      expect(result.medium).toBe(1); // Gulf Coast HVAC (6.0)
      expect(result.low).toBe(1);    // Miami Boats (3.0)
    });
  });

  describe("Source breakdown", () => {
    it("groups leads by source", () => {
      const results = db.prepare("SELECT source, COUNT(*) as c FROM leads GROUP BY source").all() as Array<{ source: string; c: number }>;
      const bySource: Record<string, number> = {};
      for (const r of results) bySource[r.source] = r.c;

      expect(bySource.google_maps).toBe(4);
      expect(bySource.apollo).toBe(1);
    });
  });

  describe("Status breakdown", () => {
    it("groups leads by enrichment status", () => {
      const results = db.prepare("SELECT enrichment_status, COUNT(*) as c FROM leads GROUP BY enrichment_status").all() as Array<{ enrichment_status: string; c: number }>;
      const byStatus: Record<string, number> = {};
      for (const r of results) byStatus[r.enrichment_status] = r.c;

      expect(byStatus.pending).toBe(1);
      expect(byStatus.scraped).toBe(1);
      expect(byStatus.enriched).toBe(1);
      expect(byStatus.scored).toBe(1);
      expect(byStatus.outreach_generated).toBe(1);
    });
  });
});
