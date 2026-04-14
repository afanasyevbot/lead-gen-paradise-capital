"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PresetData {
  queries: string[];
  isCustom: boolean;
}

interface Job {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { current: number; total: number; stage: string; currentItem: string };
  result?: Record<string, number>;
  error?: string;
}

export default function ScrapePage() {
  const [presets, setPresets] = useState<Record<string, PresetData>>({});
  const [preset, setPreset] = useState("");
  const [locations, setLocations] = useState("Tampa, FL");
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [autoPipeline, setAutoPipeline] = useState(false);
  const [pipelineTriggered, setPipelineTriggered] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preset editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editName, setEditName] = useState("");
  const [editQueries, setEditQueries] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (data.presets) {
        setPresets(data.presets);
        if (!preset) {
          const keys = Object.keys(data.presets);
          if (keys.length > 0) setPreset(keys[0]);
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPresets();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadPresets]);

  async function startScrape() {
    const locs = locations.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!locs.length) return;

    setRunning(true);
    setPipelineTriggered(false);
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset, locations: locs }),
    });
    const { jobId } = await res.json();

    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      const j: Job = await r.json();
      setJob(j);
      if (j.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        // Auto-trigger pipeline if enabled and scrape found new leads
        if (autoPipeline && j.status === "completed" && (j.result?.new ?? 0) > 0) {
          setPipelineTriggered(true);
          fetch("/api/pipeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 100, minScore: 5 }),
          }).catch(() => {/* pipeline may already be running */});
        }
      }
    }, 2000);
  }

  function openNewPreset() {
    setEditKey(null);
    setEditName("");
    setEditQueries("");
    setEditorError(null);
    setShowEditor(true);
  }

  function openEditPreset(key: string) {
    const p = presets[key];
    if (!p) return;
    setEditKey(key);
    setEditName(key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    setEditQueries(p.queries.join("\n"));
    setEditorError(null);
    setShowEditor(true);
  }

  async function savePreset() {
    const queries = editQueries.split("\n").map((q) => q.trim()).filter(Boolean);
    if (!editName.trim()) {
      setEditorError("Name is required");
      return;
    }
    if (queries.length === 0) {
      setEditorError("At least one search query is required");
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, queries }),
      });
      const data = await res.json();
      if (data.success) {
        setShowEditor(false);
        setPreset(data.key);
        await loadPresets();
      } else {
        setEditorError(data.error || "Save failed");
      }
    } catch {
      setEditorError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deletePreset(key: string) {
    if (!confirm(`Delete preset "${key}"? This cannot be undone.`)) return;
    try {
      await fetch("/api/presets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (preset === key) setPreset(Object.keys(presets).find((k) => k !== key) || "");
      await loadPresets();
    } catch { /* ignore */ }
  }

  const currentPreset = presets[preset];
  const presetKeys = Object.keys(presets);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Scrape Google Maps</h1>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
        {/* Preset selector */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-[var(--muted)]">Preset</label>
            <button
              onClick={openNewPreset}
              className="text-xs text-[var(--accent)] hover:underline"
              disabled={running}
            >
              + New Preset
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              disabled={running}
            >
              {presetKeys.map((key) => (
                <option key={key} value={key}>
                  {key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ({presets[key].queries.length} queries)
                  {presets[key].isCustom ? " ★" : ""}
                </option>
              ))}
            </select>
            {currentPreset && (
              <button
                onClick={() => openEditPreset(preset)}
                className="px-3 py-2 text-xs bg-[var(--border)] rounded-lg hover:bg-[#444]"
                disabled={running}
                title={currentPreset.isCustom ? "Edit preset" : "View queries (built-in)"}
              >
                {currentPreset.isCustom ? "Edit" : "View"}
              </button>
            )}
            {currentPreset?.isCustom && (
              <button
                onClick={() => deletePreset(preset)}
                className="px-3 py-2 text-xs bg-red-900 text-red-300 rounded-lg hover:bg-red-800"
                disabled={running}
              >
                Delete
              </button>
            )}
          </div>
          {/* Show current queries as tags */}
          {currentPreset && (
            <div className="mt-2 flex flex-wrap gap-1">
              {currentPreset.queries.map((q, i) => (
                <span key={i} className="text-xs bg-[var(--bg)] border border-[var(--border)] px-2 py-0.5 rounded">
                  {q}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Locations */}
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">Locations (one per line)</label>
          <textarea
            value={locations}
            onChange={(e) => setLocations(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm font-mono"
            disabled={running}
            placeholder={"Tampa, FL\nMiami, FL\nFort Lauderdale, FL"}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoPipeline}
            onChange={(e) => setAutoPipeline(e.target.checked)}
            disabled={running}
            className="w-4 h-4 accent-[var(--accent)]"
          />
          <span className="text-sm text-[var(--muted)]">Auto-run pipeline when scrape completes</span>
        </label>

        <button
          onClick={startScrape}
          disabled={running || !preset}
          className="w-full px-4 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Scraping..." : "Start Scrape"}
        </button>
      </div>

      {/* Preset Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">
              {editKey ? (presets[editKey]?.isCustom ? "Edit Preset" : "View Preset") : "New Preset"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Preset Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Roofing"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
                  disabled={editKey !== null && !presets[editKey]?.isCustom}
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Search Queries (one per line)</label>
                <textarea
                  value={editQueries}
                  onChange={(e) => setEditQueries(e.target.value)}
                  rows={8}
                  placeholder={"roofing company\nroof repair\ncommercial roofing contractor"}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm font-mono"
                  disabled={editKey !== null && !presets[editKey]?.isCustom}
                />
              </div>

              {editorError && (
                <p className="text-sm text-red-400">{editorError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowEditor(false)}
                className="px-4 py-2 text-sm bg-[var(--border)] rounded-lg hover:bg-[#444]"
              >
                {editKey !== null && !presets[editKey]?.isCustom ? "Close" : "Cancel"}
              </button>
              {(editKey === null || presets[editKey]?.isCustom) && (
                <button
                  onClick={savePreset}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Preset"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {job && (
        <div className="mt-6 bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              {job.status === "running" ? "Scraping..." : job.status === "completed" ? "Complete!" : "Failed"}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${
              job.status === "running" ? "bg-blue-900 text-blue-300" :
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
                  style={{ width: `${job.progress.total ? (job.progress.current / job.progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-[var(--muted)]">
                {job.progress.current}/{job.progress.total} — {job.progress.currentItem}
              </p>
            </>
          )}

          {job.result && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-[var(--muted)]">New:</span> <strong className="text-green-400">{job.result.new}</strong></div>
              <div><span className="text-[var(--muted)]">Updated:</span> <strong>{job.result.updated}</strong></div>
              <div><span className="text-[var(--muted)]">Total found:</span> <strong>{job.result.total}</strong></div>
            </div>
          )}
          {pipelineTriggered && (
            <div className="mt-3 text-xs text-green-400 flex items-center gap-1.5">
              <span>✓</span>
              <span>Pipeline auto-started — <a href="/pipeline" className="underline hover:text-green-300">view progress →</a></span>
            </div>
          )}

          {job.error && <p className="text-sm text-red-400">{job.error}</p>}
        </div>
      )}
    </div>
  );
}
