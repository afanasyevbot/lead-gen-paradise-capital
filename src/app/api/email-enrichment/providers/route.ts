import { NextResponse } from "next/server";

/**
 * GET /api/email-enrichment/providers
 *
 * Returns which email providers and verifiers are configured.
 * No secrets exposed — just name + configured status.
 */
export async function GET() {
  const providers = [
    {
      name: "website",
      type: "finder",
      configured: true,
      description: "Extracts emails found by Claude during website scraping (always available)",
      cost: "Free",
    },
    {
      name: "hunter",
      type: "finder",
      configured: !!process.env.HUNTER_API_KEY,
      description: "Hunter.io — domain search + email finder",
      cost: "25 free/month, then $49/mo for 500",
      envVar: "HUNTER_API_KEY",
    },
    {
      name: "apollo",
      type: "finder",
      configured: !!process.env.APOLLO_API_KEY,
      description: "Apollo.io — people match by name + domain",
      cost: "Free tier available, then $49/mo",
      envVar: "APOLLO_API_KEY",
    },
    {
      name: "snov",
      type: "finder",
      configured: !!(process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET),
      description: "Snov.io — email finder by name + domain",
      cost: "50 free/month, then $39/mo",
      envVars: ["SNOV_CLIENT_ID", "SNOV_CLIENT_SECRET"],
    },
    {
      name: "dropcontact",
      type: "finder",
      configured: !!process.env.DROPCONTACT_API_KEY,
      description: "Dropcontact — async email enrichment",
      cost: "€24/mo for 1000 credits",
      envVar: "DROPCONTACT_API_KEY",
    },
    {
      name: "mx_smtp",
      type: "verifier",
      configured: true,
      description: "Built-in MX record + SMTP handshake verification (always available)",
      cost: "Free",
    },
    {
      name: "zerobounce",
      type: "verifier",
      configured: !!process.env.ZEROBOUNCE_API_KEY,
      description: "ZeroBounce — email validation API",
      cost: "100 free/month, then $16/mo for 2000",
      envVar: "ZEROBOUNCE_API_KEY",
    },
    {
      name: "neverbounce",
      type: "verifier",
      configured: !!process.env.NEVERBOUNCE_API_KEY,
      description: "NeverBounce — email verification",
      cost: "1000 free for new accounts, then pay-as-you-go",
      envVar: "NEVERBOUNCE_API_KEY",
    },
  ];

  const configuredCount = providers.filter((p) => p.configured).length;

  return NextResponse.json({
    providers,
    summary: {
      total: providers.length,
      configured: configuredCount,
      finders: providers.filter((p) => p.type === "finder" && p.configured).length,
      verifiers: providers.filter((p) => p.type === "verifier" && p.configured).length,
    },
  });
}
