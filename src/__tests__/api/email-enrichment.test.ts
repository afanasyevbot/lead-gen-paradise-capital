/**
 * Smoke tests for /api/email-enrichment{,/providers,/reset}.
 *
 * The POST /api/email-enrichment route invokes WaterfallEmailFinder which
 * hits external providers. We mock the waterfall module to keep tests
 * hermetic.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

vi.mock("@/lib/enrichment/email/waterfall", () => ({
  WaterfallEmailFinder: class {
    configuredProviders = ["website"];
    async findEmail() {
      return { candidates: [], bestEmail: null, bestVerificationStatus: null };
    }
  },
}));

const { seedLead } = await setupApiTestHarness();

const enrichmentRoute = await import("@/app/api/email-enrichment/route");
const providersRoute = await import("@/app/api/email-enrichment/providers/route");
const resetRoute = await import("@/app/api/email-enrichment/reset/route");

describe("GET /api/email-enrichment", () => {
  it("returns 200 with stats shape", async () => {
    const res = await enrichmentRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("configuredProviders");
  });
});

describe("POST /api/email-enrichment", () => {
  it("returns 200 with empty result when no leads need email", async () => {
    const req = new NextRequest("http://localhost/api/email-enrichment", {
      method: "POST",
      body: JSON.stringify({ limit: 5 }),
    });
    const res = await enrichmentRoute.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leads_processed).toBe(0);
  });

  it("returns 200 when explicit leadIds passed (lead has no enrichment row)", async () => {
    const id = seedLead();
    const req = new NextRequest("http://localhost/api/email-enrichment", {
      method: "POST",
      body: JSON.stringify({ leadIds: [id] }),
    });
    const res = await enrichmentRoute.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No enrichment_data row → JOIN excludes it → leads_processed = 0
    expect(body.leads_processed).toBe(0);
  });
});

describe("GET /api/email-enrichment/providers", () => {
  it("returns 200 with provider list", async () => {
    const res = await providersRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.summary).toHaveProperty("total");
    expect(body.summary).toHaveProperty("configured");
  });
});

describe("/api/email-enrichment/reset", () => {
  it("GET returns 200 with stale list (empty)", async () => {
    const res = await resetRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stale_count).toBe(0);
    expect(body.leads).toEqual([]);
  });

  it("POST mode=stale returns 200 with reset count 0 on empty DB", async () => {
    const req = new NextRequest("http://localhost/api/email-enrichment/reset", {
      method: "POST",
      body: JSON.stringify({ mode: "stale" }),
    });
    const res = await resetRoute.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reset).toBe(0);
  });

  it("POST with leadIds returns 200", async () => {
    const id = seedLead();
    const req = new NextRequest("http://localhost/api/email-enrichment/reset", {
      method: "POST",
      body: JSON.stringify({ leadIds: [id] }),
    });
    const res = await resetRoute.POST(req);
    expect(res.status).toBe(200);
  });
});
