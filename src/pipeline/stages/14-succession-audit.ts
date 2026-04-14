import type { PipelineStage, PipelineContext, StageResult } from "../stage.interface";
import { runSuccessionAudits } from "@/lib/enrichment/succession-audit";

export const successionAuditStage: PipelineStage = {
  name: "succession-audit",
  description: "Running succession audits",

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const result = await runSuccessionAudits(ctx.limit, (current, total, item) => {
      ctx.onItemProgress(current, total, item);
    });
    return {
      audits_completed: result.audited,
    };
  },
};
