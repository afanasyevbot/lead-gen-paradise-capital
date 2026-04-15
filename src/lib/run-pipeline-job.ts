/**
 * Shared helper: creates a job, acquires the pipeline lock, runs the pipeline,
 * releases the lock. Used by all pipeline API routes to prevent concurrent runs.
 */
import { createJob, updateJobProgress, completeJob, failJob } from "@/lib/jobs";
import { acquireLock, releaseLock } from "@/lib/pipeline-lock";
import { runPipeline } from "@/pipeline/orchestrator";
import type { PipelineStage, PipelineContext } from "@/pipeline/stage.interface";

export function launchPipelineJob(
  stages: PipelineStage[],
  ctx: Omit<PipelineContext, "onStageStart" | "onItemProgress">,
  jobType: Parameters<typeof createJob>[0] = "pipeline",
): string {
  const job = createJob(jobType);
  const totalStages = stages.length;

  // Acquire lock synchronously before returning jobId — if locked, throws immediately
  acquireLock(stages.map((s) => s.name).join("→"));

  (async () => {
    try {
      const result = await runPipeline(stages, {
        ...ctx,
        onStageStart: (description, index) => {
          updateJobProgress(job.id, {
            stage: `${index + 1}/${totalStages} — ${description}`,
            current: index,
            total: totalStages,
            currentItem: "",
          });
        },
        onItemProgress: (_current, _total, item) => {
          updateJobProgress(job.id, { currentItem: item });
        },
      });
      completeJob(job.id, result.metrics);
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      console.error(`[PIPELINE] Job ${job.id} failed:`, msg);
      failJob(job.id, e instanceof Error ? e.message : String(e));
    } finally {
      releaseLock();
    }
  })();

  return job.id;
}
