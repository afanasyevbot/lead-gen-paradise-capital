import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { generateTenureLegacyEmails } from "@/lib/enrichment/tenure-legacy-email";

export const tenureLegacyEmailStage: PipelineStage = {
  name: "tenure-legacy-email",
  description: "Generating tenure & legacy emails",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await generateTenureLegacyEmails(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      tenure_legacy_generated: result.generated,
    };
  },
};
