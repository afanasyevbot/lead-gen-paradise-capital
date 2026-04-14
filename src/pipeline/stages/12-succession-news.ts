import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { scanSuccessionNews } from "@/lib/scraper/succession-news";

export const successionNewsStage: PipelineStage = {
  name: "succession-news",
  description: "Scanning succession news",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await scanSuccessionNews(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      news_scanned: result.scanned,
      news_signals_found: result.signals_found,
    };
  },
};
