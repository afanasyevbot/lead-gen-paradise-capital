export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 7 ? "bg-green-600" : score >= 5 ? "bg-yellow-600" : "bg-red-600";
  return (
    <span className={`${color} text-white text-lg font-bold px-3 py-1 rounded-lg`}>
      {score}/10
    </span>
  );
}

export function MiniScore({ score, label }: { score: number; label: string }) {
  const color = score >= 7 ? "text-green-400" : score >= 5 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="text-center">
      <span className={`text-2xl font-bold ${color}`}>{score}</span>
      <span className="text-[var(--muted)] text-xs">/10</span>
      <p className="text-xs text-[var(--muted)] mt-0.5">{label}</p>
    </div>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active_conversation: { bg: "bg-green-900", text: "text-green-300", label: "Active Conversation" },
    warm_introduction: { bg: "bg-blue-900", text: "text-blue-300", label: "Warm Introduction" },
    not_now: { bg: "bg-gray-700", text: "text-gray-300", label: "Not Now" },
  };
  const c = config[tier] || config.not_now;
  return (
    <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded text-xs font-medium`}>{c.label}</span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    not_ready: { bg: "bg-red-900", text: "text-red-300" },
    awakening: { bg: "bg-yellow-900", text: "text-yellow-300" },
    exploring: { bg: "bg-blue-900", text: "text-blue-300" },
    ready: { bg: "bg-green-900", text: "text-green-300" },
    owner_dependent: { bg: "bg-red-900", text: "text-red-300" },
    transitioning: { bg: "bg-yellow-900", text: "text-yellow-300" },
    transferable: { bg: "bg-green-900", text: "text-green-300" },
    under_positioned: { bg: "bg-red-900", text: "text-red-300" },
    moderate: { bg: "bg-yellow-900", text: "text-yellow-300" },
    well_positioned: { bg: "bg-green-900", text: "text-green-300" },
  };
  const c = config[stage] || { bg: "bg-gray-700", text: "text-gray-300" };
  return (
    <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded text-xs`}>
      {stage.replace(/_/g, " ")}
    </span>
  );
}
