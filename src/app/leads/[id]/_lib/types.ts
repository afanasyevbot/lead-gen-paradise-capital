export interface LeadDetail {
  id: number;
  business_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  website: string;
  google_rating: number;
  review_count: number;
  business_types: string;
  enrichment_status: string;
  is_chain: number;
  search_query: string;
  search_location: string;
  scraped: { all_text: string; pages_scraped: number } | null;
  enrichment: Record<string, unknown> | null;
  scoring: {
    score: number;
    confidence: string;
    primary_signals: string[];
    risk_factors: string[];
    recommended_action: string;
    reasoning: string;
    best_angle: string;
    requires_manual_review?: boolean;
    review_reason?: string | null;
  } | null;
  scoringMeta: { score: number; confidence: string; recommended_action: string } | null;
  linkedin: {
    linkedin_url: string | null;
    owner_name: string | null;
    owner_title: string | null;
    headline: string | null;
  } | null;
  outreach: {
    subject_line: string;
    email_body: string;
    personalization_notes: string;
    alternative_subject: string;
    follow_up_angle: string;
    requires_review?: boolean;
    stale_data_warning?: string | null;
    fact_check?: {
      all_claims_verified: boolean;
      unverified_claims: string[];
      risk_level: string;
    } | null;
    tier_used?: string;
    format_style_used?: string;
  } | null;
  followups: {
    follow_up_1: { subject_line: string; email_body: string; days_after_previous: number };
    follow_up_2: { subject_line: string; email_body: string; days_after_previous: number };
  } | null;
  socialIntro: {
    intro_text: string;
    source_used: string;
    specific_reference: string;
    confidence: string;
    notes_for_paul: string;
  } | null;
  socialSignals: {
    linkedin_about: string | null;
    twitter_posts: string | null;
    press_releases: string | null;
  } | null;
  founderProfile: {
    is_primary_founder: number;
    estimated_current_age: number | null;
    career_stage: string | null;
    exit_readiness_boost: number;
    is_age_55_plus: number;
    profile_json: string | null;
  } | null;
  contentHooks: {
    best_subject: string | null;
    hooks_json: string | null;
  } | null;
  successionNews: {
    owner_signals: string | null;
    industry_signals: string | null;
    total_signals: number;
    strongest_signal: string | null;
  } | null;
  legacyOutreach: {
    outreach_json: string | null;
    legacy_angle: string | null;
  } | null;
  successionAudit: {
    audit_json: string | null;
    overall_readiness_score: number | null;
    recommended_tier: string | null;
  } | null;
  tenureLegacyEmail: {
    email_json: string | null;
    tier: string | null;
  } | null;
  costs: {
    total_usd: number;
    by_stage: Record<string, number>;
    rows: Array<{ stage: string; provider: string; input_tokens: number | null; output_tokens: number | null; cost_usd: number; created_at: string }>;
  } | null;
}
