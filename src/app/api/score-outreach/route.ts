import { NextRequest, NextResponse } from "next/server";
import { launchPipelineJob } from "@/lib/run-pipeline-job";
import { SCORE_OUTREACH_STAGES } from "@/pipeline/stages";

/**
 * POST /api/score-outreach
 *
 * Runs Score → Email Finder → Outreach on leads that already have enrichment data.
 * Designed for CSV-uploaded leads (e.g. Apollo exports) where owner/company info
 * is already known — skips scraping and extraction entirely.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { limit = 100, minScore = 5 } = body as { limit?: number; minScore?: number };
    const jobId = launchPipelineJob(SCORE_OUTREACH_STAGES, { limit, minScore });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
