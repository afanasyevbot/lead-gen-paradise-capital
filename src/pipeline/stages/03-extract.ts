import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { enrichLeads } from "@/lib/enrichment/extract";

export const extractStage: PipelineStage = {
  name: "extract",
  description: "Extracting business data",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await enrichLeads(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      enriched: result.enriched,
      enrich_failed: result.failed,
    };
  },
};
