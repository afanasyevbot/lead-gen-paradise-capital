import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/instantly";

/**
 * GET /api/instantly/campaigns
 * List all Instantly campaigns for the dropdown selector.
 */
export async function GET() {
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("INSTANTLY_API_KEY not set")) {
      return NextResponse.json(
        { error: "Instantly API key not configured. Add INSTANTLY_API_KEY to .env.local" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
