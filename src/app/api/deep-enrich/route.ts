import { NextRequest, NextResponse } from "next/server";
import { launchPipelineJob } from "@/lib/run-pipeline-job";
import { DEEP_ENRICH_STAGES } from "@/pipeline/stages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { limit = 20 } = body as { limit?: number };
    const jobId = launchPipelineJob(DEEP_ENRICH_STAGES, { limit, minScore: 0 });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
