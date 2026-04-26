/**
 * Integration tests for API route handlers.
 *
 * Spins up a real SQLite DB at a temp path, seeds rows, and invokes the
 * exported route handlers directly with NextRequest. No HTTP server.
 *
 * Shared setup (DB lifecycle, seedLead, streamToString) lives in
 * _helpers/api-test-harness.ts so other API test files can reuse it.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { setupApiTestHarness, streamToString } from "./_helpers/api-test-harness";

const { seedLead } = await setupApiTestHarness();

const exportRoute = await import("@/app/api/export/route");
const leadsRoute = await import("@/app/api/leads/route");
const uploadRoute = await import("@/app/api/upload/route");

// ─── /api/leads ─────────────────────────────────────────────────────────────

describe("GET /api/leads", () => {
  it("returns empty list when no leads", async () => {
    const req = new NextRequest("http://localhost/api/leads");
    const res = await leadsRoute.GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.leads).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns seeded leads with pagination metadata", async () => {
    seedLead({ place_id: "p1", business_name: "Alpha" });
    seedLead({ place_id: "p2", business_name: "Beta" });
    const req = new NextRequest("http://localhost/api/leads");
    const res = await leadsRoute.GET(req);
    const body = await res.json();
    expect(body.leads.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
  });

  it("filters by status", async () => {
    seedLead({ place_id: "p1", status: "pending" });
    seedLead({ place_id: "p2", status: "scored" });
    const req = new NextRequest("http://localhost/api/leads?status=scored");
    const res = await leadsRoute.GET(req);
    const body = await res.json();
    expect(body.leads.length).toBe(1);
    expect(body.leads[0].enrichment_status).toBe("scored");
  });

  it("rejects unknown sortBy gracefully (whitelist)", async () => {
    seedLead();
    const req = new NextRequest("http://localhost/api/leads?sortBy=password;DROP");
    const res = await leadsRoute.GET(req);
    expect(res.status).toBe(200); // doesn't crash; whitelist falls back to default
  });
});

describe("PATCH /api/leads", () => {
  it("returns 400 for unknown action", async () => {
    const req = new NextRequest("http://localhost/api/leads?action=nope", { method: "PATCH" });
    const res = await leadsRoute.PATCH(req);
    expect(res.status).toBe(400);
  });

  it("reset-xray flips eligible rows back to pending", async () => {
    seedLead({ place_id: "p1", source: "linkedin_xray", status: "no_website" });
    seedLead({ place_id: "p2", source: "linkedin_xray", status: "scored" }); // not eligible
    const req = new NextRequest("http://localhost/api/leads?action=reset-xray", { method: "PATCH" });
    const res = await leadsRoute.PATCH(req);
    const body = await res.json();
    expect(body.reset).toBe(1);
  });
});

// ─── /api/export ────────────────────────────────────────────────────────────

describe("GET /api/export", () => {
  it("streams CSV with header row + lead rows", async () => {
    seedLead({ place_id: "p1", business_name: "Alpha, Inc." }); // forces quoting
    seedLead({ place_id: "p2", business_name: "Beta" });
    const req = new NextRequest("http://localhost/api/export");
    const res = await exportRoute.GET(req);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("paradise_leads.csv");
    const csv = await streamToString(res.body!);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("business_name");
    expect(lines.length).toBe(3); // header + 2 leads
    expect(csv).toContain('"Alpha, Inc."'); // properly quoted
  });

  it("streams valid JSON array when format=json", async () => {
    seedLead({ place_id: "p1", business_name: "Alpha" });
    seedLead({ place_id: "p2", business_name: "Beta" });
    const req = new NextRequest("http://localhost/api/export?format=json");
    const res = await exportRoute.GET(req);
    const json = await streamToString(res.body!);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).not.toHaveProperty("raw_data");
  });

  it("returns valid empty JSON array when no leads", async () => {
    const req = new NextRequest("http://localhost/api/export?format=json");
    const res = await exportRoute.GET(req);
    const json = await streamToString(res.body!);
    expect(JSON.parse(json)).toEqual([]);
  });
});

// ─── /api/upload ────────────────────────────────────────────────────────────

function makeUploadRequest(csv: string, filename = "test.csv"): NextRequest {
  const blob = new Blob([csv], { type: "text/csv" });
  const file = new File([blob], filename, { type: "text/csv" });
  const fd = new FormData();
  fd.append("file", file);
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: fd });
}

describe("POST /api/upload", () => {
  it("rejects non-CSV filename", async () => {
    const req = makeUploadRequest("a,b\n1,2", "data.txt");
    const res = await uploadRoute.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("CSV");
  });

  it("returns 400 when no file provided", async () => {
    const fd = new FormData();
    const req = new NextRequest("http://localhost/api/upload", { method: "POST", body: fd });
    const res = await uploadRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("imports a basic Apollo-style CSV", async () => {
    const csv =
      `Company,Email,First Name,Last Name,Title,City,State,Phone\n` +
      `Acme HVAC,owner@acme.com,Bob,Jones,CEO,Springfield,IL,555-1000\n`;
    const req = makeUploadRequest(csv, "leads.csv");
    const res = await uploadRoute.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.inserted + body.updated).toBeGreaterThanOrEqual(1);
    expect(body.failed).toBe(0);
  });

  it("rate-limits after 10 uploads from same IP", async () => {
    const csv = `Company,Email\nAcme,owner@acme.com\n`;
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const req = new NextRequest("http://localhost/api/upload", {
        method: "POST",
        body: (() => { const fd = new FormData(); fd.append("file", new File([csv], "x.csv", { type: "text/csv" })); return fd; })(),
        headers: { "x-forwarded-for": "9.9.9.9" },
      });
      const res = await uploadRoute.POST(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
