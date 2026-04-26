/**
 * Smoke tests for thin pipeline-launcher routes + remaining endpoints:
 *
 *   /api/full-pipeline, /api/deep-enrich, /api/founder-analysis,
 *   /api/cost-aware-pipeline, /api/enrich-only, /api/score-outreach
 *   /api/scrape, /api/xray, /api/linkedin-session, /api/admin/weekly-report
 *
 * The launcher routes all delegate to launchPipelineJob → runPipeline. We mock
 * the orchestrator so background jobs resolve instantly without external calls.
 *
 * /api/leads/[id]/actions is intentionally skipped — each branch (scrape /
 * extract / score / outreach / linkedin / find-email) needs its own mock.
 * That belongs in a dedicated actions test file when we want to cover them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness } from "../_helpers/api-test-harness";

vi.mock("@/pipeline/orchestrator", () => ({
  runPipeline: vi.fn(async () => ({ metrics: { stages: [], totalMs: 0 } })),
}));

const { seedLead } = await setupApiTestHarness();

const fullPipelineRoute = await import("@/app/api/full-pipeline/route");
const deepEnrichRoute = await import("@/app/api/deep-enrich/route");
const founderAnalysisRoute = await import("@/app/api/founder-analysis/route");
const costAwareRoute = await import("@/app/api/cost-aware-pipeline/route");
const enrichOnlyRoute = await import("@/app/api/enrich-only/route");
const scoreOutreachRoute = await import("@/app/api/score-outreach/route");
const scrapeRoute = await import("@/app/api/scrape/route");
const xrayRoute = await import("@/app/api/xray/route");
const linkedinSessionRoute = await import("@/app/api/linkedin-session/route");
const weeklyReportRoute = await import("@/app/api/admin/weekly-report/route");

// Each pipeline-launcher test must release the lock before the next one runs.
// The lock is in-DB so the harness's beforeEach wipe handles it; but the
// background async work also runs after the test returns, so we yield.
async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(async () => {
  await tick(); // let any prior background job release its lock before wipe
});

// ─── Pipeline launcher routes (all near-identical wrappers) ────────────────

describe("pipeline launcher routes return jobId", () => {
  const cases = [
    { name: "full-pipeline", route: () => fullPipelineRoute.POST },
    { name: "deep-enrich", route: () => deepEnrichRoute.POST },
    { name: "founder-analysis", route: () => founderAnalysisRoute.POST },
    { name: "cost-aware-pipeline", route: () => costAwareRoute.POST },
    { name: "enrich-only", route: () => enrichOnlyRoute.POST },
    { name: "score-outreach", route: () => scoreOutreachRoute.POST },
  ];

  for (const c of cases) {
    it(`${c.name}: POST returns 200 with jobId`, async () => {
      const req = new NextRequest(`http://localhost/api/${c.name}`, {
        method: "POST",
        body: JSON.stringify({ limit: 1 }),
      });
      const res = await c.route()(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.jobId).toBe("string");
      await tick();
    });
  }
});

// ─── /api/scrape ────────────────────────────────────────────────────────────

describe("POST /api/scrape", () => {
  it("returns 400 when locations array is missing", async () => {
    const req = new NextRequest("http://localhost/api/scrape", {
      method: "POST",
      body: JSON.stringify({ preset: "hvac" }),
    });
    const res = await scrapeRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither preset nor queries provided", async () => {
    const req = new NextRequest("http://localhost/api/scrape", {
      method: "POST",
      body: JSON.stringify({ locations: ["Tampa, FL"] }),
    });
    const res = await scrapeRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── /api/xray ──────────────────────────────────────────────────────────────

describe("/api/xray", () => {
  it("GET returns 200 with presets", async () => {
    const res = await xrayRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toBeDefined();
    expect(typeof body.presets).toBe("object");
  });

  it("POST rejects invalid industry", async () => {
    const req = new NextRequest("http://localhost/api/xray", {
      method: "POST",
      body: JSON.stringify({ industry: "fake-industry", locations: ["Tampa, FL"] }),
    });
    const res = await xrayRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("POST rejects missing locations", async () => {
    const req = new NextRequest("http://localhost/api/xray", {
      method: "POST",
      body: JSON.stringify({ industry: "hvac", locations: [] }),
    });
    const res = await xrayRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── /api/linkedin-session ──────────────────────────────────────────────────

describe("/api/linkedin-session", () => {
  it("GET returns 200 with configured boolean", async () => {
    const res = await linkedinSessionRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe("boolean");
  });

  it("POST rejects too-short cookie value", async () => {
    const req = new NextRequest("http://localhost/api/linkedin-session", {
      method: "POST",
      body: JSON.stringify({ li_at: "short" }),
    });
    const res = await linkedinSessionRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── /api/admin/weekly-report ───────────────────────────────────────────────

describe("POST /api/admin/weekly-report", () => {
  it("returns 500 when REPORT_TOKEN is not configured", async () => {
    const prev = process.env.REPORT_TOKEN;
    delete process.env.REPORT_TOKEN;
    const req = new Request("http://localhost/api/admin/weekly-report", {
      method: "POST",
    });
    const res = await weeklyReportRoute.POST(req);
    expect(res.status).toBe(500);
    if (prev) process.env.REPORT_TOKEN = prev;
  });

  it("returns 401 when token mismatches", async () => {
    process.env.REPORT_TOKEN = "secret123";
    const req = new Request("http://localhost/api/admin/weekly-report", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await weeklyReportRoute.POST(req);
    expect(res.status).toBe(401);
    delete process.env.REPORT_TOKEN;
  });

  it("returns 500 when token matches but SLACK_WEBHOOK_URL is missing", async () => {
    process.env.REPORT_TOKEN = "secret123";
    delete process.env.SLACK_WEBHOOK_URL;
    const req = new Request("http://localhost/api/admin/weekly-report", {
      method: "POST",
      headers: { authorization: "Bearer secret123" },
    });
    const res = await weeklyReportRoute.POST(req);
    expect(res.status).toBe(500);
    delete process.env.REPORT_TOKEN;
  });
});

// Suppress the seedLead unused-import warning in CI by referencing it once.
void seedLead;
