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
      result.failedStage = stage.name;
      result.error = String(err);
      throw err; // Re-throw so the job runner can mark the job as failed.
    }
  }

  return result;
}
