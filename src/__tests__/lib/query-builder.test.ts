import { describe, it, expect } from "vitest";
import { buildLeadsWhere, buildLeadsSort } from "@/lib/db/query-builder";

describe("buildLeadsWhere", () => {
  it("returns empty sql + no params for empty filters", () => {
    expect(buildLeadsWhere({})).toEqual({ sql: "", params: [] });
  });

  it("qualifies leads columns with l. prefix", () => {
    const { sql, params } = buildLeadsWhere({
      status: "scored",
      minRating: 4.0,
      hasWebsite: true,
      excludeChains: true,
      search: "acme",
    });
    expect(sql).toBe(
      "WHERE l.enrichment_status = ? AND l.google_rating >= ? AND l.website IS NOT NULL AND l.website != '' AND l.is_chain = 0 AND l.business_name LIKE ?"
    );
    expect(params).toEqual(["scored", 4.0, "%acme%"]);
  });

  it("qualifies score conditions with s. prefix per tier", () => {
    expect(buildLeadsWhere({ scoreTier: "high" }).sql).toBe("WHERE s.score >= 7");
    expect(buildLeadsWhere({ scoreTier: "medium" }).sql).toBe(
      "WHERE s.score >= 4 AND s.score < 7"
    );
    expect(buildLeadsWhere({ scoreTier: "low" }).sql).toBe(
      "WHERE s.score < 4 AND s.score IS NOT NULL"
    );
    expect(buildLeadsWhere({ scoreTier: "unscored" }).sql).toBe("WHERE s.score IS NULL");
  });

  it("qualifies email conditions with fe. prefix", () => {
    expect(buildLeadsWhere({ hasEmail: true }).sql).toBe("WHERE fe.email IS NOT NULL");
    expect(buildLeadsWhere({ hasEmail: false }).sql).toBe("WHERE fe.email IS NULL");
  });

  it("does not include status filter when undefined (regression: empty string)", () => {
    const { sql, params } = buildLeadsWhere({ status: undefined });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });
});

describe("buildLeadsSort", () => {
  it("defaults to id DESC", () => {
    expect(buildLeadsSort({})).toEqual({ expr: "l.id", dir: "DESC" });
  });

  it("rejects unknown columns and falls back to id", () => {
    expect(buildLeadsSort({ sortBy: "drop_table" }).expr).toBe("l.id");
  });

  it("uses s.score for the score column", () => {
    expect(buildLeadsSort({ sortBy: "score", sortOrder: "asc" })).toEqual({
      expr: "s.score",
      dir: "ASC",
    });
  });
});
