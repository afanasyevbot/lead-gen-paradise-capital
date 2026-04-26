/**
 * Smoke tests for read-mostly pipeline introspection routes:
 *   /api/pipeline/summary, /health, /scored-leads
 *   /api/pipeline/admin (POST)
 *   /api/debug/pipeline-check
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

const { seedLead, getDb } = await setupApiTestHarness();

const summaryRoute = await import("@/app/api/pipeline/summary/route");
const healthRoute = await import("@/app/api/pipeline/health/route");
const adminRoute = await import("@/app/api/pipeline/admin/route");
const scoredLeadsRoute = await import("@/app/api/pipeline/scored-leads/route");
const debugRoute = await import("@/app/api/debug/pipeline-check/route");

describe("GET /api/pipeline/summary", () => {
  it("returns 200 with full shape on empty DB", async () => {
    const req = new NextRequest("http://localhost/api/pipeline/summary");
    const res = await summaryRoute.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("pipeline");
    expect(body).toHaveProperty("highlights");
    expect(body).toHaveProperty("score_distribution");
    expect(body.pipeline.total).toBe(0);
  });

  it("includes this_run_scores when ?since= passed", async () => {
    const req = new NextRequest("http://localhost/api/pipeline/summary?since=2020-01-01T00:00:00Z");
    const res = await summaryRoute.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.this_run_scores).not.toBeNull();
  });
});

describe("GET /api/pipeline/health", () => {
  it("returns 200 with stages/funnel/attention shape", async () => {
    const res = await healthRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.stages)).toBe(true);
    expect(body).toHaveProperty("funnel");
    expect(body).toHaveProperty("attention");
    expect(Array.isArray(body.errors)).toBe(true);
  });
});

describe("GET /api/pipeline/scored-leads", () => {
  it("returns empty array on empty DB", async () => {
    const req = new NextRequest("http://localhost/api/pipeline/scored-leads");
    const res = await scoredLeadsRoute.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toEqual([]);
  });

  it("returns scored leads when present", async () => {
    const id = seedLead();
    getDb().prepare(
      `INSERT INTO scoring_data (lead_id, score, confidence, recommended_action, data, created_at)
       VALUES (?, 8, 'high', 'reach_out_now', '{}', datetime('now'))`,
    ).run(id);
    const req = new NextRequest("http://localhost/api/pipeline/scored-leads?limit=10");
    const res = await scoredLeadsRoute.GET(req);
    const body = await res.json();
    expect(body.leads.length).toBe(1);
    expect(body.leads[0].score).toBe(8);
  });
});

describe("POST /api/pipeline/admin", () => {
  it("returns 401 when not authorized", async () => {
    const req = new NextRequest("http://example.com/api/pipeline/admin", {
      method: "POST",
      body: JSON.stringify({ action: "retry_scrape_failed" }),
    });
    const res = await adminRoute.POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts localhost host header (no ADMIN_SECRET set)", async () => {
    const req = new NextRequest("http://localhost/api/pipeline/admin", {
      method: "POST",
      body: JSON.stringify({ action: "retry_scrape_failed" }),
      headers: { host: "localhost" },
    });
    const res = await adminRoute.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 400 for unknown action (when authorized)", async () => {
    const req = new NextRequest("http://localhost/api/pipeline/admin", {
      method: "POST",
      body: JSON.stringify({ action: "explode" }),
      headers: { host: "localhost" },
    });
    const res = await adminRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/debug/pipeline-check", () => {
  it("returns 200 with stage_queues + statuses on empty DB", async () => {
    const res = await debugRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stage_queues");
    expect(body).toHaveProperty("statuses");
    expect(body).toHaveProperty("lock");
    expect(Array.isArray(body.recent_jobs)).toBe(true);
  });
});
