"use client";

import { useState } from "react";

export function PushToInstantly({ leadId }: { leadId: number }) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [open, setOpen] = useState(false);

  async function loadCampaigns() {
    setOpen(true);
    try {
      const res = await fetch("/api/instantly/campaigns");
      const data = await res.json();
      if (data.campaigns) setCampaigns(data.campaigns);
      else setResult({ success: false, message: data.error || "Failed to load campaigns" });
    } catch {
      setResult({ success: false, message: "Failed to connect to Instantly" });
    }
  }

  async function push() {
    if (!selectedCampaign) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/instantly/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaign, leadIds: [leadId] }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Pushed to Instantly (${data.leads_pushed} lead)` });
      } else {
        setResult({ success: false, message: data.error || "Push failed" });
      }
    } catch {
      setResult({ success: false, message: "Failed to push" });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button onClick={loadCampaigns} className="px-3 py-1.5 text-xs bg-purple-700 text-white rounded-lg hover:bg-purple-600 transition-colors">
        Push to Instantly
      </button>
    );
  }

  return (
    <div className="bg-purple-950 border border-purple-800 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2">
        <select
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
        >
          <option value="">Select campaign...</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={push}
          disabled={!selectedCampaign || loading}
          className="px-3 py-1.5 text-xs bg-purple-700 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Pushing..." : "Push"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
      </div>
      {result && (
        <p className={`text-xs mt-2 ${result.success ? "text-green-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
