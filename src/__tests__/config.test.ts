import { describe, it, expect } from "vitest";
import { SEARCH_PRESETS, isChain, KNOWN_CHAINS } from "@/lib/config";

// ─── SEARCH_PRESETS ──────────────────────────────────────────────────────────

describe("SEARCH_PRESETS", () => {
  it("contains expected preset keys", () => {
    const keys = Object.keys(SEARCH_PRESETS);
    expect(keys).toContain("marine");
    expect(keys).toContain("hvac");
    expect(keys).toContain("landscaping");
    expect(keys).toContain("plumbing");
    expect(keys).toContain("manufacturing");
    expect(keys).toContain("construction");
    expect(keys).toContain("auto");
    expect(keys).toContain("electrical");
    expect(keys).toContain("pest-control");
    expect(keys).toContain("waste");
  });

  it("all presets have at least one query", () => {
    for (const [key, queries] of Object.entries(SEARCH_PRESETS)) {
      expect(queries.length, `Preset "${key}" has no queries`).toBeGreaterThan(0);
    }
  });

  it("all queries are non-empty strings", () => {
    for (const [key, queries] of Object.entries(SEARCH_PRESETS)) {
      for (const q of queries) {
        expect(typeof q, `Non-string query in "${key}"`).toBe("string");
        expect(q.trim().length, `Empty query in "${key}"`).toBeGreaterThan(0);
      }
    }
  });

  it("marine preset has expected queries", () => {
    expect(SEARCH_PRESETS.marine).toContain("marina");
    expect(SEARCH_PRESETS.marine).toContain("boat dealer");
  });
});

// ─── isChain ─────────────────────────────────────────────────────────────────

describe("isChain", () => {
  it("detects known chain names", () => {
    expect(isChain("Jiffy Lube")).toBe(true);
    expect(isChain("MEINEKE Car Care")).toBe(true);
    expect(isChain("Home Depot #4521")).toBe(true);
    expect(isChain("servpro of tampa")).toBe(true);
  });

  it("returns false for independent businesses", () => {
    expect(isChain("Joe's Auto Repair")).toBe(false);
    expect(isChain("Tampa Marine Services LLC")).toBe(false);
    expect(isChain("Smith & Sons Plumbing")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isChain("JIFFY LUBE")).toBe(true);
    expect(isChain("jiffy lube")).toBe(true);
    expect(isChain("Jiffy Lube")).toBe(true);
  });

  it("handles empty and whitespace strings", () => {
    expect(isChain("")).toBe(false);
    expect(isChain("   ")).toBe(false);
  });

  it("matches partial names (chain name embedded in business name)", () => {
    expect(isChain("Midas Auto Care Center of Orlando")).toBe(true);
    expect(isChain("Mr. Rooter Plumbing of South Tampa")).toBe(true);
  });
});

// ─── KNOWN_CHAINS ────────────────────────────────────────────────────────────

describe("KNOWN_CHAINS", () => {
  it("is a Set", () => {
    expect(KNOWN_CHAINS).toBeInstanceOf(Set);
  });

  it("has entries in lowercase", () => {
    for (const chain of KNOWN_CHAINS) {
      expect(chain).toBe(chain.toLowerCase());
    }
  });

  it("contains major franchise brands", () => {
    expect(KNOWN_CHAINS.has("jiffy lube")).toBe(true);
    expect(KNOWN_CHAINS.has("home depot")).toBe(true);
    expect(KNOWN_CHAINS.has("roto-rooter")).toBe(true);
  });
});
