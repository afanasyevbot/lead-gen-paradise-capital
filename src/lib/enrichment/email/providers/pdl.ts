/**
 * People Data Labs (PDL) Email Provider
 *
 * Uses the PDL Person Search API to find business emails by company + title.
 * https://docs.peopledatalabs.com/docs/person-search-api
 *
 * Requires PDL_API_KEY environment variable.
 */

import type { EmailProvider, EmailLookupInput, EmailLookupResult } from "../provider.interface";
import type { EmailProviderName } from "@/domain/types";

interface PDLPerson {
  work_email?: string | null;
  personal_emails?: string[];
  full_name?: string | null;
  job_title?: string | null;
  likelihood?: number | null;
}

interface PDLSearchResponse {
  status: number;
  data?: PDLPerson[];
  total?: number;
  error?: { message?: string };
}

export class PDLEmailProvider implements EmailProvider {
  name: EmailProviderName = "pdl";

  isConfigured(): boolean {
    return !!(process.env.PDL_API_KEY || loadPDLKey());
  }

  async lookup(input: EmailLookupInput): Promise<EmailLookupResult | null> {
    const apiKey = process.env.PDL_API_KEY || loadPDLKey();
    if (!apiKey) return null;

    const companyName = input.companyName || input.domain;
    if (!companyName) return null;

    // Build SQL query: search by company name and founder/owner-type titles
    const titleKeywords = ["owner", "founder", "president", "ceo", "chief executive"];
    const titleConditions = titleKeywords
      .map((t) => `job_title LIKE '%${t}%'`)
      .join(" OR ");

    const sqlQuery = `SELECT * FROM person WHERE job_company_name LIKE '%${companyName.replace(/'/g, "''")}%' AND (${titleConditions}) LIMIT 5`;

    const res = await fetch("https://api.peopledatalabs.com/v5/person/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        sql: sqlQuery,
        size: 5,
      }),
    });

    // 402 = credits exhausted; 404 = not found — both are graceful no-ops
    if (res.status === 404 || res.status === 402) return null;

    if (!res.ok) return null;

    const data: PDLSearchResponse = await res.json();

    if (!data.data || data.data.length === 0) return null;

    // Pick the best match: prefer records with work_email and highest likelihood
    const candidates = data.data.filter(
      (p) => p.work_email || (p.personal_emails && p.personal_emails.length > 0)
    );

    if (candidates.length === 0) return null;

    // Sort by likelihood descending, preferring those with work_email
    const best = candidates.sort((a, b) => {
      const aHasWork = a.work_email ? 1 : 0;
      const bHasWork = b.work_email ? 1 : 0;
      if (bHasWork !== aHasWork) return bHasWork - aHasWork;
      return (b.likelihood ?? 0) - (a.likelihood ?? 0);
    })[0];

    const email = best.work_email || best.personal_emails?.[0];
    if (!email) return null;

    // PDL likelihood is 0–10; normalise to 0.0–1.0
    const rawLikelihood = best.likelihood ?? 5;
    const confidence = Math.min(1, rawLikelihood / 10);

    return {
      email,
      confidence,
      ownerName: best.full_name || input.fullName || null,
      ownerTitle: best.job_title || input.title || null,
      rawResponse: {
        likelihood: best.likelihood,
        has_work_email: !!best.work_email,
        total_results: data.total ?? data.data.length,
      },
    };
  }
}

function loadPDLKey(): string | null {
  try {
    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^PDL_API_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim();
      process.env.PDL_API_KEY = key;
      return key;
    }
  } catch { /* no key */ }
  return null;
}
