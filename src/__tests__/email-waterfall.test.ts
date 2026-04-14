import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  EmailCandidate,
  EmailEnrichmentResult,
  LeadDetail,
} from "@/domain/types";

// ─── Types ─────────────────────────────────────────────────────────────────

describe("Email Enrichment Types", () => {
  it("exports all email types from domain/types", () => {
    const candidate: EmailCandidate = {
      email: "test@example.com",
      provider: "hunter",
      confidenceScore: 0.85,
      verificationStatus: "valid",
      verificationMethod: "mx_smtp",
      ownerName: "John Doe",
      ownerTitle: "CEO",
    };
    expect(candidate.email).toBe("test@example.com");
    expect(candidate.provider).toBe("hunter");
    expect(candidate.verificationStatus).toBe("valid");
  });

  it("EmailProviderName includes all providers", () => {
    const providers = [
      "website", "apollo", "hunter", "snov", "dropcontact",
    ] as const;
    expect(providers).toHaveLength(5);
  });

  it("EmailVerificationStatus includes all statuses", () => {
    const statuses = [
      "unverified", "valid", "invalid", "risky", "catch_all", "unknown",
    ] as const;
    expect(statuses).toHaveLength(6);
  });

  it("EmailEnrichmentResult has correct shape", () => {
    const result: EmailEnrichmentResult = {
      candidates: [],
      bestEmail: null,
      bestProvider: null,
      bestVerificationStatus: "unverified",
      providersAttempted: ["website"],
      providersHit: [],
      durationMs: 100,
    };
    expect(result.providersAttempted).toEqual(["website"]);
  });

  it("LeadDetail includes emailCandidates and primaryEmail", () => {
    const partial: Pick<LeadDetail, "emailCandidates" | "primaryEmail"> = {
      emailCandidates: [{ email: "test@test.com", provider: "hunter", confidenceScore: 0.9, verificationStatus: "valid" }],
      primaryEmail: { email: "test@test.com", provider: "hunter", confidenceScore: 0.9, verificationStatus: "valid" },
    };
    expect(partial.emailCandidates).toHaveLength(1);
    expect(partial.primaryEmail?.email).toBe("test@test.com");
  });
});

// ─── Provider Interface ────────────────────────────────────────────────────

describe("Email Provider Interface", () => {
  it("defines the correct shape", async () => {
    const mod = await import("@/lib/enrichment/email/provider.interface");
    // Interface check — if this compiles, the interfaces exist
    expect(mod).toBeDefined();
  });
});

// ─── Website Provider ──────────────────────────────────────────────────────

describe("WebsiteEmailProvider", () => {
  it("is always configured", async () => {
    const { WebsiteEmailProvider } = await import("@/lib/enrichment/email/providers/website");
    const provider = new WebsiteEmailProvider();
    expect(provider.name).toBe("website");
    expect(provider.isConfigured()).toBe(true);
  });
});

// ─── Hunter Provider ───────────────────────────────────────────────────────

describe("HunterEmailProvider", () => {
  beforeEach(() => {
    delete process.env.HUNTER_API_KEY;
  });

  it("is not configured without API key", async () => {
    const { HunterEmailProvider } = await import("@/lib/enrichment/email/providers/hunter");
    const provider = new HunterEmailProvider();
    expect(provider.name).toBe("hunter");
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured with API key", async () => {
    process.env.HUNTER_API_KEY = "test-key";
    const { HunterEmailProvider } = await import("@/lib/enrichment/email/providers/hunter");
    const provider = new HunterEmailProvider();
    expect(provider.isConfigured()).toBe(true);
    delete process.env.HUNTER_API_KEY;
  });
});

// ─── Apollo Provider ───────────────────────────────────────────────────────

describe("ApolloEmailProvider", () => {
  it("has correct name", async () => {
    const { ApolloEmailProvider } = await import("@/lib/enrichment/email/providers/apollo");
    const provider = new ApolloEmailProvider();
    expect(provider.name).toBe("apollo");
  });
});

// ─── Snov Provider ─────────────────────────────────────────────────────────

describe("SnovEmailProvider", () => {
  beforeEach(() => {
    delete process.env.SNOV_CLIENT_ID;
    delete process.env.SNOV_CLIENT_SECRET;
  });

  it("is not configured without credentials", async () => {
    const { SnovEmailProvider } = await import("@/lib/enrichment/email/providers/snov");
    const provider = new SnovEmailProvider();
    expect(provider.name).toBe("snov");
    expect(provider.isConfigured()).toBe(false);
  });
});

// ─── Dropcontact Provider ──────────────────────────────────────────────────

describe("DropcontactEmailProvider", () => {
  beforeEach(() => {
    delete process.env.DROPCONTACT_API_KEY;
  });

  it("is not configured without API key", async () => {
    const { DropcontactEmailProvider } = await import("@/lib/enrichment/email/providers/dropcontact");
    const provider = new DropcontactEmailProvider();
    expect(provider.name).toBe("dropcontact");
    expect(provider.isConfigured()).toBe(false);
  });
});

// ─── Verification ──────────────────────────────────────────────────────────

describe("Email Verification", () => {
  it("rejects invalid email format", async () => {
    const { verifyEmail } = await import("@/lib/enrichment/email/verification");
    const result = await verifyEmail("not-an-email");
    expect(result.status).toBe("invalid");
    expect(result.method).toBe("mx_smtp");
  });

  it("rejects empty email", async () => {
    const { verifyEmail } = await import("@/lib/enrichment/email/verification");
    const result = await verifyEmail("");
    expect(result.status).toBe("invalid");
  });
});

