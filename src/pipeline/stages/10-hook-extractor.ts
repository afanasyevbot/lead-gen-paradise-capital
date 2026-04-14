import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { extractContentHooks } from "@/lib/enrichment/hook-extractor";

export const hookExtractorStage: PipelineStage = {
  name: "hook-extractor",
  description: "Extracting subject hooks",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await extractContentHooks(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      hooks_extracted: result.extracted,
    };
  },
};
