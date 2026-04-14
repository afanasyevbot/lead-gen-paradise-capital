import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { findLinkedInProfiles } from "@/lib/scraper/linkedin";

export const linkedinStage: PipelineStage = {
  name: "linkedin",
  description: "Finding LinkedIn profiles",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await findLinkedInProfiles(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      linkedin_found: result.found,
      linkedin_not_found: result.not_found,
    };
  },
};
