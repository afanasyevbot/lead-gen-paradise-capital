/**
 * Pipeline Stage Interface
 *
 * Every pipeline stage implements this interface. Stages are composable —
 * the orchestrator runs them in sequence, and different API routes can
 * compose different stage sets (core 6, full 14, enrich-only 3, etc.).
 */

import type { ProgressCallback } from "@/domain/types";

// ─── Stage Result ───────────────────────────────────────────────────────────

/** Each stage returns a flat object of metric counts. */
export type StageResult = Record<string, number>;

// ─── Pipeline Context ───────────────────────────────────────────────────────

/** Shared context passed to every stage during a pipeline run. */
export interface PipelineContext {
  /** Max leads to process per stage. */
  limit: number;
  /** Min score threshold for outreach generation. */
  minScore: number;
  /** Called when a stage begins — for job progress tracking. */
  onStageStart: (stageName: string, stageIndex: number, totalStages: number) => void;
  /** Called per-item within a stage — for job progress tracking. */
  onItemProgress: ProgressCallback;
}

// ─── Pipeline Stage ─────────────────────────────────────────────────────────

export interface PipelineStage {
  /** Unique identifier (e.g., "scrape", "linkedin", "extract"). */
  name: string;
  /** Human-readable description for job progress UI (e.g., "Scraping websites"). */
  description: string;
  /** Execute the stage, returning metric counts. */
  execute(ctx: PipelineContext): Promise<StageResult>;
}

// ─── Pipeline Result ────────────────────────────────────────────────────────

export interface PipelineResult {
  /** Aggregated metrics from all stages. */
  metrics: Record<string, number>;
  /** Number of stages that completed successfully. */
  stagesCompleted: number;
  /** Total stages attempted. */
  stagesTotal: number;
  /** Stage that failed, if any. */
  failedStage?: string;
  /** Error message from failed stage. */
  error?: string;
}
