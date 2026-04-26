import type { PipelineStage } from "../_lib/types";

export function StageBox({ stage, isActive, isDone }: { stage: PipelineStage; isActive: boolean; isDone: boolean }) {
  return (
    <div
      className={`p-3 rounded-lg border text-center text-xs ${
        isActive
          ? "border-[var(--accent)] bg-blue-950"
          : isDone
          ? "border-green-800 bg-green-950"
          : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <p className="font-semibold text-sm">{stage.label}</p>
      <p className="text-[var(--muted)] text-[10px] mt-0.5">{stage.desc}</p>
      {isActive && <p className="text-[var(--accent)] mt-1 animate-pulse text-[10px]">Running...</p>}
      {isDone && <p className="text-green-400 mt-1 text-[10px]">Done</p>}
    </div>
  );
}
