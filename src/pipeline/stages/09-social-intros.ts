import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { generateSocialIntros } from "@/lib/enrichment/social-intro";

export const socialIntrosStage: PipelineStage = {
  name: "social-intros",
  description: "Generating social intros",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await generateSocialIntros(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      intros_generated: result.generated,
    };
  },
};
