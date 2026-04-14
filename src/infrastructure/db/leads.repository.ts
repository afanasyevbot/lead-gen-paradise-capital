/**
 * Leads Repository
 *
 * All lead-related database queries in one place.
 * Consumers pass a db instance — no global singleton dependency.
 */

import type Database from "better-sqlite3";
import type { Lead, LeadFilters, EnrichmentStatus } from "@/domain/types";

export class LeadsRepository {
  constructor(private db: Database.Database) {}

  /** Get paginated, filtered lead list with optional score join. */
  getAll(filters: LeadFilters = {}): { leads: (Lead & { exit_score: number | null })[]; total: number; page: number; pageSize: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) { conditions.push("l.enrichment_status = ?"); params.push(filters.status); }
    if (filters.minRating != null) { conditions.push("l.google_rating >= ?"); params.push(filters.minRating); }
    if (filters.hasWebsite) { conditions.push("l.website IS NOT NULL AND l.website != ''"); }
    if (filters.excludeChains) { conditions.push("l.is_chain = 0"); }
    if (filters.search) { conditions.push("l.business_name LIKE ?"); params.push(`%${filters.search}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const allowedCols = ["id", "business_name", "city", "state", "enrichment_status", "created_at", "updated_at", "score"];
    const sortCol = allowedCols.includes(filters.sortBy || "") ? filters.sortBy! : "id";
    const sortExpr = sortCol === "score" ? "s.score" : `l.${sortCol}`;
    const sortDir = filters.sortOrder === "asc" ? "ASC" : "DESC";
    const pageSize = filters.pageSize || 50;
    const page = filters.page || 1;
    const offset = (page - 1) * pageSize;

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM leads l ${where}`).get(...params) as { count: number }).count;

    const leads = this.db.prepare(
      `SELECT l.*, s.score as exit_score FROM leads l
       LEFT JOIN scoring_data s ON s.lead_id = l.id
       ${where} ORDER BY ${sortExpr} ${sortDir} LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as (Lead & { exit_score: number | null })[];

    return { leads, total, page, pageSize };
  }

  /** Get a single lead by ID. */
  getById(id: number): Lead | undefined {
    return this.db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Lead | undefined;
  }

  /** Get leads by enrichment status. */
  getByStatus(status: EnrichmentStatus, limit?: number): Lead[] {
    const sql = limit
      ? "SELECT * FROM leads WHERE enrichment_status = ? LIMIT ?"
      : "SELECT * FROM leads WHERE enrichment_status = ?";
    return limit
      ? (this.db.prepare(sql).all(status, limit) as Lead[])
      : (this.db.prepare(sql).all(status) as Lead[]);
  }

  /** Update a lead's enrichment status. */
  updateStatus(id: number, status: EnrichmentStatus): void {
    this.db.prepare(
      "UPDATE leads SET enrichment_status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  }

  /** Bulk update enrichment status. */
  bulkUpdateStatus(ids: number[], status: EnrichmentStatus): void {
    const stmt = this.db.prepare(
      "UPDATE leads SET enrichment_status = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const tx = this.db.transaction(() => {
      for (const id of ids) stmt.run(status, id);
    });
    tx();
  }

  /** Upsert a lead by place_id. Returns true if inserted, false if updated. */
  upsert(lead: Record<string, unknown>): boolean {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM leads WHERE place_id = ?").get(lead.place_id as string) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE leads SET
          business_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
          phone = ?, website = ?, google_rating = ?, review_count = ?,
          business_types = ?, latitude = ?, longitude = ?,
          is_chain = ?, high_review_flag = ?, no_website_flag = ?,
          scraped_at = ?, raw_data = ?, updated_at = ?
        WHERE place_id = ?
      `).run(
        lead.business_name, lead.address ?? null, lead.city ?? null,
        lead.state ?? null, lead.zip_code ?? null, lead.phone ?? null,
        lead.website ?? null, lead.google_rating ?? null, lead.review_count ?? null,
        JSON.stringify(lead.business_types ?? []),
        lead.latitude ?? null, lead.longitude ?? null,
        lead.is_chain ?? 0, lead.high_review_flag ?? 0, lead.no_website_flag ?? 0,
        now, JSON.stringify(lead.raw_data ?? {}), now,
        lead.place_id,
      );
      return false;
    }

    this.db.prepare(`
      INSERT INTO leads (
        place_id, business_name, address, city, state, zip_code,
        phone, website, google_rating, review_count,
        business_types, latitude, longitude, source,
        search_query, search_location,
        is_chain, high_review_flag, no_website_flag,
        scraped_at, enrichment_status, raw_data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lead.place_id, lead.business_name, lead.address ?? null,
      lead.city ?? null, lead.state ?? null, lead.zip_code ?? null,
      lead.phone ?? null, lead.website ?? null, lead.google_rating ?? null,
      lead.review_count ?? null,
      JSON.stringify(lead.business_types ?? []),
      lead.latitude ?? null, lead.longitude ?? null,
      lead.source ?? "google_maps",
      lead.search_query ?? null, lead.search_location ?? null,
      lead.is_chain ?? 0, lead.high_review_flag ?? 0, lead.no_website_flag ?? 0,
      now, "pending", JSON.stringify(lead.raw_data ?? {}), now, now,
    );
    return true;
  }
}
