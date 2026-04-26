export function SummaryStat({ label, value, tone, hint }: { label: string; value: number; tone: "green" | "yellow" | "red" | "neutral"; hint?: string }) {
  const toneClass = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
    neutral: "text-[var(--fg)]",
  }[tone];
  const dimmed = value === 0 ? "opacity-40" : "";
  return (
    <div className={`flex flex-col ${dimmed}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-[var(--muted)]">{label}</span>
        <span className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</span>
      </div>
      {hint && <span className="text-[10px] text-[var(--muted)] italic">{hint}</span>}
    </div>
  );
}
