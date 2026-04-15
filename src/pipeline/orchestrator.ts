/**
 * Pipeline Orchestrator
 *
 * Runs an ordered sequence of PipelineStages, tracks progress,
 * and aggregates results. Replaces the inline orchestration that
 * previously lived in /api/pipeline/route.ts and /api/full-pipeline/route.ts.
 */

import type { PipelineStage, PipelineContext, PipelineResult } from "./stage.interface";

/**
 * Run a sequence of pipeline stages.
 *
 * @param stages - Ordered array of stages to execute.
 * @param ctx    - Shared context (limit, minScore, progress callbacks).
 * @returns Aggregated result with metrics from all stages.
 */
export async function runPipeline(
  stages: PipelineStage[],
  ctx: PipelineContext,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    metrics: {},
    stagesCompleted: 0,
    stagesTotal: stages.length,
  };

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];

    ctx.onStageStart(stage.description, i, stages.length);

    try {
      const stageResult = await stage.execute(ctx);

      // Merge stage metrics into the aggregated result.
      // Prefix-free — stage implementations already namespace their keys
      // (e.g., "websites_scraped", "linkedin_found").
      Object.assign(result.metrics, stageResult);
      result.stagesCompleted++;
    } catch (err) {
      // Record the failure but DON'T halt the whole pipeline. One bad stage
      // (e.g. LinkedIn rate-limited) shouldn't block scoring / outreach for
      // leads that already have enough data to proceed. Downstream stages
      // filter by enrichment_status so they'll naturally skip leads that
      // haven't reached the prerequisite step yet.
      console.error(`[PIPELINE] Stage "${stage.name}" failed:`, err);
      // metrics is Record<string, number>, so store the failure as a 1-count
      // flag; the human-readable message lives on result.error / failedStage.
      result.metrics[`${stage.name}_error`] = 1;
      if (!result.failedStage) result.failedStage = stage.name;
      result.error = String(err);
    }
  }

  return result;
}
