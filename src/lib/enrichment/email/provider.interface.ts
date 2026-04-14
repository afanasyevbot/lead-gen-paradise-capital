import type { EmailProviderName } from "@/domain/types";

export interface EmailLookupInput {
  domain: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  companyName?: string | null;
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
