import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { analyzeFounderSignals } from "@/lib/enrichment/founder-signals";

export const founderSignalsStage: PipelineStage = {
  name: "founder-signals",
  description: "Analyzing founder signals",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await analyzeFounderSignals(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      founders_analyzed: result.analyzed,
    };
  },
};
