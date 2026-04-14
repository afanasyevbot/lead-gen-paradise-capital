import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "@/pipeline/orchestrator";
import type { PipelineStage, PipelineContext } from "@/pipeline/stage.interface";
import {
  CORE_STAGES,
  ENRICH_ONLY_STAGES,
  DEEP_ENRICH_STAGES,
  FOUNDER_ANALYSIS_STAGES,
  FULL_PIPELINE_STAGES,
} from "@/pipeline/stages";

// ─── Helper: create a mock stage ────────────────────────────────────────────

function mockStage(name: string, result: Record<string, number>): PipelineStage {
  return {
    name,
    description: `Mock ${name}`,
    execute: vi.fn().mockResolvedValue(result),
  };
}

function mockCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    limit: 10,
    minScore: 5,
    onStageStart: vi.fn(),
    onItemProgress: vi.fn(),
    ...overrides,
  };
}

// ─── Orchestrator Tests ─────────────────────────────────────────────────────

describe("runPipeline", () => {
  it("runs stages in order and aggregates metrics", async () => {
    const stage1 = mockStage("scrape", { scraped: 5, failed: 1 });
    const stage2 = mockStage("extract", { enriched: 4 });
    const stage3 = mockStage("score", { scored: 3 });

    const ctx = mockCtx();
    const result = await runPipeline([stage1, stage2, stage3], ctx);

    expect(result.stagesCompleted).toBe(3);
    expect(result.stagesTotal).toBe(3);
    expect(result.metrics).toEqual({ scraped: 5, failed: 1, enriched: 4, scored: 3 });
    expect(result.failedStage).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("calls onStageStart for each stage with correct indices", async () => {
    const stages = [
      mockStage("a", { a: 1 }),
      mockStage("b", { b: 2 }),
    ];
    const ctx = mockCtx();

    await runPipeline(stages, ctx);

    expect(ctx.onStageStart).toHaveBeenCalledTimes(2);
    expect(ctx.onStageStart).toHaveBeenNthCalledWith(1, "Mock a", 0, 2);
    expect(ctx.onStageStart).toHaveBeenNthCalledWith(2, "Mock b", 1, 2);
  });

  it("stops on first failure and re-throws", async () => {
    const stage1 = mockStage("ok", { ok: 1 });
    const stage2: PipelineStage = {
      name: "boom",
      description: "Mock boom",
      execute: vi.fn().mockRejectedValue(new Error("stage2 exploded")),
    };
    const stage3 = mockStage("never", { never: 1 });

    const ctx = mockCtx();

    await expect(runPipeline([stage1, stage2, stage3], ctx)).rejects.toThrow("stage2 exploded");

    // stage1 ran, stage2 failed, stage3 never ran
    expect(stage1.execute).toHaveBeenCalledTimes(1);
    expect(stage2.execute).toHaveBeenCalledTimes(1);
    expect(stage3.execute).toHaveBeenCalledTimes(0);
  });

  it("returns empty metrics for empty stage array", async () => {
    const ctx = mockCtx();
    const result = await runPipeline([], ctx);

    expect(result.stagesCompleted).toBe(0);
    expect(result.stagesTotal).toBe(0);
    expect(result.metrics).toEqual({});
  });

  it("passes context to each stage execute", async () => {
    const stage = mockStage("test", { done: 1 });
    const ctx = mockCtx({ limit: 42, minScore: 7 });

    await runPipeline([stage], ctx);

    expect(stage.execute).toHaveBeenCalledWith(ctx);
  });

  it("later stage metrics overwrite earlier ones with same key", async () => {
    // Edge case: two stages return the same metric key
    const stage1 = mockStage("a", { count: 5 });
    const stage2 = mockStage("b", { count: 10 });

    const result = await runPipeline([stage1, stage2], mockCtx());

    // Object.assign overwrites — last write wins
    expect(result.metrics.count).toBe(10);
  });
});

// ─── Stage Preset Tests ─────────────────────────────────────────────────────

describe("stage presets", () => {
  it("CORE_STAGES has 6 stages", () => {
    expect(CORE_STAGES).toHaveLength(6);
    expect(CORE_STAGES.map(s => s.name)).toEqual([
      "scrape", "linkedin", "extract", "email-finder", "score", "outreach",
    ]);
  });

  it("ENRICH_ONLY_STAGES has 4 stages (skips scrape + linkedin)", () => {
    expect(ENRICH_ONLY_STAGES).toHaveLength(4);
    expect(ENRICH_ONLY_STAGES.map(s => s.name)).toEqual([
      "extract", "email-finder", "score", "outreach",
    ]);
  });

  it("DEEP_ENRICH_STAGES has 4 stages", () => {
    expect(DEEP_ENRICH_STAGES).toHaveLength(4);
    expect(DEEP_ENRICH_STAGES.map(s => s.name)).toEqual([
      "social-signals", "content-hooks", "social-intros", "hook-extractor",
    ]);
  });

  it("FOUNDER_ANALYSIS_STAGES has 3 stages", () => {
    expect(FOUNDER_ANALYSIS_STAGES).toHaveLength(3);
    expect(FOUNDER_ANALYSIS_STAGES.map(s => s.name)).toEqual([
      "founder-signals", "succession-news", "legacy-outreach",
    ]);
  });

  it("FULL_PIPELINE_STAGES has 15 stages", () => {
    expect(FULL_PIPELINE_STAGES).toHaveLength(15);
    // Verify it's core + deep + founder + premium in order
    const names = FULL_PIPELINE_STAGES.map(s => s.name);
    expect(names[0]).toBe("scrape");
    expect(names[5]).toBe("outreach");
    expect(names[6]).toBe("social-signals");
    expect(names[10]).toBe("founder-signals");
    expect(names[13]).toBe("succession-audit");
    expect(names[14]).toBe("tenure-legacy-email");
  });

  it("all stages have unique names", () => {
    const names = FULL_PIPELINE_STAGES.map(s => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all stages have non-empty descriptions", () => {
    for (const stage of FULL_PIPELINE_STAGES) {
      expect(stage.description.length).toBeGreaterThan(0);
    }
  });

  it("all stages have an execute function", () => {
    for (const stage of FULL_PIPELINE_STAGES) {
      expect(typeof stage.execute).toBe("function");
    }
  });
});
