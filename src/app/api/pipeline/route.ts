import { NextRequest, NextResponse } from "next/server";
import { launchPipelineJob } from "@/lib/run-pipeline-job";
import { COST_AWARE_STAGES } from "@/pipeline/stages";
import { releaseLock, getLockStatus } from "@/lib/pipeline-lock";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { limit = 50, minScore = 5 } = body as { limit?: number; minScore?: number };
    const jobId = launchPipelineJob(COST_AWARE_STAGES, { limit, minScore });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("already running") ? 409 : 500;
    // Include lock details in 409 so the client can show force-unlock option
    if (status === 409) {
      const lock = getLockStatus();
      return NextResponse.json({ error: msg, lock }, { status });
    }
    return NextResponse.json({ error: msg }, { status });
  }
}

/** DELETE /api/pipeline — force-release a stuck pipeline lock */
export async function DELETE() {
  try {
    releaseLock();
    return NextResponse.json({ released: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
