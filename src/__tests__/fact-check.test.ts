import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/enrichment/client", () => ({
  createAnthropicClient: () => ({}),
}));

const mockRetry = vi.fn();
vi.mock("@/lib/enrichment/retry", () => ({
  callAnthropicWithRetry: (...args: unknown[]) => mockRetry(...args),
}));

import { factCheckEmail } from "@/lib/enrichment/fact-check";

describe("factCheckEmail", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns safe when all claims verified", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: true,
      claims: [{ claim: "Founded in 1992", found_in_source: true, source_text: "Founded in 1992" }],
      unverified_claims: [],
      risk_level: "safe",
    });
    const result = await factCheckEmail("Founded in 1992", "Business founded in 1992");
    expect(result.risk_level).toBe("safe");
    expect(result.all_claims_verified).toBe(true);
  });

  it("returns rewrite when claims are fabricated", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: false,
      claims: [{ claim: "Won 2023 Industry Award", found_in_source: false, source_text: null }],
      unverified_claims: ["Won 2023 Industry Award"],
      risk_level: "rewrite",
    });
    const result = await factCheckEmail("Won 2023 Industry Award", "No awards mentioned");
    expect(result.risk_level).toBe("rewrite");
    expect(result.unverified_claims).toContain("Won 2023 Industry Award");
  });

  it("calls Claude with email body and source data", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: true, claims: [], unverified_claims: [], risk_level: "safe",
    });
    await factCheckEmail("test email body", "test source data");
    expect(mockRetry).toHaveBeenCalledTimes(1);
    const callArgs = mockRetry.mock.calls[0][0];
    expect(callArgs.userContent).toContain("test email body");
    expect(callArgs.userContent).toContain("test source data");
  });
});
