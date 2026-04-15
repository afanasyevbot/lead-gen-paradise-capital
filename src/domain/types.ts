// ─── Enrichment Status ──────────────────────────────────────────────────────

export type EnrichmentStatus =
  | "pending"
  | "scraped"
  | "enriched"
  | "scored"
  | "outreach_generated"
  | "scrape_failed"
  | "enrich_failed"
  | "score_failed"
  | "outreach_failed"  // Claude failed during outreach generation — distinguishable from "not yet attempted"
  | "pre_filtered"     // eliminated by rule-based pre-filter (chain, micro-biz, etc.)
  | "icp_rejected"     // eliminated by Haiku ICP screen (wrong industry/size)
  | "icp_parse_error"  // ICP screen response unparseable — needs manual review
  | "icp_screen_error" // ICP screen API call failed — retryable
  | "no_website";      // lead has no website — cannot be scraped or enriched

// ─── Recommended Actions ────────────────────────────────────────────────────

export type RecommendedAction =
  | "reach_out_now"
  | "reach_out_warm"
  | "offer_booklet"
  | "monitor"
  | "skip";

export type Confidence = "high" | "medium" | "low";

export type OutreachTier = "legacy" | "seed_planter" | "awareness";

export type FormatStyle = "standard" | "ultra_short" | "question_only" | "story_lead" | "book_excerpt";

export type AvatarFit = "perfect" | "strong" | "possible" | "weak" | "skip";

export type EmotionalReadinessStage = "unaware" | "curious" | "considering" | "ready";

export type FactCheckRiskLevel = "safe" | "review" | "rewrite";

// ─── Lead Entity ────────────────────────────────────────────────────────────

export interface Lead {
  id: number;
  place_id: string;
  business_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  review_count: number | null;
  business_types: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string;
  search_query: string | null;
  search_location: string | null;
  is_chain: number;
  high_review_flag: number;
  no_website_flag: number;
  scraped_at: string;
  enrichment_status: string;
  raw_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  status?: string;
  minRating?: number;
  hasWebsite?: boolean;
  excludeChains?: boolean;
  search?: string;
  scoreTier?: "high" | "medium" | "low" | "unscored";
  hasEmail?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

// ─── Scraped Content ────────────────────────────────────────────────────────

export interface ScrapedContent {
  lead_id: number;
  homepage_text: string | null;
  about_text: string | null;
  all_text: string | null;
  pages_scraped: number;
  scraped_at: string;
}

// ─── LinkedIn Data ──────────────────────────────────────────────────────────

export interface LinkedInResult {
  linkedin_url: string | null;
  owner_name_from_linkedin: string | null;
  owner_title_from_linkedin: string | null;
  linkedin_headline: string | null;
  error: string | null;
  rate_limited?: boolean;
}

export interface LinkedInData {
  lead_id: number;
  linkedin_url: string | null;
  owner_name_from_linkedin: string | null;
  owner_title_from_linkedin: string | null;
  linkedin_headline: string | null;
  rate_limited: number;
  data_quality: string;
  created_at: string;
}

// ─── Enrichment Data ────────────────────────────────────────────────────────

export interface EnrichmentData {
  business_name?: string;
  owner_name?: string | null;
  owner_title?: string | null;
  is_likely_founder?: boolean;
  founder_evidence?: string | null;
  founded_year?: number | null;
  business_age_years?: number | null;
  estimated_owner_age_range?: string | null;
  owner_age_confidence?: string | null;
  owner_tenure_years?: number | null;
  location_city?: string | null;
  location_state?: string | null;
  industry_category?: string;
  services_offered?: string[];
  employee_signals?: string | null;
  revenue_signals?: string | null;
  estimated_revenue_range?: string | null;
  succession_signals?: string | null;
  no_succession_red_flags?: string | null;
  growth_signals?: string | null;
  stagnation_signals?: string | null;
  owner_personal_details?: string | null;
  faith_signals?: string | null;
  age_estimation_clues?: string[];
  owner_email?: string | null;
  company_email?: string | null;
  certifications_awards?: string[];
  unique_hooks?: string[];
  [key: string]: unknown;
}

// ─── Scoring Data ───────────────────────────────────────────────────────────

export interface ScoringData {
  score?: number;
  confidence?: string;
  is_likely_founder?: boolean;
  founder_evidence_summary?: string;
  estimated_owner_age?: string | null;
  estimated_revenue_range?: string | null;
  avatar_fit?: AvatarFit;
  faith_signals_found?: boolean;
  primary_signals?: string[];
  risk_factors?: string[];
  recommended_action?: string;
  reasoning?: string;
  best_angle?: string;
  no_regrets_fit?: string;
  emotional_readiness_stage?: EmotionalReadinessStage;
  why_what_wont_when_notes?: string;
  requires_manual_review?: boolean;
  review_reason?: string | null;
  [key: string]: unknown;
}

// ─── Outreach Data ──────────────────────────────────────────────────────────

export interface OutreachData {
  subject_line: string;
  email_body: string;
  alternative_subject?: string;
  tier_used: string;
  emotional_readiness_angle?: string;
  why_what_wont_when_seeds?: string;
  personalization_notes?: string;
  book_reference_used?: boolean;
  follow_up_angle?: string;
  no_regrets_element?: string;
  stale_data_warning?: string | null;
  format_style_used?: string;
  fact_check?: FactCheckResult | null;
  requires_review?: boolean;
}

export interface FollowupEmail {
  subject_line: string;
  email_body: string;
  days_after_previous: number;
  value_add_type?: string;
}

export interface FollowupData {
  follow_up_1: FollowupEmail;
  follow_up_2: FollowupEmail;
}

// ─── Fact Check ─────────────────────────────────────────────────────────────

export interface FactCheckClaim {
  claim: string;
  found_in_source: boolean;
  source_text: string | null;
}

export interface FactCheckResult {
  all_claims_verified: boolean;
  claims: FactCheckClaim[];
  unverified_claims: string[];
  risk_level: FactCheckRiskLevel;
}

// ─── Suppression ────────────────────────────────────────────────────────────

export interface SuppressionEntry {
  email: string;
  reason: string;
  source: string;
  created_at: string;
  updated_at?: string;
}

// ─── Outreach Outcomes ──────────────────────────────────────────────────────

export type OutcomeType =
  | "replied"
  | "meeting_booked"
  | "not_interested"
  | "unsubscribed"
  | "bounced"
  | "no_response"
  | "wrong_person";

export interface OutreachOutcome {
  lead_id: number;
  outreach_data_id?: number;
  outcome: OutcomeType;
  tier_used?: string;
  score_at_send?: number;
  notes?: string;
  outcome_date?: string;
  created_at: string;
}

// ─── Instantly.ai ───────────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string;
  name: string;
  status: number;
  timestamp_created?: string;
}

export interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string | number | boolean | null>;
}

export interface PushResult {
  success: boolean;
  campaign_id: string;
  leads_pushed: number;
  error?: string;
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export type JobType = "scrape" | "pipeline" | "xray";
export type JobStatus = "running" | "completed" | "failed";

export interface JobProgress {
  current: number;
  total: number;
  stage: string;
  currentItem: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  result?: Record<string, number>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export type ProgressCallback = (current: number, total: number, item: string) => void;

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BatchValidationResult {
  totalChecked: number;
  passed: number;
  failed: number;
  withWarnings: number;
  failures: { id: unknown; errors: string[] }[];
}

// ─── Email Enrichment ────────────────────────────────────────────────────────

export type EmailVerificationStatus =
  | "unverified"
  | "valid"
  | "invalid"
  | "risky"
  | "catch_all"
  | "unknown";

export type EmailProviderName =
  | "website"
  | "apollo"
  | "hunter"
  | "snov"
  | "dropcontact"
  | "pdl";

export type EmailVerificationMethod =
  | "mx_smtp"
  | "zerobounce"
  | "neverbounce";

export interface EmailCandidate {
  email: string;
  provider: EmailProviderName;
  confidenceScore: number; // 0.0 - 1.0
  verificationStatus: EmailVerificationStatus;
  verificationMethod?: EmailVerificationMethod;
  ownerName?: string | null;
  ownerTitle?: string | null;
  rawResponse?: Record<string, unknown>;
}

export interface EmailEnrichmentResult {
  candidates: EmailCandidate[];
  bestEmail: string | null;
  bestProvider: EmailProviderName | null;
  bestVerificationStatus: EmailVerificationStatus;
  providersAttempted: EmailProviderName[];
  providersHit: EmailProviderName[];
  durationMs: number;
}

// ─── Lead Detail (full enrichment bundle returned by getLeadDetail) ─────────

export interface LeadLinkedIn {
  linkedin_url: string | null;
  owner_name: string | null;
  owner_title: string | null;
  headline: string | null;
}

export interface ScoringMeta {
  score: number;
  confidence: string;
  recommended_action: string;
}

export interface SocialIntro {
  intro_text: string;
  source_used: string;
  specific_reference: string;
  confidence: string;
  notes_for_paul: string;
}

export interface SocialSignals {
  linkedin_about: string | null;
  twitter_posts: string[] | null;
  press_releases: string[] | null;
}

export interface SuccessionNews {
  owner_signals: unknown[];
  industry_signals: unknown[];
  total_signals: number;
  strongest_signal: string | null;
}

export interface LeadDetail extends Lead {
  scraped: { all_text: string; pages_scraped: number } | null;
  enrichment: EnrichmentData | null;
  scoring: ScoringData | null;
  scoringMeta: ScoringMeta | null;
  outreach: OutreachData | null;
  followups: FollowupData | null;
  linkedin: LeadLinkedIn | null;
  socialIntro: SocialIntro | null;
  contentHooks: unknown | null;
  socialSignals: SocialSignals | null;
  founderProfile: unknown | null;
  successionNews: SuccessionNews | null;
  legacyOutreach: unknown | null;
  successionAudit: unknown | null;
  tenureLegacyEmail: unknown | null;
  emailCandidates: EmailCandidate[] | null;
  primaryEmail: EmailCandidate | null;
}
