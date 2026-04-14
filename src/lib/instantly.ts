/**
 * Instantly.ai API v2 Client
 *
 * Handles pushing enriched leads into Instantly campaigns for outreach.
 * Uses the v2 REST API with Bearer token auth.
 *
 * Docs: https://developer.instantly.ai/api/v2
 */

const BASE_URL = "https://api.instantly.ai/api/v2";

function getApiKey(): string {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY not set in environment");
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// Re-export shared types from domain layer for backward compatibility.
export type { InstantlyCampaign, InstantlyLead, PushResult } from "@/domain/types";
import type { InstantlyCampaign, InstantlyLead, PushResult } from "@/domain/types";

// ─── Campaign Operations ─────────────────────────────────────────────────────

export async function listCampaigns(limit = 50): Promise<InstantlyCampaign[]> {
  const res = await fetch(`${BASE_URL}/campaigns?limit=${limit}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instantly API error (${res.status}): ${body}`);
  }
  const data = await res.json();
  // API returns { items: [...] } or direct array depending on version
  return data.items || data || [];
}

export async function getCampaign(campaignId: string): Promise<InstantlyCampaign | null> {
  const res = await fetch(`${BASE_URL}/campaigns/${campaignId}`, {
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instantly API error (${res.status}): ${body}`);
  }
  return res.json();
}

// ─── Lead Operations ─────────────────────────────────────────────────────────

/**
 * Push a single lead to an Instantly campaign.
 */
export async function pushLeadToCampaign(
  campaignId: string,
  lead: InstantlyLead,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${BASE_URL}/leads`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      campaign_id: campaignId,
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company_name: lead.company_name,
      phone: lead.phone,
      website: lead.website,
      custom_variables: lead.custom_variables || {},
      skip_if_in_campaign: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { success: false, error: `${res.status}: ${body}` };
  }
  return { success: true };
}

/**
 * Push multiple leads to an Instantly campaign in bulk.
 * Instantly's bulk endpoint accepts up to ~1000 leads at a time.
 */
export async function pushLeadsBulk(
  campaignId: string,
  leads: InstantlyLead[],
): Promise<PushResult> {
  if (leads.length === 0) {
    return { success: true, campaign_id: campaignId, leads_pushed: 0 };
  }

  // Batch in chunks of 500 to avoid API limits
  const CHUNK_SIZE = 500;
  let totalPushed = 0;

  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE);

    const payload = chunk.map((lead) => ({
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company_name: lead.company_name,
      phone: lead.phone,
      website: lead.website,
      custom_variables: lead.custom_variables || {},
    }));

    const res = await fetch(`${BASE_URL}/leads`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        campaign_id: campaignId,
        leads: payload,
        skip_if_in_campaign: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        success: false,
        campaign_id: campaignId,
        leads_pushed: totalPushed,
        error: `Batch ${Math.floor(i / CHUNK_SIZE) + 1} failed (${res.status}): ${body}`,
      };
    }

    totalPushed += chunk.length;

    // Small delay between batches
    if (i + CHUNK_SIZE < leads.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { success: true, campaign_id: campaignId, leads_pushed: totalPushed };
}

// ─── Helper: Convert DB lead to Instantly lead ───────────────────────────────

export function dbLeadToInstantlyLead(
  lead: {
    business_name: string;
    phone?: string | null;
    website?: string | null;
    city?: string | null;
    state?: string | null;
  },
  enrichment: {
    owner_name?: string | null;
    owner_email?: string | null;
    industry_category?: string | null;
    founded_year?: number | null;
    business_age_years?: number | null;
  } | null,
  scoring: {
    score?: number | null;
    recommended_action?: string | null;
    best_angle?: string | null;
  } | null,
  outreach: {
    subject_line?: string | null;
    email_body?: string | null;
  } | null,
): InstantlyLead | null {
  const email = enrichment?.owner_email;
  if (!email) return null;

  const ownerName = enrichment?.owner_name || "";
  const nameParts = ownerName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return {
    email,
    first_name: firstName,
    last_name: lastName,
    company_name: lead.business_name,
    phone: lead.phone || undefined,
    website: lead.website || undefined,
    custom_variables: {
      city: lead.city || "",
      state: lead.state || "",
      industry: enrichment?.industry_category || "",
      founded_year: enrichment?.founded_year || "",
      business_age: enrichment?.business_age_years || "",
      exit_readiness_score: scoring?.score || "",
      recommended_action: scoring?.recommended_action || "",
      best_angle: scoring?.best_angle || "",
      subject_line: outreach?.subject_line || "",
      email_body: outreach?.email_body || "",
    },
  };
}
