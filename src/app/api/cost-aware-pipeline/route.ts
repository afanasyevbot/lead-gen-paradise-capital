import { NextRequest, NextResponse } from "next/server";
import { launchPipelineJob } from "@/lib/run-pipeline-job";
import { COST_AWARE_STAGES } from "@/pipeline/stages";

/**
 * Cost-Aware Pipeline
 *
 * Optimized for minimum cost per lead:
 *   Pre-filter (free) → Scrape (free) → ICP Screen (Haiku) →
 *   Extract (Haiku) → Score (Haiku) → Email Find → Outreach (Sonnet, 7+ only)
 *
 * Target: ~$0.007–0.015/lead vs ~$0.06/lead on full Sonnet pipeline
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { limit = 50, minScore = 7 } = body as { limit?: number; minScore?: number };
    const jobId = launchPipelineJob(COST_AWARE_STAGES, { limit, minScore });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
