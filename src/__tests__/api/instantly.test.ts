/**
 * Smoke tests for /api/instantly/{campaigns,push,ready}.
 *
 * The campaigns + push routes call the Instantly API. We mock the @/lib/instantly
 * module so tests don't hit the network.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

vi.mock("@/lib/instantly", () => ({
  listCampaigns: vi.fn(async () => [{ id: "camp1", name: "Test Campaign" }]),
  pushLeadsBulk: vi.fn(async () => ({ success: true, pushed: 1 })),
  dbLeadToInstantlyLead: vi.fn((lead, enrichment) => {
    const email = enrichment?.owner_email;
    if (!email) return null;
    return { email, first_name: "Test", last_name: "Owner", company_name: lead.business_name };
  }),
}));

const { seedLead } = await setupApiTestHarness();

const campaignsRoute = await import("@/app/api/instantly/campaigns/route");
const readyRoute = await import("@/app/api/instantly/ready/route");
const pushRoute = await import("@/app/api/instantly/push/route");

describe("GET /api/instantly/campaigns", () => {
  it("returns 200 with campaigns array", async () => {
    const res = await campaignsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.campaigns)).toBe(true);
  });
});

describe("GET /api/instantly/ready", () => {
  it("returns 200 with empty leads on empty DB", async () => {
    const res = await readyRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("excludes leads not in 'outreach_generated' status", async () => {
    seedLead({ status: "scored" });
    const res = await readyRoute.GET();
    const body = await res.json();
    expect(body.total).toBe(0);
  });
});

describe("POST /api/instantly/push", () => {
  it("returns 400 when campaignId missing", async () => {
    const req = new NextRequest("http://localhost/api/instantly/push", {
      method: "POST",
      body: JSON.stringify({ leadIds: [1] }),
    });
    const res = await pushRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when leadIds missing or empty", async () => {
    const req = new NextRequest("http://localhost/api/instantly/push", {
      method: "POST",
      body: JSON.stringify({ campaignId: "camp1", leadIds: [] }),
    });
    const res = await pushRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when no leads have emails", async () => {
    const id = seedLead();
    const req = new NextRequest("http://localhost/api/instantly/push", {
      method: "POST",
      body: JSON.stringify({ campaignId: "camp1", leadIds: [id] }),
    });
    const res = await pushRoute.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("email");
  });
});
