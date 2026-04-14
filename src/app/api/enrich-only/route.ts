import { NextRequest, NextResponse } from "next/server";
import { launchPipelineJob } from "@/lib/run-pipeline-job";
import { icpScreenStage, ENRICH_ONLY_STAGES } from "@/pipeline/stages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { limit = 20, minScore = 5 } = body as { limit?: number; minScore?: number };
    const jobId = launchPipelineJob([icpScreenStage, ...ENRICH_ONLY_STAGES], { limit, minScore });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
