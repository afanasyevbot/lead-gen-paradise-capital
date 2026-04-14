import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { LeadsRepository } from "@/infrastructure/db/leads.repository";
import { EnrichmentRepository } from "@/infrastructure/db/enrichment.repository";
import { SuppressionRepository } from "@/infrastructure/db/suppression.repository";
import { readFileSync } from "fs";
import { resolve } from "path";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const schemaPath = resolve(__dirname, "../infrastructure/db/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

function insertTestLead(db: Database.Database, overrides: Record<string, unknown> = {}): number {
  const now = new Date().toISOString();
  const defaults = {
    place_id: `test-${Date.now()}-${Math.random()}`,
    business_name: "Test Business",
    scraped_at: now,
    enrichment_status: "pending",
    created_at: now,
    updated_at: now,
  };
  const lead = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO leads (place_id, business_name, scraped_at, enrichment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lead.place_id, lead.business_name, lead.scraped_at, lead.enrichment_status, lead.created_at, lead.updated_at);
  return Number(result.lastInsertRowid);
}

// ─── LeadsRepository ────────────────────────────────────────────────────────

describe("LeadsRepository", () => {
  let db: Database.Database;
  let repo: LeadsRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new LeadsRepository(db);
  });

  it("getAll returns empty list on empty db", () => {
    const result = repo.getAll();
    expect(result.leads).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("getAll returns leads with pagination", () => {
    for (let i = 0; i < 5; i++) insertTestLead(db, { place_id: `lead-${i}`, business_name: `Biz ${i}` });
    const result = repo.getAll({ page: 1, pageSize: 3 });
    expect(result.leads).toHaveLength(3);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(3);
  });

  it("getAll filters by status", () => {
    insertTestLead(db, { place_id: "a", enrichment_status: "pending" });
    insertTestLead(db, { place_id: "b", enrichment_status: "scored" });
    insertTestLead(db, { place_id: "c", enrichment_status: "scored" });
    const result = repo.getAll({ status: "scored" });
    expect(result.leads).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("getById returns lead or undefined", () => {
    const id = insertTestLead(db);
    expect(repo.getById(id)).toBeDefined();
    expect(repo.getById(99999)).toBeUndefined();
  });

  it("getByStatus returns matching leads", () => {
    insertTestLead(db, { place_id: "x", enrichment_status: "enriched" });
    insertTestLead(db, { place_id: "y", enrichment_status: "enriched" });
    insertTestLead(db, { place_id: "z", enrichment_status: "pending" });
    const results = repo.getByStatus("enriched");
    expect(results).toHaveLength(2);
  });

  it("updateStatus changes lead status", () => {
    const id = insertTestLead(db);
    repo.updateStatus(id, "scraped");
    const lead = repo.getById(id);
    expect(lead?.enrichment_status).toBe("scraped");
  });

  it("bulkUpdateStatus updates multiple leads", () => {
    const id1 = insertTestLead(db, { place_id: "b1" });
    const id2 = insertTestLead(db, { place_id: "b2" });
    repo.bulkUpdateStatus([id1, id2], "enriched");
    expect(repo.getById(id1)?.enrichment_status).toBe("enriched");
    expect(repo.getById(id2)?.enrichment_status).toBe("enriched");
  });

  it("upsert inserts new lead", () => {
    const inserted = repo.upsert({
      place_id: "new-lead",
      business_name: "New Biz",
      source: "google_maps",
    });
    expect(inserted).toBe(true);
    const result = repo.getAll();
    expect(result.total).toBe(1);
  });

  it("upsert updates existing lead", () => {
    repo.upsert({ place_id: "existing", business_name: "Old Name" });
    const updated = repo.upsert({ place_id: "existing", business_name: "New Name" });
    expect(updated).toBe(false);
    const result = repo.getAll();
    expect(result.total).toBe(1);
    expect(result.leads[0].business_name).toBe("New Name");
  });
});

// ─── EnrichmentRepository ───────────────────────────────────────────────────

describe("EnrichmentRepository", () => {
  let db: Database.Database;
  let repo: EnrichmentRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new EnrichmentRepository(db);
  });

  it("saves and retrieves extraction data", () => {
    const leadId = insertTestLead(db);
    repo.saveExtraction(leadId, { owner_name: "John", industry_category: "HVAC" });
    const result = repo.getExtraction(leadId);
    expect(result).toEqual({ owner_name: "John", industry_category: "HVAC" });
  });

  it("returns null for missing extraction", () => {
    expect(repo.getExtraction(99999)).toBeNull();
  });

  it("saves and retrieves scoring data", () => {
    const leadId = insertTestLead(db);
    repo.saveScoring(leadId, 8, "high", "reach_out_now", { best_angle: "legacy founder" });
    const result = repo.getScoring(leadId);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(8);
    expect(result!.confidence).toBe("high");
    expect(result!.data.best_angle).toBe("legacy founder");
  });

  it("saves and retrieves outreach data", () => {
    const leadId = insertTestLead(db);
    const outreach = { subject_line: "Your next chapter", email_body: "Dear John..." };
    const followups = { follow_up_1: { subject_line: "FU1" }, follow_up_2: { subject_line: "FU2" } };
    repo.saveOutreach(leadId, outreach, followups);
    const result = repo.getOutreach(leadId);
    expect(result!.outreach.subject_line).toBe("Your next chapter");
    expect(result!.followups).toBeDefined();
  });

  it("saves and retrieves LinkedIn data", () => {
    const leadId = insertTestLead(db);
    repo.saveLinkedIn(leadId, {
      linkedin_url: "https://linkedin.com/in/john",
      owner_name: "John Smith",
      owner_title: "Founder & CEO",
      headline: "30+ years in HVAC",
      rate_limited: false,
      data_quality: "normal",
    });
    const result = repo.getLinkedIn(leadId);
    expect(result!.linkedin_url).toBe("https://linkedin.com/in/john");
    expect(result!.owner_name).toBe("John Smith");
  });

  it("getBundle returns all enrichment data for a lead", () => {
    const leadId = insertTestLead(db);
    repo.saveExtraction(leadId, { owner_name: "Test" });
    repo.saveScoring(leadId, 7, "medium", "reach_out_warm", { reasoning: "looks good" });
    const bundle = repo.getBundle(leadId);
    expect(bundle.enrichment).toEqual({ owner_name: "Test" });
    expect(bundle.scoringMeta!.score).toBe(7);
  });

  it("getBundle returns nulls for unenriched lead", () => {
    const leadId = insertTestLead(db);
    const bundle = repo.getBundle(leadId);
    expect(bundle.enrichment).toBeNull();
    expect(bundle.scoring).toBeNull();
    expect(bundle.outreach).toBeNull();
    expect(bundle.linkedin).toBeNull();
  });
});

// ─── SuppressionRepository ──────────────────────────────────────────────────

describe("SuppressionRepository", () => {
  let db: Database.Database;
  let repo: SuppressionRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new SuppressionRepository(db);
  });

  it("add and check suppression", () => {
    expect(repo.isEmailSuppressed("test@example.com")).toBe(false);
    repo.add("test@example.com", "unsubscribed", "user");
    expect(repo.isEmailSuppressed("test@example.com")).toBe(true);
  });

  it("case-insensitive check", () => {
    repo.add("Test@Example.COM", "bounce", "system");
    expect(repo.isEmailSuppressed("test@example.com")).toBe(true);
    expect(repo.isEmailSuppressed("TEST@EXAMPLE.COM")).toBe(true);
  });

  it("bulkCheck returns suppressed emails", () => {
    repo.add("a@test.com", "bounce", "system");
    repo.add("c@test.com", "unsubscribe", "user");
    const suppressed = repo.bulkCheck(["a@test.com", "b@test.com", "c@test.com"]);
    expect(suppressed.size).toBe(2);
    expect(suppressed.has("a@test.com")).toBe(true);
    expect(suppressed.has("c@test.com")).toBe(true);
  });

  it("getAll returns full list", () => {
    repo.add("x@test.com", "r1", "s1");
    repo.add("y@test.com", "r2", "s2");
    const list = repo.getAll();
    expect(list).toHaveLength(2);
  });

  it("remove deletes entry", () => {
    repo.add("delete@test.com", "test", "test");
    expect(repo.isEmailSuppressed("delete@test.com")).toBe(true);
    repo.remove("delete@test.com");
    expect(repo.isEmailSuppressed("delete@test.com")).toBe(false);
  });
});
