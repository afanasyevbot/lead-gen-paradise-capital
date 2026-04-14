"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Lead {
  id: number;
  business_name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  enrichment_status: string;
  is_chain: number;
  phone: string | null;
  exit_score: number | null;
  score_reason: string | null;
  founder_email: string | null;
  email_source: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    scraped: "bg-blue-900 text-blue-300",
    enriched: "bg-purple-900 text-purple-300",
    scored: "bg-yellow-900 text-yellow-300",
    outreach_generated: "bg-green-900 text-green-300",
    scrape_failed:      "bg-red-900 text-red-300",
    enrich_failed:      "bg-red-900 text-red-300",
    score_failed:       "bg-red-900 text-red-300",
    outreach_failed:    "bg-red-900 text-red-400",
    pre_filtered:       "bg-gray-800 text-gray-500",
    icp_rejected:       "bg-orange-950 text-orange-400",
    no_website:         "bg-gray-800 text-gray-500",
  };
  const labels: Record<string, string> = {
    outreach_generated: "outreach ready",
    outreach_failed:    "outreach failed",
    pre_filtered:       "filtered out",
    icp_rejected:       "not ICP",
    no_website:         "no website",
    scrape_failed:      "scrape failed",
    enrich_failed:      "enrich failed",
    score_failed:       "score failed",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${colors[status] || "bg-gray-700 text-gray-300"}`}>
      {labels[status] || status.replace(/_/g, " ")}
    </span>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [scoreTier, setScoreTier] = useState("");
  const [hasEmail, setHasEmail] = useState("");
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"none" | "instantly" | "pipeline">("none");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pipelineAction, setPipelineAction] = useState("linkedin");
  const [pipelineProgress, setPipelineProgress] = useState({ done: 0, total: 0, current: "" });

  const fetchLeads = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "50");
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (scoreTier) params.set("scoreTier", scoreTier);
    if (hasEmail) params.set("hasEmail", hasEmail);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);

    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setLeads(data.leads ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        // Silently ignore — server may be momentarily restarting during pipeline runs
      });
  }, [page, search, status, scoreTier, hasEmail, sortBy, sortOrder]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const totalPages = Math.ceil(total / 50);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }

  async function openBulkInstantly() {
    setBulkAction("instantly");
    setBulkResult(null);
    try {
      const res = await fetch("/api/instantly/campaigns");
      const data = await res.json();
      if (data.campaigns) setCampaigns(data.campaigns);
      else setBulkResult({ success: false, message: data.error || "Failed to load campaigns" });
    } catch {
      setBulkResult({ success: false, message: "Failed to connect to Instantly" });
    }
  }

  async function pushBulk() {
    if (!selectedCampaign || selected.size === 0) return;
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/instantly/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaign, leadIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkResult({
          success: true,
          message: `Pushed ${data.leads_pushed} leads to Instantly${data.skipped?.length ? ` (${data.skipped.length} skipped — no email)` : ""}`,
        });
      } else {
        setBulkResult({ success: false, message: data.error || "Push failed" });
      }
    } catch {
      setBulkResult({ success: false, message: "Failed to push" });
    } finally {
      setBulkLoading(false);
    }
  }

  async function runBulkPipeline() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setBulkResult(null);
    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const lead = leads.find((l) => l.id === ids[i]);
      const leadName = lead?.business_name || `Lead ${ids[i]}`;
      setPipelineProgress({ done: i, total: ids.length, current: leadName });
      try {
        const res = await fetch(`/api/leads/${ids[i]}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: pipelineAction }),
        });
        const data = await res.json();
        if (data.success) {
          succeeded++;
        } else {
          failed++;
          if (data.error) errors.push(`${leadName}: ${data.error}`);
        }
      } catch (e) {
        failed++;
        errors.push(`${leadName}: network error`);
      }
    }

    setPipelineProgress({ done: ids.length, total: ids.length, current: "" });
    const summary = `${pipelineAction}: ${succeeded} succeeded, ${failed} failed out of ${ids.length} leads`;
    const detail = errors.length > 0 ? `\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ""}` : "";
    setBulkResult({
      success: failed === 0,
      message: summary + detail,
    });
    setBulkLoading(false);
    fetchLeads();
  }

  const SortHeader = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <th
      className="pb-2 cursor-pointer hover:text-[var(--fg)] select-none"
      onClick={() => handleSort(col)}
    >
      {children} {sortBy === col ? (sortOrder === "asc" ? "\u2191" : "\u2193") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Leads ({total})</h1>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-sm text-[var(--muted)]">{selected.size} selected</span>
              <button
                onClick={() => { setBulkAction("pipeline"); setBulkResult(null); }}
                className="px-3 py-1.5 text-xs bg-blue-700 text-white rounded-lg hover:bg-blue-600"
              >
                Run Stage
              </button>
              <button
                onClick={openBulkInstantly}
                className="px-3 py-1.5 text-xs bg-purple-700 text-white rounded-lg hover:bg-purple-600"
              >
                Push to Instantly
              </button>
              <button
                onClick={() => { setSelected(new Set()); setBulkAction("none"); setBulkResult(null); }}
                className="px-3 py-1.5 text-xs bg-[var(--border)] rounded-lg hover:bg-[#444]"
              >
                Clear
              </button>
            </>
          )}
          <a
            href={`/api/export?format=csv${status ? `&status=${status}` : ""}`}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm hover:opacity-90 no-underline"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Bulk Instantly panel */}
      {bulkAction === "instantly" && (
        <div className="bg-purple-950 border border-purple-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Push {selected.size} leads to:</span>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="flex-1 max-w-xs px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-sm"
            >
              <option value="">Select campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={pushBulk}
              disabled={!selectedCampaign || bulkLoading}
              className="px-4 py-1.5 text-sm bg-purple-700 text-white rounded hover:bg-purple-600 disabled:opacity-50"
            >
              {bulkLoading ? "Pushing..." : "Push"}
            </button>
            <button
              onClick={() => { setBulkAction("none"); setBulkResult(null); }}
              className="text-sm text-[var(--muted)] hover:text-[var(--fg)]"
            >
              Cancel
            </button>
          </div>
          {bulkResult && (
            <p className={`text-sm mt-2 whitespace-pre-line ${bulkResult.success ? "text-green-400" : "text-red-400"}`}>
              {bulkResult.message}
            </p>
          )}
        </div>
      )}

      {/* Bulk Pipeline panel */}
      {bulkAction === "pipeline" && (
        <div className="bg-blue-950 border border-blue-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Run on {selected.size} leads:</span>
            <select
              value={pipelineAction}
              onChange={(e) => setPipelineAction(e.target.value)}
              className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-sm"
              disabled={bulkLoading}
            >
              <option value="scrape-website">Scrape Website (required first step)</option>
              <option value="linkedin">LinkedIn (find owner/founder profile)</option>
              <option value="extract">Extract (AI reads website + LinkedIn)</option>
              <option value="find-email">Find Email (website + Apollo, scored 7+ only)</option>
              <option value="score">Score (avatar fit)</option>
              <option value="outreach">Outreach (generate emails)</option>
            </select>
            <button
              onClick={runBulkPipeline}
              disabled={bulkLoading}
              className="px-4 py-1.5 text-sm bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {bulkLoading ? "Running..." : "Run"}
            </button>
            <button
              onClick={() => { setBulkAction("none"); setBulkResult(null); }}
              className="text-sm text-[var(--muted)] hover:text-[var(--fg)]"
              disabled={bulkLoading}
            >
              Cancel
            </button>
          </div>
          {bulkLoading && pipelineProgress.total > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span>Processing: {pipelineProgress.current}</span>
                <span>{pipelineProgress.done}/{pipelineProgress.total}</span>
              </div>
              <div className="w-full bg-[var(--border)] rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${(pipelineProgress.done / pipelineProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {bulkResult && (
            <p className={`text-sm mt-2 whitespace-pre-line ${bulkResult.success ? "text-green-400" : "text-yellow-400"}`}>
              {bulkResult.message}
            </p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search business name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm flex-1 min-w-[180px] max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm"
        >
          <option value="">All statuses</option>
          <optgroup label="Active">
            <option value="pending">Pending</option>
            <option value="scraped">Scraped</option>
            <option value="enriched">Enriched</option>
            <option value="scored">Scored</option>
            <option value="outreach_generated">Outreach Generated</option>
          </optgroup>
          <optgroup label="Filtered Out">
            <option value="pre_filtered">Pre-filtered (rule-based)</option>
            <option value="icp_rejected">ICP Rejected (Haiku screen)</option>
            <option value="no_website">No Website</option>
          </optgroup>
          <optgroup label="Failed / Retry">
            <option value="scrape_failed">Scrape Failed</option>
            <option value="enrich_failed">Enrich Failed</option>
            <option value="score_failed">Score Failed</option>
            <option value="outreach_failed">Outreach Failed</option>
          </optgroup>
        </select>
        <select
          value={scoreTier}
          onChange={(e) => { setScoreTier(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm"
        >
          <option value="">All scores</option>
          <option value="high">High priority (7–10)</option>
          <option value="medium">Worth watching (4–6)</option>
          <option value="low">Low priority (1–3)</option>
          <option value="unscored">Not yet scored</option>
        </select>
        <select
          value={hasEmail}
          onChange={(e) => { setHasEmail(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm"
        >
          <option value="">All leads</option>
          <option value="yes">Has email</option>
          <option value="no">No email found</option>
        </select>
        {(status || scoreTier || hasEmail || search) && (
          <button
            onClick={() => { setStatus(""); setScoreTier(""); setHasEmail(""); setSearch(""); setPage(1); }}
            className="px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)] border border-[var(--border)] rounded-lg"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
              <th className="pb-2 px-4 w-8">
                <input
                  type="checkbox"
                  checked={leads.length > 0 && selected.size === leads.length}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <SortHeader col="business_name">Business</SortHeader>
              <SortHeader col="city">Location</SortHeader>
              <SortHeader col="score">Score</SortHeader>
              <th className="pb-2 px-4">Status</th>
              <th className="pb-2 px-4">Email</th>
              <th className="pb-2 px-4">Website</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <p className="text-[var(--muted)] mb-2">{search || status ? "No leads match your filters" : "No leads yet"}</p>
                  {!search && !status && (
                    <div className="flex items-center justify-center gap-3 text-sm">
                      <a href="/scrape" className="text-[var(--accent)] hover:underline">Scrape from Google Maps</a>
                      <span className="text-[var(--muted)]">or</span>
                      <a href="/upload" className="text-[var(--accent)] hover:underline">Upload a CSV</a>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`border-t border-[var(--border)] hover:bg-[#1a1a1a] ${selected.has(lead.id) ? "bg-[#1a1a2a]" : ""}`}
              >
                <td className="py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="rounded"
                  />
                </td>
                <td className="py-3 px-4">
                  <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                    {lead.business_name}
                  </Link>
                  {lead.is_chain === 1 && (
                    <span className="ml-2 text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">chain</span>
                  )}
                </td>
                <td className="py-3 px-4 text-[var(--muted)]">
                  {lead.city}{lead.state ? `, ${lead.state}` : ""}
                </td>
                <td className="py-3 px-4">
                  {lead.exit_score != null ? (
                    <span
                      title={lead.score_reason ?? undefined}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold cursor-help ${
                        lead.exit_score >= 7 ? "bg-green-900 text-green-300" :
                        lead.exit_score >= 4 ? "bg-yellow-900 text-yellow-300" :
                        "bg-red-900 text-red-300"
                      }`}
                    >
                      {lead.exit_score}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">-</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <StatusBadge status={lead.enrichment_status} />
                </td>
                <td className="py-3 px-4">
                  {lead.founder_email ? (
                    <span className="text-xs text-green-400 font-mono truncate max-w-[160px] block" title={lead.founder_email}>
                      ✓ {lead.founder_email}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-xs">
                      {(() => { try { return new URL(lead.website).hostname.replace("www.", ""); } catch { return lead.website; } })()}
                    </a>
                  ) : (
                    <span className="text-[var(--muted)]">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-[var(--card)] border border-[var(--border)] rounded text-sm disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 bg-[var(--card)] border border-[var(--border)] rounded text-sm disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
