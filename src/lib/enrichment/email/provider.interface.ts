import type { EmailProviderName } from "@/domain/types";

export interface EmailLookupInput {
  domain: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  companyName?: string | null;
  /**
   * Optional abort signal. When the waterfall's per-provider timeout fires,
   * this signal is aborted so provider `fetch()` calls can release their
   * sockets immediately instead of waiting for upstream to respond.
   */
  signal?: AbortSignal;
}

export interface EmailLookupResult {
  email: string;
  confidence: number; // 0.0 - 1.0, normalized
  ownerName?: string | null;
  ownerTitle?: string | null;
  rawResponse: Record<string, unknown>;
}

export interface EmailProvider {
  name: EmailProviderName;
  /** Returns true if this provider has valid API credentials configured. */
  isConfigured(): boolean;
  /** Look up email. Returns null if no result found. */
  lookup(input: EmailLookupInput): Promise<EmailLookupResult | null>;
}
