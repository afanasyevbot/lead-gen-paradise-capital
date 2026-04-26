/**
 * Smoke tests for read/write metadata routes:
 *   /api/stats, /api/presets (GET), /api/suppression, /api/outcomes, /api/jobs/[id]
 *
 * presets POST/DELETE write to a JSON file on disk — covered minimally
 * via GET only here. Adding POST/DELETE would require redirecting the file
 * path, which is out of scope for smoke coverage.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

const { seedLead } = await setupApiTestHarness();

const statsRoute = await import("@/app/api/stats/route");
const presetsRoute = await import("@/app/api/presets/route");
const suppressionRoute = await import("@/app/api/suppression/route");
const outcomesRoute = await import("@/app/api/outcomes/route");
const jobsRoute = await import("@/app/api/jobs/[id]/route");

// ─── /api/stats ─────────────────────────────────────────────────────────────

describe("GET /api/stats", () => {
  it("returns 200 with stats shape on empty DB", async () => {
    const res = await statsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body).toHaveProperty("byStatus");
    expect(body).toHaveProperty("scoreTiers");
  });

  it("counts seeded leads", async () => {
    seedLead();
    seedLead();
    const res = await statsRoute.GET();
    const body = await res.json();
    expect(body.total).toBe(2);
  });
});

// ─── /api/presets ───────────────────────────────────────────────────────────

describe("GET /api/presets", () => {
  it("returns 200 with built-in presets", async () => {
    const res = await presetsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toBeDefined();
    expect(typeof body.presets).toBe("object");
  });
});

describe("POST /api/presets", () => {
  it("rejects missing name", async () => {
    const req = new NextRequest("http://localhost/api/presets", {
      method: "POST",
      body: JSON.stringify({ queries: ["a"] }),
    });
    const res = await presetsRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty queries", async () => {
    const req = new NextRequest("http://localhost/api/presets", {
      method: "POST",
      body: JSON.stringify({ name: "test", queries: [] }),
    });
    const res = await presetsRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/presets", () => {
  it("rejects missing key", async () => {
    const req = new NextRequest("http://localhost/api/presets", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    const res = await presetsRoute.DELETE(req);
    expect(res.status).toBe(400);
  });
});

// ─── /api/suppression ───────────────────────────────────────────────────────

describe("/api/suppression", () => {
  it("GET returns empty list initially", async () => {
    const res = await suppressionRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suppression_list).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("POST rejects missing email or reason", async () => {
    const req = new NextRequest("http://localhost/api/suppression", {
      method: "POST",
      body: JSON.stringify({ email: "x@y.com" }),
    });
    const res = await suppressionRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("POST adds an entry then GET returns it", async () => {
    const post = new NextRequest("http://localhost/api/suppression", {
      method: "POST",
      body: JSON.stringify({ email: "block@example.com", reason: "manual" }),
    });
    const postRes = await suppressionRoute.POST(post);
    expect(postRes.status).toBe(200);

    const getRes = await suppressionRoute.GET();
    const body = await getRes.json();
    expect(body.total).toBe(1);
  });

  it("DELETE rejects missing email", async () => {
    const req = new NextRequest("http://localhost/api/suppression", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    const res = await suppressionRoute.DELETE(req);
    expect(res.status).toBe(400);
  });
});

// ─── /api/outcomes ──────────────────────────────────────────────────────────

describe("/api/outcomes", () => {
  it("GET returns summary shape on empty DB", async () => {
    const req = new NextRequest("http://localhost/api/outcomes");
    const res = await outcomesRoute.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("by_tier");
  });

  it("POST rejects missing fields", async () => {
    const req = new NextRequest("http://localhost/api/outcomes", {
      method: "POST",
      body: JSON.stringify({ lead_id: 1 }),
    });
    const res = await outcomesRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("POST rejects invalid outcome value", async () => {
    const id = seedLead();
    const req = new NextRequest("http://localhost/api/outcomes", {
      method: "POST",
      body: JSON.stringify({ lead_id: id, outcome: "exploded" }),
    });
    const res = await outcomesRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("POST accepts valid outcome", async () => {
    const id = seedLead();
    const req = new NextRequest("http://localhost/api/outcomes", {
      method: "POST",
      body: JSON.stringify({ lead_id: id, outcome: "no_response" }),
    });
    const res = await outcomesRoute.POST(req);
    expect(res.status).toBe(200);
  });
});

// ─── /api/jobs/[id] ─────────────────────────────────────────────────────────

describe("GET /api/jobs/[id]", () => {
  it("returns 404 for unknown job id", async () => {
    const req = new NextRequest("http://localhost/api/jobs/nonexistent");
    const res = await jobsRoute.GET(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });
});
