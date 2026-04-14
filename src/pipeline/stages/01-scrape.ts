import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { scrapeLeadsWebsites } from "@/lib/scraper/website";

export const scrapeStage: PipelineStage = {
  name: "scrape",
  description: "Scraping websites",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await scrapeLeadsWebsites(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      websites_scraped: result.scraped,
      websites_failed: result.failed,
      xray_websites_found: result.xray_websites_found,
      xray_linkedin_only: result.xray_linkedin_only,
    };
  },
};
