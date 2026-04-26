/**
 * Builds the WHERE clause + params for the leads list query.
 *
 * Replaces a regex-post-process pattern in db.ts that re-qualified column
 * names with `l.` prefixes after the fact. That approach silently broke any
 * filter whose column name overlapped with another table's column. This
 * builder emits already-qualified columns up front.
 *
 * Table aliases used by the leads list query:
 *   l  = leads
 *   s  = scoring_data
 *   fe = email_candidates (filtered to is_primary = 1)
 */
import type { LeadFilters } from "@/domain/types";

export interface LeadsWhere {
  sql: string; // includes leading "WHERE " or empty string
  params: unknown[];
}

export function buildLeadsWhere(filters: LeadFilters = {}): LeadsWhere {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("l.enrichment_status = ?");
    params.push(filters.status);
  }
  if (filters.minRating != null) {
    conditions.push("l.google_rating >= ?");
    params.push(filters.minRating);
  }
  if (filters.hasWebsite) {
    conditions.push("l.website IS NOT NULL AND l.website != ''");
  }
  if (filters.excludeChains) {
    conditions.push("l.is_chain = 0");
  }
  if (filters.search) {
    conditions.push("l.business_name LIKE ?");
    params.push(`%${filters.search}%`);
  }
  if (filters.scoreTier === "high") {
    conditions.push("s.score >= 7");
  } else if (filters.scoreTier === "medium") {
    conditions.push("s.score >= 4 AND s.score < 7");
  } else if (filters.scoreTier === "low") {
    conditions.push("s.score < 4 AND s.score IS NOT NULL");
  } else if (filters.scoreTier === "unscored") {
    conditions.push("s.score IS NULL");
  }
  if (filters.hasEmail === true) {
    conditions.push("fe.email IS NOT NULL");
  } else if (filters.hasEmail === false) {
    conditions.push("fe.email IS NULL");
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

const ALLOWED_SORT_COLS = [
  "id", "business_name", "city", "state",
  "enrichment_status", "created_at", "updated_at", "score",
] as const;

export function buildLeadsSort(filters: LeadFilters): { expr: string; dir: "ASC" | "DESC" } {
  const sortCol = filters.sortBy || "id";
  const safe = (ALLOWED_SORT_COLS as readonly string[]).includes(sortCol) ? sortCol : "id";
  return {
    expr: safe === "score" ? "s.score" : `l.${safe}`,
    dir: filters.sortOrder === "asc" ? "ASC" : "DESC",
  };
}