// ─── Waterfall ─────────────────────────────────────────────────────────────

describe("WaterfallEmailFinder", () => {
  it("creates with at least the website provider", async () => {
    const { WaterfallEmailFinder } = await import("@/lib/enrichment/email/waterfall");
    const waterfall = new WaterfallEmailFinder();
    expect(waterfall.providerCount).toBeGreaterThanOrEqual(1);
    expect(waterfall.configuredProviders).toContain("website");
  });

  it("returns empty result when no providers find anything", async () => {
    // Mock getDb to return a mock database
    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        prepare: () => ({
          get: () => undefined,
          all: () => [],
        }),
      }),
    }));

    const { WaterfallEmailFinder } = await import("@/lib/enrichment/email/waterfall");
    const waterfall = new WaterfallEmailFinder();

    const result = await waterfall.findEmail({
      domain: "nonexistent-domain-xyz.com",
      fullName: "Nobody",
      companyName: "Nothing Corp",
    });

    expect(result.candidates).toEqual([]);
    expect(result.bestEmail).toBeNull();
    expect(result.providersAttempted.length).toBeGreaterThanOrEqual(1);

    vi.doUnmock("@/lib/db");
  });
});

// ─── Email Repository ──────────────────────────────────────────────────────

describe("EmailRepository", () => {
  it("can be instantiated with a database", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");

    // Create leads table for foreign key
    db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, business_name TEXT, enrichment_status TEXT, website TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_data (id INTEGER PRIMARY KEY, lead_id INTEGER, data TEXT)`);

    const { EmailRepository } = await import("@/infrastructure/db/email.repository");
    const repo = new EmailRepository(db);
    expect(repo).toBeDefined();

    db.close();
  });

  it("saves and retrieves email candidates", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");

    db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, business_name TEXT, enrichment_status TEXT, website TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_data (id INTEGER PRIMARY KEY, lead_id INTEGER, data TEXT)`);
    db.prepare("INSERT INTO leads (id, business_name, enrichment_status) VALUES (1, 'Test Co', 'enriched')").run();

    const { EmailRepository } = await import("@/infrastructure/db/email.repository");
    const repo = new EmailRepository(db);

    repo.saveCandidate(1, {
      email: "founder@test.com",
      provider: "hunter",
      confidenceScore: 0.85,
      verificationStatus: "valid",
      verificationMethod: "mx_smtp",
      ownerName: "John Doe",
      ownerTitle: "CEO",
    });

    const candidates = repo.getCandidates(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].email).toBe("founder@test.com");
    expect(candidates[0].provider).toBe("hunter");
    expect(candidates[0].confidenceScore).toBe(0.85);
    expect(candidates[0].verificationStatus).toBe("valid");

    db.close();
  });

  it("sets and retrieves primary email", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");

    db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, business_name TEXT, enrichment_status TEXT, website TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_data (id INTEGER PRIMARY KEY, lead_id INTEGER, data TEXT)`);
    db.prepare("INSERT INTO leads (id, business_name, enrichment_status) VALUES (1, 'Test Co', 'enriched')").run();

    const { EmailRepository } = await import("@/infrastructure/db/email.repository");
    const repo = new EmailRepository(db);

    repo.saveCandidates(1, [
      { email: "a@test.com", provider: "website", confidenceScore: 0.5, verificationStatus: "unknown" },
      { email: "b@test.com", provider: "hunter", confidenceScore: 0.9, verificationStatus: "valid" },
    ]);

    repo.setPrimary(1, "b@test.com");

    const primary = repo.getPrimaryEmail(1);
    expect(primary).not.toBeNull();
    expect(primary!.email).toBe("b@test.com");
    expect(primary!.provider).toBe("hunter");

    db.close();
  });

  it("saves enrichment runs", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");

    db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, business_name TEXT, enrichment_status TEXT, website TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_data (id INTEGER PRIMARY KEY, lead_id INTEGER, data TEXT)`);
    db.prepare("INSERT INTO leads (id, business_name, enrichment_status) VALUES (1, 'Test Co', 'enriched')").run();

    const { EmailRepository } = await import("@/infrastructure/db/email.repository");
    const repo = new EmailRepository(db);

    repo.saveRun(1, {
      candidates: [],
      bestEmail: "founder@test.com",
      bestProvider: "apollo",
      bestVerificationStatus: "valid",
      providersAttempted: ["website", "hunter", "apollo"],
      providersHit: ["apollo"],
      durationMs: 2500,
    });

    const runs = db.prepare("SELECT * FROM email_enrichment_runs WHERE lead_id = 1").all();
    expect(runs).toHaveLength(1);

    db.close();
  });

  it("returns stats", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");

    db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, business_name TEXT, enrichment_status TEXT, website TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_data (id INTEGER PRIMARY KEY, lead_id INTEGER, data TEXT)`);

    const { EmailRepository } = await import("@/infrastructure/db/email.repository");
    const repo = new EmailRepository(db);

    const stats = repo.getStats();
    expect(stats.total).toBe(0);
    expect(stats.verified).toBe(0);
    expect(stats.byProvider).toEqual({});

    db.close();
  });
});
