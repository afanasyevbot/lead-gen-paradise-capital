/**
 * Waterfall Email Finder
 *
 * Orchestrates multiple email providers in sequence:
 * 1. Website (free — emails already found by Claude during enrichment)
 * 2. Hunter.io (domain search + name lookup)
 * 3. Apollo.io (people match API)
 * 4. People Data Labs (PDL person search)
 * 5. Snov.io (email finder)
 * 6. Dropcontact (async enrichment)
 *
 * Stops on the first verified-valid email.
 * Skips any provider that isn't configured (no API key).
 * Verifies every candidate before accepting it.
 */

import type {
  EmailCandidate,
  EmailProviderName,
  EmailEnrichmentResult,
} from "@/domain/types";
import type { EmailProvider, EmailLookupInput } from "./provider.interface";
import { WebsiteEmailProvider } from "./providers/website";
import { HunterEmailProvider } from "./providers/hunter";
import { ApolloEmailProvider } from "./providers/apollo";
import { PDLEmailProvider } from "./providers/pdl";
import { SnovEmailProvider } from "./providers/snov";
import { DropcontactEmailProvider } from "./providers/dropcontact";
import { verifyEmail } from "./verification";

/**
 * All available providers in waterfall order.
 * Cheapest/fastest first, most expensive/slowest last.
 */
function createProviders(): EmailProvider[] {
  return [
    new WebsiteEmailProvider(),
    new HunterEmailProvider(),
    new ApolloEmailProvider(),
    new PDLEmailProvider(),
    new SnovEmailProvider(),
    new DropcontactEmailProvider(),
  ];
}

/**
 * Select the best email candidate from a list.
 * Ranks by: verification status weight > confidence score.
 */
function selectBestCandidate(candidates: EmailCandidate[]): EmailCandidate | null {
  if (candidates.length === 0) return null;

  const statusWeight: Record<string, number> = {
    valid: 4,
    catch_all: 3,
    unknown: 2,
    risky: 1,
    unverified: 0,
    invalid: -1,
  };

  return candidates
    .filter((c) => c.verificationStatus !== "invalid")
    .sort((a, b) => {
      const wA = statusWeight[a.verificationStatus] ?? 0;
      const wB = statusWeight[b.verificationStatus] ?? 0;
      if (wB !== wA) return wB - wA;
      return b.confidenceScore - a.confidenceScore;
    })[0] || null;
}

export class WaterfallEmailFinder {
  private providers: EmailProvider[];

  constructor() {
    this.providers = createProviders().filter((p) => p.isConfigured());
  }

  /** Number of configured providers. */
  get providerCount(): number {
    return this.providers.length;
  }

  /** Names of configured providers. */
  get configuredProviders(): EmailProviderName[] {
    return this.providers.map((p) => p.name);
  }

  /**
   * Find an email for a lead using the waterfall approach.
   * Tries each configured provider in order, verifies each result,
   * and stops on the first verified-valid email.
   */
  async findEmail(input: EmailLookupInput): Promise<EmailEnrichmentResult> {
    const startTime = Date.now();
    const candidates: EmailCandidate[] = [];
    const providersAttempted: EmailProviderName[] = [];
    const providersHit: EmailProviderName[] = [];
    const seenEmails = new Set<string>();

    // Hard per-provider timeout. Prevents a single slow/hanging provider
    // (exhausted quota, rate-limit backoff, DNS failure) from eating 10–30s.
    const PROVIDER_TIMEOUT_MS = 5000;
    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
      });

    for (const provider of this.providers) {
      providersAttempted.push(provider.name);

      try {
        // Website provider is local DB read — give it more headroom so the
        // harvester's stored-content fallback can finish even on large text.
        const timeout = provider.name === "website" ? 15000 : PROVIDER_TIMEOUT_MS;
        const result = await withTimeout(provider.lookup(input), timeout, provider.name);

        if (result && !seenEmails.has(result.email.toLowerCase())) {
          seenEmails.add(result.email.toLowerCase());
          providersHit.push(provider.name);

          // Verify the email — guard against null/undefined from failed verification
          let verification: Awaited<ReturnType<typeof verifyEmail>> | null = null;
          try {
            verification = await verifyEmail(result.email);
          } catch (verifyErr) {
            console.warn(`[EmailWaterfall] verification failed for ${result.email}:`, verifyErr);
          }

          const candidate: EmailCandidate = {
            email: result.email,
            provider: provider.name,
            confidenceScore: result.confidence,
            verificationStatus: verification?.status ?? "unverified",
            verificationMethod: verification?.method,
            ownerName: result.ownerName,
            ownerTitle: result.ownerTitle,
            rawResponse: result.rawResponse,
          };

          candidates.push(candidate);

          // Stop on first verified-valid email
          if (verification?.status === "valid") {
            break;
          }

          // Early-exit for a high-confidence own-domain personal email from the
          // free website harvester. Verification for Google Workspace domains
          // often returns "unknown" or "catch_all", which would otherwise drag
          // us through every paid provider — expensive and slow when quotas
          // are exhausted (each failing provider adds 3–5s of network latency).
          if (
            provider.name === "website" &&
            result.confidence >= 0.8 &&
            verification?.status !== "invalid"
          ) {
            break;
          }
        }
      } catch (err) {
        console.warn(`[EmailWaterfall] ${provider.name} failed:`, err);
        // Continue to next provider
      }
    }

    const best = selectBestCandidate(candidates);

    return {
      candidates,
      bestEmail: best?.email ?? null,
      bestProvider: best?.provider ?? null,
      bestVerificationStatus: best?.verificationStatus ?? "unverified",
      providersAttempted,
      providersHit,
      durationMs: Date.now() - startTime,
    };
  }
}
