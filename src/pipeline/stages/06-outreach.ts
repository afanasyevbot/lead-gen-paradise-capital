import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { generateOutreachEmails } from "@/lib/enrichment/outreach";

export const outreachStage: PipelineStage = {
  name: "outreach",
  description: "Generating outreach emails",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await generateOutreachEmails(ctx.minScore, ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      outreach_generated: result.generated,
      outreach_skipped: result.skipped,
    };
  },
};
