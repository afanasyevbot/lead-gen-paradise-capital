import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { gatherContentHooks } from "@/lib/scraper/content-hooks";

export const contentHooksStage: PipelineStage = {
  name: "content-hooks",
  description: "Scraping blogs & podcasts",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await gatherContentHooks(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      content_gathered: result.gathered,
    };
  },
};
