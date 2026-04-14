import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");

  if (leadId) {
    const outcomes = db.prepare(
      "SELECT * FROM outreach_outcomes WHERE lead_id = ? ORDER BY created_at DESC"
    ).all(Number(leadId));
    return NextResponse.json({ outcomes });
  }

  // Summary stats
  const summary = db.prepare(`
    SELECT outcome, COUNT(*) as count,
           AVG(score_at_send) as avg_score,
           tier_used, COUNT(*) as tier_count
    FROM outreach_outcomes
    GROUP BY outcome
  `).all();

  const byTier = db.prepare(`
    SELECT tier_used, outcome, COUNT(*) as count
    FROM outreach_outcomes
    WHERE tier_used IS NOT NULL
    GROUP BY tier_used, outcome
  `).all();

  return NextResponse.json({ summary, by_tier: byTier });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lead_id, outcome, tier_used, score_at_send, notes, outcome_date } = body as {
      lead_id: number;
      outcome: string;
      tier_used?: string;
      score_at_send?: number;
      notes?: string;
      outcome_date?: string;
    };

    if (!lead_id || !outcome) {
      return NextResponse.json(
        { error: "lead_id and outcome are required" },
        { status: 400 },
      );
    }

    const validOutcomes = [
      "no_response", "opened", "replied_positive", "replied_negative",
      "meeting_booked", "unsubscribed", "bounced",
    ];
    if (!validOutcomes.includes(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${validOutcomes.join(", ")}` },
        { status: 400 },
      );
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO outreach_outcomes (lead_id, outcome, tier_used, score_at_send, notes, outcome_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(lead_id, outcome, tier_used || null, score_at_send || null, notes || null, outcome_date || null);

    // Auto-suppress on unsubscribe or bounce
    if (outcome === "unsubscribed" || outcome === "bounced") {
      const enrichment = db.prepare(
        "SELECT data FROM enrichment_data WHERE lead_id = ?"
      ).get(lead_id) as { data: string } | undefined;

      if (enrichment) {
        const parsed = JSON.parse(enrichment.data);
        if (parsed.owner_email) {
          const { createSuppressionTable, addToSuppressionList } = await import("@/lib/suppression");
          createSuppressionTable(db);
          addToSuppressionList(db, parsed.owner_email, outcome, "outcome_tracking");
        }
      }
    }

    return NextResponse.json({ success: true, lead_id, outcome });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
