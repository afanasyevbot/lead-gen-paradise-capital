"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Job {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { current: number; total: number; stage: string; currentItem: string };
  result?: Record<string, number>;
  error?: string;
}

const DEFAULT_TITLES = ["founder", "owner", "president", "co-founder", "co-owner"];

const PRESET_LABELS: Record<string, string> = {
  "hvac":             "HVAC",
  "plumbing":         "Plumbing",
  "marine":           "Marine / Boat",
  "manufacturing":    "Manufacturing",
  "construction":     "Construction",
  "roofing":          "Roofing",
  "electrical":       "Electrical",
  "trucking":         "Trucking / Freight",
  "landscaping":      "Landscaping",
  "distribution":     "Distribution / Wholesale",
  "staffing":         "Staffing / Recruiting",
  "consulting":       "Consulting",
  "marketing-agency": "Marketing Agency",
  "it-services":      "IT Services / MSP",
  "accounting":       "Accounting / CPA",
  "insurance":        "Insurance Agency",
  "printing":         "Printing / Commercial Print",
  "environmental":    "Environmental Services",
  "fire-security":    "Fire & Security",
  "waste":            "Waste Management",
};

export default function XRayPage() {
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  const [industry, setIndustry] = useState("hvac");
  const [locations, setLocations] = useState("");
  const [titlesInput, setTitlesInput] = useState(DEFAULT_TITLES.join(", "));
  const [maxPerSearch, setMaxPerSearch] = useState(30);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/xray");
      const data = await res.json();
      if (data.presets) setPresets(data.presets);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadPresets();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadPresets]);

  async function startSearch() {
    const locs = locations.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!locs.length || !industry) return;

    const titles = titlesInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    setRunning(true);
    setJob(null);

    const res = await fetch("/api/xray", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry, locations: locs, titles, maxPerSearch }),
    });
    const { jobId, error } = await res.json();

    if (error) {
      setRunning(false);
      alert(`Error: ${error}`);
      return;
    }

    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      const j: Job = await r.json();
      setJob(j);
      if (j.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
      }
    }, 2500);
  }

  const totalSearches = industry && presets[industry]
    ? presets[industry].length * locations.split("\n").filter(Boolean).length
    : 0;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">LinkedIn X-Ray Search</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Find founders on LinkedIn via Google — no LinkedIn account or login required.
          </p>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          How it works
        </button>
      </div>

      {showHelp && (
        <div className="mb-6 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm space-y-2">
          <p className="font-medium">How LinkedIn X-Ray works:</p>
          <ul className="space-y-1 text-[var(--muted)] list-disc pl-4">
            <li>Searches Google using <code className="text-[var(--fg)]">site:linkedin.com/in</code> to find founder/owner profiles</li>
            <li>Extracts name, title, company, and LinkedIn URL from Google snippets — <strong>never visits LinkedIn</strong></li>
            <li>Saves results as leads with <code className="text-[var(--fg)]">source=linkedin_xray</code></li>
            <li>Pre-seeds each lead's LinkedIn URL so the pipeline skips re-discovery</li>
            <li>Run the normal pipeline on these leads to scrape their website, extract data, score, and generate outreach</li>
          </ul>
          <p className="text-[var(--muted)]">
            <strong>Rate limits:</strong> Google may throttle after ~100 searches. A 3-5s delay is added between queries automatically.
          </p>
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">

        {/* Industry */}
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">Industry</label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
            disabled={running}
          >
            {Object.entries(PRESET_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {industry && presets[industry] && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Keywords searched: {presets[industry].map((k) => `"${k}"`).join(", ")}
            </p>
          )}
        </div>

        {/* Locations */}
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">
            Locations{" "}
            <span className="text-xs">(one per line — be specific, e.g. "Tampa, Florida")</span>
          </label>
          <textarea
            value={locations}
            onChange={(e) => setLocations(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm font-mono"
            disabled={running}
            placeholder={"Tampa, Florida\nMiami, Florida\nOrlando, Florida"}
          />
        </div>

        {/* Founder Titles */}
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">
            Founder titles to search{" "}
            <span className="text-xs">(comma-separated)</span>
          </label>
          <input
            type="text"
            value={titlesInput}
            onChange={(e) => setTitlesInput(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm font-mono"
            disabled={running}
            placeholder="founder, owner, president, co-founder"
          />
        </div>

        {/* Max results */}
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">
            Max profiles per keyword/location combo{" "}
            <span className="text-xs">(10–40 recommended)</span>
          </label>
          <input
            type="number"
            value={maxPerSearch}
            onChange={(e) => setMaxPerSearch(Number(e.target.value))}
            min={5}
            max={50}
            className="w-32 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
            disabled={running}
          />
        </div>

        {totalSearches > 0 && (
          <p className="text-xs text-[var(--muted)]">
            Will run <strong className="text-[var(--fg)]">{totalSearches}</strong> Google search
            {totalSearches !== 1 ? "es" : ""} — estimated{" "}
            <strong className="text-[var(--fg)]">{Math.ceil(totalSearches * 5 / 60)} min</strong> with rate-limit delays.
          </p>
        )}

        <button
          onClick={startSearch}
          disabled={running || !industry}
          className="w-full px-4 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Searching..." : "Start X-Ray Search"}
        </button>
      </div>

      {/* Progress / Results */}
      {job && (
        <div className="mt-6 bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              {job.status === "running"
                ? "Searching LinkedIn via Google X-Ray..."
                : job.status === "completed"
                ? "Search Complete!"
                : "Search Failed"}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${
              job.status === "running"   ? "bg-blue-900 text-blue-300" :
              job.status === "completed" ? "bg-green-900 text-green-300" :
              "bg-red-900 text-red-300"
            }`}>
              {job.status}
            </span>
          </div>

          {job.status === "running" && (
            <>
              <div className="w-full bg-[var(--border)] rounded-full h-2 mb-2">
                <div
                  className="bg-[var(--accent)] h-2 rounded-full transition-all"
                  style={{
                    width: `${job.progress.total ? (job.progress.current / job.progress.total) * 100 : 5}%`,
                  }}
                />
              </div>
              <p className="text-xs text-[var(--muted)]">
                {job.progress.current}/{job.progress.total} — {job.progress.currentItem || "starting..."}
              </p>
            </>
          )}

          {job.result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-[var(--muted)]">New leads:</span>{" "}
                  <strong className="text-green-400">{job.result.new}</strong>
                </div>
                <div>
                  <span className="text-[var(--muted)]">Updated:</span>{" "}
                  <strong>{job.result.updated}</strong>
                </div>
                <div>
                  <span className="text-[var(--muted)]">Profiles found:</span>{" "}
                  <strong>{job.result.total}</strong>
                </div>
              </div>
              {(job.result.new ?? 0) > 0 && (
                <div className="mt-3 p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)] text-xs text-[var(--muted)]">
                  <strong className="text-[var(--fg)]">Next step:</strong> Go to{" "}
                  <a href="/pipeline" className="text-[var(--accent)] hover:underline">
                    Pipeline
                  </a>{" "}
                  and run the full pipeline on the new leads. X-Ray leads start at{" "}
                  <code>pending</code> — the pipeline will scrape their websites, extract data,
                  score them, and generate outreach for 7+ scores.
                </div>
              )}
            </div>
          )}

          {job.error && (
            <p className="text-sm text-red-400 mt-2">{job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
