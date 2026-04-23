import { getDb } from "@/lib/db";

// ─── Model pricing (USD per token) ───────────────────────────────────────────
// https://www.anthropic.com/pricing

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Sonnet 4.6 / 4 / 3.7 / 3.5
  "claude-sonnet-4-6":           { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  "claude-sonnet-4-20250514":    { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  "claude-sonnet-4":             { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  "claude-3-7-sonnet-20250219":  { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  "claude-3-5-sonnet-20241022":  { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  // Haiku 4.5 / 3.5 / 3
  "claude-haiku-4-5":            { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  "claude-haiku-4-5-20251001":   { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  "claude-3-5-haiku-20241022":   { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  "claude-3-haiku-20240307":     { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  // Opus
  "claude-opus-4-6":             { input: 15 / 1_000_000,  output: 75 / 1_000_000 },
};

// Estimated cost per email provider lookup (USD)
export const EMAIL_PROVIDER_COST: Record<string, number> = {
  website:     0,      // free — extracted from scraped content
  hunter:      0.016,  // ~$34/mo / 2000 searches
  apollo:      0.020,  // varies by plan
  snov:        0.010,
  dropcontact: 0.020,
  neverbounce: 0.003,  // verification only
  zerobounce:  0.002,
};

// ─── Schema init ─────────────────────────────────────────────────────────────

export function ensureLeadCostsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      stage TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_id ON lead_costs(lead_id);
  `);
}

// ─── Track ────────────────────────────────────────────────────────────────────

export function trackClaudeCost(
  leadId: number,
  stage: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  try {
    ensureLeadCostsTable();
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-haiku-4-5"];
    const costUsd = inputTokens * pricing.input + outputTokens * pricing.output;
    getDb()
      .prepare(
        `INSERT INTO lead_costs (lead_id, stage, provider, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(leadId, stage, model, inputTokens, outputTokens, costUsd);
  } catch {
    // Never crash the pipeline over cost tracking
  }
}

export function trackProviderCost(
  leadId: number,
  stage: string,
  provider: string,
): void {
  try {
    ensureLeadCostsTable();
    const costUsd = EMAIL_PROVIDER_COST[provider] ?? 0.01;
    getDb()
      .prepare(
        `INSERT INTO lead_costs (lead_id, stage, provider, cost_usd)
         VALUES (?, ?, ?, ?)`
      )
      .run(leadId, stage, provider, costUsd);
  } catch {
    // Never crash the pipeline over cost tracking
  }
}

// ─── Query ────────────────────────────────────────────────────────────────────

export interface LeadCostSummary {
  total_usd: number;
  by_stage: Record<string, number>;
  rows: Array<{
    stage: string;
    provider: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number;
    created_at: string;
  }>;
}

export function getLeadCosts(leadId: number): LeadCostSummary {
  try {
    ensureLeadCostsTable();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT stage, provider, input_tokens, output_tokens, cost_usd, created_at
         FROM lead_costs WHERE lead_id = ? ORDER BY created_at ASC`
      )
      .all(leadId) as LeadCostSummary["rows"];

    const by_stage: Record<string, number> = {};
    let total_usd = 0;
    for (const r of rows) {
      by_stage[r.stage] = (by_stage[r.stage] ?? 0) + r.cost_usd;
      total_usd += r.cost_usd;
    }

    return { total_usd, by_stage, rows };
  } catch {
    return { total_usd: 0, by_stage: {}, rows: [] };
  }
}

export function getTotalCostAllLeads(): { total_usd: number; lead_count: number } {
  try {
    ensureLeadCostsTable();
    const db = getDb();
    const row = db
      .prepare(`SELECT SUM(cost_usd) as total, COUNT(DISTINCT lead_id) as leads FROM lead_costs`)
      .get() as { total: number | null; leads: number };
    return { total_usd: row.total ?? 0, lead_count: row.leads };
  } catch {
    return { total_usd: 0, lead_count: 0 };
  }
}
