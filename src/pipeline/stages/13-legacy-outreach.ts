import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { generateLegacyOutreach } from "@/lib/enrichment/legacy-outreach";

export const legacyOutreachStage: PipelineStage = {
  name: "legacy-outreach",
  description: "Generating legacy outreach",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await generateLegacyOutreach(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      legacy_generated: result.generated,
    };
  },
};
