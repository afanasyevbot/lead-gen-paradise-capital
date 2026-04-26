export interface Job {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { current: number; total: number; stage: string; currentItem: string };
  result?: Record<string, number>;
  error?: string;
  startedAt?: string;
}

export interface PipelineSummary {
  pipeline: { total: number; pending: number; scraped: number; enriched: number; scored: number; outreach_generated: number; filtered_out: number; failed: number };
  highlights: { high_score_leads: number; emails_found: number; ready_to_push: number };
  score_distribution: { legacy_tier: number; high_tier: number; seed_tier: number; below_threshold: number };
  this_run_scores: { score_8_plus: number; score_7: number; score_5_6: number; score_below_5: number; total_scored: number; filtered_out: number } | null;
  cost: { total_usd: number; by_stage: Record<string, number>; leads_billed: number };
}

export interface ScoredLead {
  id: number;
  business_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  score: number;
  confidence: string;
  recommended_action: string;
  avatar_fit?: string;
  reasoning?: string;
  primary_signals?: string[];
  risk_factors?: string[];
  owner_name?: string;
  estimated_owner_age?: string;
  estimated_revenue_range?: string;
  is_likely_founder?: boolean;
  has_website?: boolean;
  has_scraped?: boolean;
  has_linkedin?: boolean;
  has_email?: boolean;
  has_outreach?: boolean;
  data_completeness?: number;
}

export type PipelineMode = "core" | "enrich-only";

export interface PipelineStage {
  key: string;
  label: string;
  desc: string;
}
