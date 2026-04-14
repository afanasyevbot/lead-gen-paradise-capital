import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  getNextStatuses,
  isFailedStatus,
  isTerminalStatus,
  isReadyForOutreach,
  isFullyProcessed,
} from "@/domain/lead";

describe("canTransition", () => {
  it("allows pending → scraped", () => {
    expect(canTransition("pending", "scraped")).toBe(true);
  });

  it("allows pending → scrape_failed", () => {
    expect(canTransition("pending", "scrape_failed")).toBe(true);
  });

  it("allows scraped → enriched", () => {
    expect(canTransition("scraped", "enriched")).toBe(true);
  });

  it("allows enriched → scored", () => {
    expect(canTransition("enriched", "scored")).toBe(true);
  });

  it("allows scored → outreach_generated", () => {
    expect(canTransition("scored", "outreach_generated")).toBe(true);
  });

  it("disallows skipping stages", () => {
    expect(canTransition("pending", "enriched")).toBe(false);
    expect(canTransition("pending", "scored")).toBe(false);
    expect(canTransition("scraped", "outreach_generated")).toBe(false);
  });

  it("disallows backward transitions", () => {
    expect(canTransition("enriched", "pending")).toBe(false);
    expect(canTransition("scored", "scraped")).toBe(false);
  });

  it("allows retry from failed states", () => {
    expect(canTransition("scrape_failed", "scraped")).toBe(true);
    expect(canTransition("enrich_failed", "enriched")).toBe(true);
    expect(canTransition("score_failed", "scored")).toBe(true);
  });
});

describe("validateTransition", () => {
  it("does not throw for valid transitions", () => {
    expect(() => validateTransition("pending", "scraped")).not.toThrow();
  });

  it("throws for invalid transitions with descriptive message", () => {
    expect(() => validateTransition("pending", "scored")).toThrow("Invalid status transition");
    expect(() => validateTransition("pending", "scored")).toThrow("pending → scored");
  });
});

describe("getNextStatuses", () => {
  it("returns allowed next states for pending", () => {
    const next = getNextStatuses("pending");
    expect(next).toContain("scraped");
    expect(next).toContain("scrape_failed");
    expect(next).toContain("pre_filtered");
    expect(next).toContain("no_website");
    expect(next).toHaveLength(4);
  });

  it("returns empty for terminal state", () => {
    expect(getNextStatuses("outreach_generated")).toEqual([]);
  });
});

describe("status checks", () => {
  it("isFailedStatus", () => {
    expect(isFailedStatus("scrape_failed")).toBe(true);
    expect(isFailedStatus("enrich_failed")).toBe(true);
    expect(isFailedStatus("score_failed")).toBe(true);
    expect(isFailedStatus("pending")).toBe(false);
    expect(isFailedStatus("scored")).toBe(false);
  });

  it("isTerminalStatus", () => {
    expect(isTerminalStatus("outreach_generated")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("scored")).toBe(false);
  });

  it("isReadyForOutreach", () => {
    expect(isReadyForOutreach("scored")).toBe(true);
    expect(isReadyForOutreach("enriched")).toBe(false);
    expect(isReadyForOutreach("pending")).toBe(false);
  });

  it("isFullyProcessed", () => {
    expect(isFullyProcessed("outreach_generated")).toBe(true);
    expect(isFullyProcessed("scored")).toBe(false);
  });
});
