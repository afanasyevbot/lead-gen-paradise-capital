/**
 * Smoke tests for /api/leads/[id] (GET, DELETE, PATCH).
 *
 * Pure DB routes — no LLM mocking needed. The /actions route is covered
 * separately because each branch needs its own mock setup.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

const { seedLead, getDb } = await setupApiTestHarness();

const leadDetailRoute = await import("@/app/api/leads/[id]/route");

function paramsFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

describe("GET /api/leads/[id]", () => {
  it("returns 404 for missing lead", async () => {
    const req = new NextRequest("http://localhost/api/leads/9999");
    const res = await leadDetailRoute.GET(req, paramsFor(9999));
    expect(res.status).toBe(404);
  });

  it("returns lead detail for existing lead", async () => {
    const id = seedLead({ business_name: "Detail Co" });
    const req = new NextRequest(`http://localhost/api/leads/${id}`);
    const res = await leadDetailRoute.GET(req, paramsFor(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business_name).toBe("Detail Co");
    expect(body.id).toBe(id);
  });

  it("returns null fields for un-enriched lead (joined tables empty)", async () => {
    const id = seedLead();
    const req = new NextRequest(`http://localhost/api/leads/${id}`);
    const res = await leadDetailRoute.GET(req, paramsFor(id));
    const body = await res.json();
    expect(body.scoring).toBeNull();
    expect(body.outreach).toBeNull();
    expect(body.linkedin).toBeNull();
  });
});

describe("DELETE /api/leads/[id]", () => {
  it("returns 404 for missing lead", async () => {
    const req = new NextRequest("http://localhost/api/leads/9999", { method: "DELETE" });
    const res = await leadDetailRoute.DELETE(req, paramsFor(9999));
    expect(res.status).toBe(404);
  });

  it("deletes lead and related rows", async () => {
    const id = seedLead();
    const db = getDb();
    db.prepare(
      "INSERT INTO scraped_content (lead_id, all_text, scraped_at) VALUES (?, ?, ?)",
    ).run(id, "hello", new Date().toISOString());

    const req = new NextRequest(`http://localhost/api/leads/${id}`, { method: "DELETE" });
    const res = await leadDetailRoute.DELETE(req, paramsFor(id));
    expect(res.status).toBe(200);

    const remaining = db.prepare("SELECT id FROM leads WHERE id = ?").get(id);
    expect(remaining).toBeUndefined();
    const scraped = db.prepare("SELECT id FROM scraped_content WHERE lead_id = ?").get(id);
    expect(scraped).toBeUndefined();
  });
});

describe("PATCH /api/leads/[id]", () => {
  it("returns 404 for missing lead", async () => {
    const req = new NextRequest("http://localhost/api/leads/9999", {
      method: "PATCH",
      body: JSON.stringify({ action: "reset" }),
    });
    const res = await leadDetailRoute.PATCH(req, paramsFor(9999));
    expect(res.status).toBe(404);
  });

  it("returns 400 for unknown action", async () => {
    const id = seedLead();
    const req = new NextRequest(`http://localhost/api/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "explode" }),
    });
    const res = await leadDetailRoute.PATCH(req, paramsFor(id));
    expect(res.status).toBe(400);
  });

  it("reset action sets status to 'pending' when no scraped content", async () => {
    const id = seedLead({ status: "scored" });
    const req = new NextRequest(`http://localhost/api/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reset" }),
    });
    const res = await leadDetailRoute.PATCH(req, paramsFor(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newStatus).toBe("pending");
  });

  it("reset action sets status to 'scraped' when scraped content exists", async () => {
    const id = seedLead({ status: "scored" });
    const db = getDb();
    db.prepare(
      "INSERT INTO scraped_content (lead_id, all_text, scraped_at) VALUES (?, ?, ?)",
    ).run(id, "hello", new Date().toISOString());

    const req = new NextRequest(`http://localhost/api/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reset" }),
    });
    const res = await leadDetailRoute.PATCH(req, paramsFor(id));
    const body = await res.json();
    expect(body.newStatus).toBe("scraped");
  });
});
