import type { PipelineMode, PipelineStage } from "./types";

export const CORE_STAGES: PipelineStage[] = [
  { key: "scrape-websites", label: "Websites", desc: "Scrape lead websites" },
  { key: "linkedin", label: "LinkedIn", desc: "Find owner profiles" },
  { key: "extract", label: "Extract", desc: "Founder + age + revenue signals" },
  { key: "score", label: "Score", desc: "Avatar fit scoring" },
  { key: "emails", label: "Emails", desc: "Find founder emails" },
  { key: "outreach", label: "Outreach", desc: "Tiered emails for Paul" },
];

export const ENRICH_STAGES: PipelineStage[] = [
  { key: "extract", label: "Extract", desc: "Founder + age + revenue signals" },
  { key: "score", label: "Score", desc: "Avatar fit scoring" },
  { key: "emails", label: "Emails", desc: "Find founder emails" },
  { key: "outreach", label: "Outreach", desc: "Tiered emails for Paul" },
];

export interface PipelineConfig {
  key: PipelineMode;
  label: string;
  desc: string;
  endpoint: string;
  stages: PipelineStage[];
}

export const PIPELINE_CONFIGS: PipelineConfig[] = [
  {
    key: "core",
    label: "Full Pipeline (6 stages)",
    desc: "Scrape websites → LinkedIn → Extract → Score → Emails → Outreach",
    endpoint: "/api/pipeline",
    stages: CORE_STAGES,
  },
  {
    key: "enrich-only",
    label: "Enrich Only (4 stages)",
    desc: "Skip scraping — extract, score, find emails & write outreach for already-scraped leads",
    endpoint: "/api/enrich-only",
    stages: ENRICH_STAGES,
  },
];

export const TIER_COLORS: Record<string, { text: string; bg: string }> = {
  "green-400": { text: "text-green-400", bg: "bg-green-400" },
  "green-300": { text: "text-green-300", bg: "bg-green-300" },
  "yellow-400": { text: "text-yellow-400", bg: "bg-yellow-400" },
  "gray-500": { text: "text-gray-500", bg: "bg-gray-500" },
};
