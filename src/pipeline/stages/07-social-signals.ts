import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { gatherAllSocialSignals } from "@/lib/scraper/social-signals";

export const socialSignalsStage: PipelineStage = {
  name: "social-signals",
  description: "Gathering social signals",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await gatherAllSocialSignals(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      social_gathered: result.gathered,
    };
  },
};
