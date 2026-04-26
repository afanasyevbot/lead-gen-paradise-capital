import type { ScoredLead } from "../_lib/types";

export function CompletenessChips({ lead }: { lead: ScoredLead }) {
  const chips: { label: string; on: boolean }[] = [
    { label: "site", on: !!lead.has_website },
    { label: "scraped", on: !!lead.has_scraped },
    { label: "li", on: !!lead.has_linkedin },
    { label: "email", on: !!lead.has_email },
  ];
  return (
    <span className="flex gap-1 shrink-0">
      {chips.map((c) => (
        <span key={c.label}
          title={`${c.label}: ${c.on ? "yes" : "no"}`}
          className={`text-[9px] px-1 py-0.5 rounded leading-none tabular-nums ${
            c.on ? "bg-green-900/50 text-green-300" : "bg-[var(--border)] text-[var(--muted)] opacity-50"
          }`}>
          {c.label}
        </span>
      ))}
    </span>
  );
}
