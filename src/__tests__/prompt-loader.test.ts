import { describe, it, expect, afterEach } from "vitest";
import {
  loadPrompt,
  loadPromptWithFallback,
  clearPromptCache,
  promptExists,
} from "@/infrastructure/ai/prompt-loader";

afterEach(() => {
  clearPromptCache();
});

describe("prompt-loader", () => {
  it("loads the extract prompt file", () => {
    const prompt = loadPrompt("extract");
    expect(prompt).toContain("data extraction agent");
    expect(prompt).toContain("Paradise Capital");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("loads the score prompt file", () => {
    const prompt = loadPrompt("score");
    expect(prompt).toContain("exit-readiness analyst");
    expect(prompt).toContain("SCORING FRAMEWORK");
  });

  it("loads the outreach prompt file", () => {
    const prompt = loadPrompt("outreach");
    expect(prompt).toContain("Paul Niccum");
    expect(prompt).toContain("THREE EMAIL TIERS");
  });

  it("loads the followup prompt file", () => {
    const prompt = loadPrompt("followup");
    expect(prompt).toContain("follow-up emails");
    expect(prompt).toContain("GRACIOUS CLOSE");
  });

  it("loads the fact-check prompt file", () => {
    const prompt = loadPrompt("fact-check");
    expect(prompt).toContain("fact-checker");
    expect(prompt).toContain("risk_level");
  });

  it("caches prompts on repeated loads", () => {
    const prompt1 = loadPrompt("extract");
    const prompt2 = loadPrompt("extract");
    // Same reference from cache
    expect(prompt1).toBe(prompt2);
  });

  it("clears cache", () => {
    loadPrompt("extract");
    clearPromptCache();
    // Should still load fine (re-reads from disk)
    const prompt = loadPrompt("extract");
    expect(prompt).toContain("data extraction agent");
  });

  it("substitutes variables", () => {
    // Create a prompt with a variable pattern manually through fallback
    const result = loadPromptWithFallback(
      "nonexistent-test-prompt",
      "Hello {{name}}, welcome to {{company}}!",
      { name: "Paul", company: "Paradise Capital" },
    );
    expect(result).toBe("Hello Paul, welcome to Paradise Capital!");
  });

  it("falls back to inline string when file missing", () => {
    const fallback = "This is the fallback prompt";
    const result = loadPromptWithFallback("does-not-exist", fallback);
    expect(result).toBe(fallback);
  });

  it("prefers file over fallback when file exists", () => {
    const result = loadPromptWithFallback("extract", "SHOULD NOT USE THIS");
    expect(result).toContain("data extraction agent");
    expect(result).not.toContain("SHOULD NOT USE THIS");
  });

  it("throws on missing file with no fallback", () => {
    expect(() => loadPrompt("nonexistent-prompt")).toThrow();
  });

  it("promptExists returns true for existing prompts", () => {
    expect(promptExists("extract")).toBe(true);
    expect(promptExists("score")).toBe(true);
    expect(promptExists("outreach")).toBe(true);
    expect(promptExists("followup")).toBe(true);
    expect(promptExists("fact-check")).toBe(true);
  });

  it("promptExists returns false for missing prompts", () => {
    expect(promptExists("nonexistent")).toBe(false);
  });
});
