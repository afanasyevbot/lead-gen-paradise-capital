"use client";

import { useState, useRef, useCallback } from "react";

interface PreviewData {
  totalRows: number;
  columns: string[];
  mappedColumns: { from: string; to: string }[];
  unmappedColumns: string[];
  preview: {
    original: Record<string, string>;
    mapped: Record<string, string | null>;
  }[];
}

interface UploadResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
  error?: string;
}

interface PipelineJob {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { current: number; total: number; stage: string; currentItem: string };
  result?: Record<string, number>;
  error?: string;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pipeline options
  const [runPipeline, setRunPipeline] = useState(true);
  const [pipelineMode, setPipelineMode] = useState<"score-outreach" | "full">("score-outreach");
  const [pipelineJob, setPipelineJob] = useState<PipelineJob | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setPreviewing(true);

    try {
      const formData = new FormData();
      formData.append("file", f);

      const res = await fetch("/api/upload", { method: "PUT", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to preview file");
        setPreview(null);
      } else {
        setPreview(data);
      }
    } catch {
      setError("Failed to read file");
    } finally {
      setPreviewing(false);
    }
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".csv")) {
      handleFile(f);
    } else {
      setError("Please upload a CSV file");
    }
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  async function uploadFile() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    setPipelineJob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        setResult(data);
        if (runPipeline && (data.inserted > 0 || data.updated > 0)) {
          await startPipeline(data.inserted + data.updated);
        }
      }
    } catch {
      setError("Upload failed — check your connection");
    } finally {
      setUploading(false);
    }
  }

  async function startPipeline(count: number) {
    setPipelineRunning(true);
    const endpoint = pipelineMode === "full" ? "/api/pipeline" : "/api/score-outreach";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: Math.min(count + 10, 200), minScore: 5 }),
      });
      const { jobId, error: jobError } = await res.json();
      if (jobError) { setPipelineRunning(false); return; }

      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/jobs/${jobId}`);
        const j: PipelineJob = await r.json();
        setPipelineJob(j);
        if (j.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPipelineRunning(false);
        }
      }, 2500);
    } catch {
      setPipelineRunning(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setPipelineJob(null);
    if (pollRef.current) clearInterval(pollRef.current);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Upload Leads</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Import leads from Apollo.io CSV exports or any standard CSV file
        </p>
      </div>

      {/* Drop zone */}
      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border)] hover:border-[var(--muted)]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            onChange={onFileSelect}
            className="hidden"
          />
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-4 text-[var(--muted)]">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
          </svg>
          <p className="text-lg font-medium mb-1">Drop your CSV file here</p>
          <p className="text-sm text-[var(--muted)]">or click to browse — supports Apollo.io exports</p>
        </div>
      )}

      {/* Loading preview */}
      {previewing && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--muted)] border-t-[var(--accent)] rounded-full mx-auto mb-4" />
          <p className="text-sm text-[var(--muted)]">Reading CSV...</p>
        </div>
      )}

      {/* Preview */}
      {preview && !result && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">{file?.name}</p>
              <p className="text-sm text-[var(--muted)]">
                {preview.totalRows} rows &middot; {preview.columns.length} columns &middot;{" "}
                {preview.mappedColumns.length} mapped
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="px-3 py-1.5 text-sm bg-[var(--border)] rounded-lg hover:bg-[#444]"
              >
                Change File
              </button>
              <button
                onClick={uploadFile}
                disabled={uploading}
                className="px-4 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? "Importing..." : `Import ${preview.totalRows} Leads`}
              </button>
            </div>
          </div>

          {/* Column mapping */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">Column Mapping</h2>
            <div className="flex flex-wrap gap-2">
              {preview.mappedColumns.map((m) => (
                <span
                  key={m.from}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-green-900/40 text-green-300 rounded text-xs"
                >
                  {m.from} <span className="text-green-600">&rarr;</span> {m.to}
                </span>
              ))}
              {preview.unmappedColumns.map((c) => (
                <span
                  key={c}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs"
                >
                  {c} <span className="text-gray-600">(stored in raw data)</span>
                </span>
              ))}
            </div>
          </div>

          {/* Pipeline option */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={runPipeline}
                onChange={(e) => setRunPipeline(e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)]"
              />
              <span className="text-sm font-medium">Run pipeline automatically after import</span>
            </label>
            {runPipeline && (
              <div className="ml-7 space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="pipelineMode"
                    value="score-outreach"
                    checked={pipelineMode === "score-outreach"}
                    onChange={() => setPipelineMode("score-outreach")}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <div>
                    <p className="text-sm font-medium">Score &amp; Outreach <span className="text-xs text-green-400 ml-1">recommended for Apollo</span></p>
                    <p className="text-xs text-[var(--muted)]">Uses the contact data already in the CSV — scores each lead and writes outreach emails. Fast.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="pipelineMode"
                    value="full"
                    checked={pipelineMode === "full"}
                    onChange={() => setPipelineMode("full")}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <div>
                    <p className="text-sm font-medium">Full Pipeline</p>
                    <p className="text-xs text-[var(--muted)]">Scrapes websites, finds LinkedIn, extracts data, scores, finds emails, writes outreach. Slower, better for leads without Apollo data.</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Data preview table */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-semibold">Preview (first {preview.preview.length} rows)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="px-4 py-2">Business Name</th>
                    <th className="px-4 py-2">City</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Website</th>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2 font-medium">{row.mapped.business_name || "-"}</td>
                      <td className="px-4 py-2 text-[var(--muted)]">{row.mapped.city || "-"}</td>
                      <td className="px-4 py-2 text-[var(--muted)]">{row.mapped.state || "-"}</td>
                      <td className="px-4 py-2 text-[var(--muted)]">{row.mapped.phone || "-"}</td>
                      <td className="px-4 py-2">
                        {row.mapped.website ? (
                          <span className="text-xs text-blue-400">
                            {(() => { try { return new URL(row.mapped.website).hostname.replace("www.", ""); } catch { return row.mapped.website; } })()}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {row.mapped.email ? (
                          <span className="text-green-400 text-xs">{row.mapped.email}</span>
                        ) : (
                          <span className="text-[var(--muted)]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[var(--muted)]">{row.mapped.owner_name || "-"}</td>
                      <td className="px-4 py-2 text-[var(--muted)]">{row.mapped.title || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-900 rounded-full flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-green-400">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-lg">Import Complete</p>
              <p className="text-sm text-[var(--muted)]">{file?.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{result.inserted}</p>
              <p className="text-xs text-[var(--muted)]">New Leads</p>
            </div>
            <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-400">{result.updated}</p>
              <p className="text-xs text-[var(--muted)]">Updated</p>
            </div>
            <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-400">{result.skipped}</p>
              <p className="text-xs text-[var(--muted)]">Skipped</p>
            </div>
            <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{result.total}</p>
              <p className="text-xs text-[var(--muted)]">Total Rows</p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={reset}
              disabled={pipelineRunning}
              className="px-4 py-2 text-sm bg-[var(--border)] rounded-lg hover:bg-[#444] disabled:opacity-50"
            >
              Upload Another
            </button>
            <a
              href="/leads"
              className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 no-underline"
            >
              View Leads
            </a>
          </div>
        </div>

        {/* Pipeline progress */}
        {(pipelineRunning || pipelineJob) && (
          <div className="mt-4 bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {pipelineMode === "score-outreach" ? "Score & Outreach" : "Full Pipeline"}
                {pipelineJob?.status === "completed" ? " — Done!" : pipelineJob?.status === "failed" ? " — Failed" : " — Running..."}
              </h3>
              <span className={`text-xs px-2 py-0.5 rounded ${
                !pipelineJob || pipelineJob.status === "running" ? "bg-blue-900 text-blue-300" :
                pipelineJob.status === "completed" ? "bg-green-900 text-green-300" :
                "bg-red-900 text-red-300"
              }`}>
                {!pipelineJob ? "starting" : pipelineJob.status}
              </span>
            </div>

            {(!pipelineJob || pipelineJob.status === "running") && (
              <>
                <div className="w-full bg-[var(--border)] rounded-full h-2 mb-2">
                  <div
                    className="bg-[var(--accent)] h-2 rounded-full transition-all"
                    style={{ width: pipelineJob?.progress.total ? `${(pipelineJob.progress.current / pipelineJob.progress.total) * 100}%` : "5%" }}
                  />
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {pipelineJob ? `${pipelineJob.progress.current}/${pipelineJob.progress.total} — ${pipelineJob.progress.currentItem || pipelineJob.progress.stage}` : "Starting pipeline..."}
                </p>
              </>
            )}

            {pipelineJob?.result && (
              <div className="grid grid-cols-3 gap-3 text-sm">
                {Object.entries(pipelineJob.result).map(([k, v]) => (
                  <div key={k} className="bg-[var(--bg)] rounded p-2 text-center">
                    <p className="font-bold text-lg">{v}</p>
                    <p className="text-xs text-[var(--muted)]">{k.replace(/_/g, " ")}</p>
                  </div>
                ))}
              </div>
            )}

            {pipelineJob?.error && (
              <p className="text-sm text-red-400">{pipelineJob.error}</p>
            )}
          </div>
        )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mt-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Help section */}
      <div className="mt-8 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-2">Supported Formats</h2>
        <div className="grid grid-cols-2 gap-4 text-sm text-[var(--muted)]">
          <div>
            <p className="font-medium text-[var(--fg)] mb-1">Apollo.io Export</p>
            <p>Go to Apollo &rarr; select leads &rarr; Export &rarr; CSV. Columns like Company, Email, First Name, Last Name, Title, Website are auto-mapped.</p>
          </div>
          <div>
            <p className="font-medium text-[var(--fg)] mb-1">Generic CSV</p>
            <p>Any CSV with a header row. Include columns named Business Name (or Company), City, State, Email, Phone, Website for best results.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
