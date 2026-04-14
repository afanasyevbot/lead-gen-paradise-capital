import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// ─── Test the presets file I/O logic ─────────────────────────────────────────
// We replicate the loadCustomPresets/saveCustomPresets logic from the API route
// to test it in isolation with a temp directory.

const TEST_DIR = path.join(process.cwd(), "test-data-presets-" + Date.now());
const TEST_FILE = path.join(TEST_DIR, "custom-presets.json");

function loadCustomPresets(filePath: string): Record<string, string[]> {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function saveCustomPresets(filePath: string, presets: Record<string, string[]>) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(presets, null, 2));
}

// ─── Preset name sanitization (from API route) ──────────────────────────────

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Custom Presets File I/O", () => {
  afterEach(() => {
    // Clean up test directory
    try {
      if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
      if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR);
    } catch { /* ignore */ }
  });

  it("returns empty object when file doesn't exist", () => {
    const result = loadCustomPresets("/nonexistent/path/presets.json");
    expect(result).toEqual({});
  });

  it("saves and loads presets correctly", () => {
    const presets = {
      roofing: ["roofing company", "roof repair"],
      cleaning: ["cleaning service", "janitorial company"],
    };
    saveCustomPresets(TEST_FILE, presets);
    const loaded = loadCustomPresets(TEST_FILE);
    expect(loaded).toEqual(presets);
  });

  it("creates directory if it doesn't exist", () => {
    expect(fs.existsSync(TEST_DIR)).toBe(false);
    saveCustomPresets(TEST_FILE, { test: ["query1"] });
    expect(fs.existsSync(TEST_DIR)).toBe(true);
    expect(fs.existsSync(TEST_FILE)).toBe(true);
  });

  it("overwrites existing presets", () => {
    saveCustomPresets(TEST_FILE, { a: ["q1"] });
    saveCustomPresets(TEST_FILE, { b: ["q2"] });
    const loaded = loadCustomPresets(TEST_FILE);
    expect(loaded).toEqual({ b: ["q2"] });
    expect(loaded.a).toBeUndefined();
  });

  it("handles corrupted JSON gracefully", () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(TEST_FILE, "not valid json{{{");
    const result = loadCustomPresets(TEST_FILE);
    expect(result).toEqual({});
  });

  it("handles empty file gracefully", () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(TEST_FILE, "");
    const result = loadCustomPresets(TEST_FILE);
    expect(result).toEqual({});
  });
});

describe("Preset Name Sanitization", () => {
  it("converts to lowercase kebab-case", () => {
    expect(sanitizeName("Roofing")).toBe("roofing");
    expect(sanitizeName("Pest Control")).toBe("pest-control");
    expect(sanitizeName("HVAC Services")).toBe("hvac-services");
  });

  it("removes special characters", () => {
    expect(sanitizeName("Bob's Trades!")).toBe("bob-s-trades");
    expect(sanitizeName("HVAC & Plumbing")).toBe("hvac-plumbing");
    expect(sanitizeName("test@#$%^&*()")).toBe("test");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeName("a   b   c")).toBe("a-b-c");
    expect(sanitizeName("test---name")).toBe("test-name");
  });

  it("strips leading/trailing hyphens", () => {
    expect(sanitizeName("-test-")).toBe("test");
    expect(sanitizeName("--leading")).toBe("leading");
  });

  it("handles all-special-character input", () => {
    expect(sanitizeName("@#$%")).toBe("");
  });

  it("handles numbers", () => {
    expect(sanitizeName("category123")).toBe("category123");
    expect(sanitizeName("123")).toBe("123");
  });
});

describe("Preset Validation Logic", () => {
  it("rejects empty name", () => {
    const name = "";
    expect(sanitizeName(name)).toBe("");
  });

  it("rejects empty queries array", () => {
    const queries: string[] = [];
    const cleanQueries = queries.map(q => q.trim()).filter(Boolean);
    expect(cleanQueries.length).toBe(0);
  });

  it("filters out empty/whitespace-only queries", () => {
    const queries = ["  ", "valid query", "", "  another  ", ""];
    const cleanQueries = queries.map(q => q.trim()).filter(Boolean);
    expect(cleanQueries).toEqual(["valid query", "another"]);
  });

  it("preserves valid queries", () => {
    const queries = ["roofing company", "roof repair contractor", "commercial roofing"];
    const cleanQueries = queries.map(q => q.trim()).filter(Boolean);
    expect(cleanQueries).toHaveLength(3);
    expect(cleanQueries).toEqual(queries);
  });
});
