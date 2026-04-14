import { describe, it, expect } from "vitest";
import {
  scoreToTier,
  scoreToAction,
  requiresManualReview,
  isHighValueLead,
  getFormatStyle,
} from "@/domain/scoring";

describe("scoreToTier", () => {
  it("maps 8-10 to legacy", () => {
    expect(scoreToTier(8)).toBe("legacy");
    expect(scoreToTier(9)).toBe("legacy");
    expect(scoreToTier(10)).toBe("legacy");
  });

  it("maps 5-7 to seed_planter", () => {
    expect(scoreToTier(5)).toBe("seed_planter");
    expect(scoreToTier(6)).toBe("seed_planter");
    expect(scoreToTier(7)).toBe("seed_planter");
  });

  it("maps 1-4 to awareness", () => {
    expect(scoreToTier(1)).toBe("awareness");
    expect(scoreToTier(2)).toBe("awareness");
    expect(scoreToTier(3)).toBe("awareness");
    expect(scoreToTier(4)).toBe("awareness");
  });
});

describe("scoreToAction", () => {
  it("returns reach_out_now for high scores with confidence", () => {
    expect(scoreToAction(8, "high")).toBe("reach_out_now");
    expect(scoreToAction(9, "medium")).toBe("reach_out_now");
  });

  it("returns reach_out_warm for score 7 with low confidence", () => {
    expect(scoreToAction(7, "low")).toBe("reach_out_warm");
  });

  it("returns reach_out_warm for score 5-6", () => {
    expect(scoreToAction(5, "medium")).toBe("reach_out_warm");
    expect(scoreToAction(6, "high")).toBe("reach_out_warm");
  });

  it("returns offer_booklet for score 4", () => {
    expect(scoreToAction(4, "medium")).toBe("offer_booklet");
  });

  it("returns monitor for score 3", () => {
    expect(scoreToAction(3, "medium")).toBe("monitor");
  });

  it("returns skip for score 1-2", () => {
    expect(scoreToAction(1, "high")).toBe("skip");
    expect(scoreToAction(2, "medium")).toBe("skip");
  });
});

describe("requiresManualReview", () => {
  it("flags high scores with low confidence", () => {
    expect(requiresManualReview(8, "low", true)).toBe(true);
    expect(requiresManualReview(9, "low", true)).toBe(true);
  });

  it("flags unconfirmed founders in outreach range", () => {
    expect(requiresManualReview(6, "high", false)).toBe(true);
    expect(requiresManualReview(5, "medium", false)).toBe(true);
  });

  it("does not flag confirmed founders with good confidence", () => {
    expect(requiresManualReview(8, "high", true)).toBe(false);
    expect(requiresManualReview(6, "medium", true)).toBe(false);
  });

  it("does not flag low scores regardless", () => {
    expect(requiresManualReview(3, "low", false)).toBe(false);
    expect(requiresManualReview(4, "low", false)).toBe(false);
  });
});

describe("isHighValueLead", () => {
  it("true for score 7+ with high/medium confidence", () => {
    expect(isHighValueLead(7, "high")).toBe(true);
    expect(isHighValueLead(9, "medium")).toBe(true);
  });

  it("false for score 7+ with low confidence", () => {
    expect(isHighValueLead(7, "low")).toBe(false);
  });

  it("false for score < 7", () => {
    expect(isHighValueLead(6, "high")).toBe(false);
  });
});

describe("getFormatStyle", () => {
  it("rotates through 5 styles", () => {
    expect(getFormatStyle(0)).toBe("standard");
    expect(getFormatStyle(1)).toBe("ultra_short");
    expect(getFormatStyle(2)).toBe("question_only");
    expect(getFormatStyle(3)).toBe("story_lead");
    expect(getFormatStyle(4)).toBe("book_excerpt");
    expect(getFormatStyle(5)).toBe("standard"); // wraps
  });
});
