"use client";

import { useState, useEffect, useCallback } from "react";

interface Campaign {
  id: string;
  name: string;
  status?: string;
}

interface ReadyLead {
  id: number;
  business_name: string;
  owner_name: string | null;
  owner_email: string | null;
  score: number | null;
  city: string | null;
  state: string | null;
}

interface PushResult {
  success: boolean;
  leads_pushed?: number;
  skipped?: { id: number; name: string; reason: string }[];
  suppressed?: { email: string; reason: string }[];
  error?: string;
  total_requested?: number;
  total_with_email?: number;
  total_after_suppression?: number;
}

export default function InstantlyPage() {
  const [apiKeyStatus, setApiKeyStatus] = useState<"loading" | "configured" | "missing">("loading");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [readyLeads, setReadyLeads] = useState<ReadyLead[]>([]);
  const [readyLoading, setReadyLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [selectAll, setSelectAll] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/instantly/campaigns");
      const data = await res.json();
      if (!res.ok) {
        setCampaignsError(data.error || "Failed to load campaigns");
        if (data.error?.includes("API key")) setApiKeyStatus("missing");
        else setApiKeyStatus("configured");
        return;
      }
      setCampaigns(data.campaigns || []);
      setApiKeyStatus("configured");
      setCampaignsError(null);
    } catch (e) {
      setCampaignsError(String(e));
      setApiKeyStatus("missing");
    }
  }, []);

  const loadReadyLeads = useCallback(async () => {
    setReadyLoading(true);
    try {
      const res = await fetch("/api/instantly/ready");
      if (!res.ok) return;
      const data = await res.json();
      setReadyLeads(data.leads || []);
      setSelectedIds(new Set((data.leads || []).map((l: ReadyLead) => l.id)));
    } catch { /* ignore */ }
    finally { setReadyLoading(false); }
  }, []);

  useEffect(() => {
    loadCampaigns();
    loadReadyLeads();
  }, [loadCampaigns, loadReadyLeads]);

  function toggleLead(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAll(false);
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelectedIds(new Set());
      setSelectAll(false);
    } else {
      setSelectedIds(new Set(readyLeads.map(l => l.id)));
      setSelectAll(true);
    }
  }

  async function pushLeads() {
    if (!selectedCampaign || selectedIds.size === 0) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/instantly/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaign, leadIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      setPushResult(data);
      if (data.success) {
        // Remove pushed leads from list
        await loadReadyLeads();
      }
    } catch (e) {
      setPushResult({ success: false, error: String(e) });
    } finally {
      setPushing(false);
    }
  }

  const scoreColor = (s: number | null) => {
    if (!s) return "text-[var(--muted)]";
    if (s >= 8) return "text-green-400";
    if (s >= 6) return "text-yellow-400";
    return "text-[var(--muted)]";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Instantly</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          Push enriched leads with written outreach directly into Instantly campaigns.
        </p>
      </div>

      {/* API Key Status */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">API Connection</h2>
            {apiKeyStatus === "loading" && (
              <p className="text-xs text-[var(--muted)] mt-1">Checking connection...</p>
            )}
            {apiKeyStatus === "configured" && !campaignsError && (
              <p className="text-xs text-green-400 mt-1">
                ✓ Connected — {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""} found
              </p>
            )}
            {apiKeyStatus === "missing" && (
              <div className="mt-1">
                <p className="text-xs text-red-400">
                  ✗ INSTANTLY_API_KEY not configured
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Add your Instantly API key to <code className="bg-[var(--border)] px-1 rounded">.env.local</code> or Railway environment variables:
                </p>
                <code className="block text-xs bg-[var(--border)] rounded px-3 py-2 mt-2 font-mono">
                  INSTANTLY_API_KEY=your_api_key_here
                </code>
                <p className="text-xs text-[var(--muted)] mt-2">
                  Find your API key at{" "}
                  <a href="https://app.instantly.ai/app/settings/integrations" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                    app.instantly.ai → Settings → Integrations → API
                  </a>
                </p>
              </div>
            )}
            {campaignsError && apiKeyStatus !== "missing" && (
              <p className="text-xs text-red-400 mt-1">{campaignsError}</p>
            )}
          </div>
          <button
            onClick={() => { setApiKeyStatus("loading"); loadCampaigns(); }}
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)] px-2 py-1 border border-[var(--border)] rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Campaign Selector + Push */}
      {apiKeyStatus === "configured" && campaigns.length > 0 && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">Push to Campaign</h2>

          <div className="flex items-center gap-3">
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="flex-1 max-w-sm px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
            >
              <option value="">Select a campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.status ? ` (${c.status})` : ""}
                </option>
              ))}
            </select>

            <button
              onClick={pushLeads}
              disabled={!selectedCampaign || selectedIds.size === 0 || pushing}
              className="px-5 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {pushing
                ? "Pushing..."
                : `Push ${selectedIds.size} lead${selectedIds.size !== 1 ? "s" : ""} →`}
            </button>
          </div>

          {pushResult && (
            <div className={`rounded-lg p-3 text-sm ${pushResult.success ? "bg-green-900/40 border border-green-800" : "bg-red-900/40 border border-red-800"}`}>
              {pushResult.success ? (
                <div className="space-y-1">
                  <p className="text-green-300 font-medium">
                    ✓ {pushResult.leads_pushed} lead{pushResult.leads_pushed !== 1 ? "s" : ""} pushed to Instantly
                  </p>
                  {pushResult.skipped && pushResult.skipped.length > 0 && (
                    <p className="text-[var(--muted)] text-xs">
                      {pushResult.skipped.length} skipped (no email or already sent)
                    </p>
                  )}
                  {pushResult.suppressed && pushResult.suppressed.length > 0 && (
                    <p className="text-yellow-400 text-xs">
                      {pushResult.suppressed.length} suppressed (on do-not-contact list)
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-red-300">{pushResult.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ready Leads Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-sm">
              Ready to Push
              {!readyLoading && (
                <span className="ml-2 text-xs text-[var(--muted)] font-normal">
                  {readyLeads.length} lead{readyLeads.length !== 1 ? "s" : ""} with outreach written + email found, not yet sent
                </span>
              )}
            </h2>
          </div>
          {readyLeads.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
            >
              {selectAll ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>

        {readyLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading leads...</p>
        ) : readyLeads.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[var(--muted)] text-sm">No leads ready to push.</p>
            <p className="text-[var(--muted)] text-xs mt-1">
              Leads appear here once they have: outreach written + email found + not yet sent.
            </p>
            <a
              href="/pipeline"
              className="inline-block mt-3 text-xs text-[var(--accent)] hover:underline"
            >
              Run pipeline to generate outreach →
            </a>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-3 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="pb-2 text-left">Business</th>
                  <th className="pb-2 text-left">Owner</th>
                  <th className="pb-2 text-left">Email</th>
                  <th className="pb-2 text-left">Location</th>
                  <th className="pb-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {readyLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleLead(lead.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <a
                        href={`/leads/${lead.id}`}
                        className="hover:text-[var(--accent)] transition-colors"
                      >
                        {lead.business_name}
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)]">
                      {lead.owner_name || "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">
                      {lead.owner_email || "—"}
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)] text-xs">
                      {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className={`py-2 text-right font-mono font-medium ${scoreColor(lead.score)}`}>
                      {lead.score ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="card text-xs text-[var(--muted)] space-y-1">
        <p className="font-medium text-[var(--fg)]">How it works</p>
        <p>1. Run the pipeline — leads get scraped, scored, and outreach emails written.</p>
        <p>2. Email finder runs on leads scoring 4+ (Hunter → Snov → Apollo waterfall).</p>
        <p>3. Leads with outreach + a verified email appear here, ready to push.</p>
        <p>4. Select a campaign above and click Push — contacts are added with the personalized email as a custom variable in Instantly.</p>
        <p className="pt-1">Leads already pushed to Instantly are hidden automatically (idempotent).</p>
      </div>
    </div>
  );
}
