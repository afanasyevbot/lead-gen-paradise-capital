import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { scoreLeads } from "@/lib/enrichment/score";

export const scoreStage: PipelineStage = {
  name: "score",
  description: "Scoring exit-readiness",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await scoreLeads(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      scored: result.scored,
      score_failed: result.failed,
    };
  },
};
