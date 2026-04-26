"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Job, PipelineSummary, ScoredLead } from "../_lib/types";

export type ScoredLeadsState = "idle" | "loading" | "loaded" | "error";

export interface RunPipelineParams {
  endpoint: string;
  limit: number;
  minScore: number;
}

export function useJobPolling() {
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [scoredLeads, setScoredLeads] = useState<ScoredLead[]>([]);
  const [scoredLeadsState, setScoredLeadsState] = useState<ScoredLeadsState>("idle");
  const [scoredLeadsError, setScoredLeadsError] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const runPipeline = useCallback(async ({ endpoint, limit, minScore }: RunPipelineParams) => {
    setRunning(true);
    setJob(null);
    setSummary(null);
    setScoredLeads([]);
    setScoredLeadsState("idle");
    setScoredLeadsError(null);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit, minScore }),
    });
    const body = await res.json();

    if (!res.ok) {
      setRunning(false);
      const msg = body?.error ?? `Error ${res.status}`;
      if (res.status === 409) setLockError(msg);
      setJob({ id: "", status: "failed", progress: { current: 0, total: 0, stage: "", currentItem: "" }, error: msg, startedAt: undefined });
      return;
    }
    setLockError(null);

    const { jobId } = body;

    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        return;
      }
      const j: Job = await r.json();
      setJob(j);
      if (j.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        const since = encodeURIComponent(j.startedAt ?? "");
        fetch(`/api/pipeline/summary?since=${since}`)
          .then((r) => r.json())
          .then(setSummary)
          .catch(() => {});
        const scoredCount = j.result?.scored ?? 0;
        const fetchLimit = scoredCount > 0 ? scoredCount : 20;
        setScoredLeadsState("loading");
        fetch(`/api/pipeline/scored-leads?limit=${fetchLimit}&since=${since}`)
          .then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
            return r.json();
          })
          .then((d) => {
            const leads = (d.leads ?? []) as ScoredLead[];
            setScoredLeads([...leads].sort((a, b) => b.score - a.score));
            setScoredLeadsState("loaded");
          })
          .catch((err) => {
            setScoredLeadsError(err instanceof Error ? err.message : String(err));
            setScoredLeadsState("error");
          });
      }
    }, 2000);
  }, []);

  const clearLock = useCallback(async () => {
    await fetch("/api/pipeline", { method: "DELETE" });
    setLockError(null);
  }, []);

  return {
    job,
    running,
    summary,
    scoredLeads,
    scoredLeadsState,
    scoredLeadsError,
    lockError,
    runPipeline,
    clearLock,
  };
}
