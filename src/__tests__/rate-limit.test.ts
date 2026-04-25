import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clientKey, _resetRateLimits } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => _resetRateLimits());

  it("allows requests up to capacity", () => {
    for (let i = 0; i < 5; i++) {
      const r = rateLimit("k", { capacity: 5, windowMs: 1000 });
      expect(r.allowed).toBe(true);
    }
  });

  it("rejects the (capacity+1)th request within the window", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", { capacity: 3, windowMs: 1000 });
    const r = rateLimit("k", { capacity: 3, windowMs: 1000 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterMs).toBeGreaterThan(0);
      expect(r.retryAfterMs).toBeLessThanOrEqual(1000);
    }
  });

  it("isolates buckets by key", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", { capacity: 3, windowMs: 1000 });
    const r = rateLimit("b", { capacity: 3, windowMs: 1000 });
    expect(r.allowed).toBe(true);
  });

  it("refills tokens over time", async () => {
    rateLimit("k", { capacity: 1, windowMs: 50 });
    const blocked = rateLimit("k", { capacity: 1, windowMs: 50 });
    expect(blocked.allowed).toBe(false);
    await new Promise((res) => setTimeout(res, 60));
    const refilled = rateLimit("k", { capacity: 1, windowMs: 50 });
    expect(refilled.allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses x-forwarded-for first IP", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientKey(req, "r")).toBe("r:1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(clientKey(req, "r")).toBe("r:9.9.9.9");
  });

  it("falls back to 'unknown' if no headers", () => {
    const req = new Request("http://x");
    expect(clientKey(req, "r")).toBe("r:unknown");
  });
});
