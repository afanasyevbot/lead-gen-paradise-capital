import { TIER_COLORS } from "../_lib/pipeline-config";

export function ScoreTier({ label, sublabel, count, total, color }: { label: string; sublabel: string; count: number; total: number; color: keyof typeof TIER_COLORS }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const c = TIER_COLORS[color];
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className={c.text}>
          <strong>{label}</strong> <span className="text-[var(--muted)] text-xs">· {sublabel}</span>
        </span>
        <span className="tabular-nums">
          <strong>{count}</strong> <span className="text-[var(--muted)] text-xs">({pct}%)</span>
        </span>
      </div>
      <div className="w-full bg-[var(--border)] rounded-full h-1">
        <div className={`${c.bg} h-1 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
