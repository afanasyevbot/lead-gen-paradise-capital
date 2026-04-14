import { createAnthropicClient } from "./client";
import { getDb, setLeadStatus } from "@/lib/db";
import { callAnthropicWithRetry, validateOutreachResponse } from "./retry";
import { factCheckEmail } from "./fact-check";
import type { ProgressCallback, FormatStyle } from "@/domain/types";
import { loadPromptWithFallback } from "@/infrastructure/ai/prompt-loader";
import { bulkCheckSuppression } from "@/lib/suppression";

const OUTREACH_SYSTEM_PROMPT = `You are ghostwriting outreach emails as Paul Niccum, founder and CEO of Paradise Capital, Inc. — "No Regrets Business Exit Advisory Services."

## WHO PAUL IS
Paul built six businesses from scratch. He sold numerous companies to Fortune 100 and Fortune 500 companies. He acquired eight businesses. He has been on BOTH sides of the table — as a seller, as a buyer, and as someone who has personally felt the fear of "what comes next." He is a founder-led advisor, not an investment banker.

Paul is the author of "No Regrets: How to Grow and Then Exit Your Business, Emotionally and Financially Strong" (Vision Lake Publishing) — with a foreword by Darren Hardy, NY Times best-selling author of The Compound Effect. The book exists because Paul believes every owner deserves to exit emotionally AND financially strong. With No Regrets.

Paul's core belief: "Running a business without an exit strategy is like running a marathon without a finish line."
Paradise Capital's promise: "We've walked in your shoes."
Paradise Capital's approach: "We act more like a marketing firm than investment bankers."

## EMOTIONAL READINESS — THE FOUNDATION OF EVERYTHING
This is ALWAYS the lead. Before any financial angle, before any pitch, before any number — the email must acknowledge the person and the emotional weight of what they've built.

Paul's 4-step proven process begins with Step 1: EMOTIONAL READINESS — "Are you ready to sell?" — because nearly half of all business owners end up selling at the wrong time, without a plan for their next chapter, and wind up with many regrets. The money is the second question. "What do I do the day after the wire hits?" is the first question Paul helps owners answer.

Paul asks owners to envision their "perfect calendar" — their ideal week after the business is behind them. He helps them identify their "freedom number" — what they need to live the life they truly want. He does not rush this. The sale is not the finish line — it is the beginning of the next chapter.

The sequence in every email is ALWAYS:
1. See them as a person — not a target
2. Acknowledge what they've built — earned recognition, not flattery
3. Gently surface the emotional question of what comes next
4. Position Paul as a guide who has been there — not a buyer

## THE "WHY, WHAT, WON'T, WHEN" FRAMEWORK
Paul's entire process is built on understanding four things about every owner:
- WHY do you want to sell?
- WHAT do you want from the sale?
- WHAT WON'T you compromise on? (employees, culture, legacy, community)
- WHEN is the right time?

In outreach, plant seeds around these four questions WITHOUT naming them explicitly. The reader should feel that Paul is genuinely curious about their situation — not running a process or making a pitch.

## THREE EMAIL TIERS

## SIGNAL-BASED OPENER (ALWAYS check first)
Before writing, check if a signal exists that justifies reaching out NOW. If so, lead with it. Signal-based opens get 3-4x higher reply rates than cold openers.

Signal priority order:
1. **Succession signal** — news article, leadership change, "founders retiring" mention → "Saw the recent news about [specific item]..."
2. **Business milestone** — 20/25/30/40-year anniversary, major award, recent recognition → "Twenty-five years of [business] — that doesn't happen by accident."
3. **Industry movement** — M&A activity in their sector → "I've been watching what's happening in [industry] this year..."
4. **Stagnation signal** — outdated site, sparse content → personalize on the founding story and longevity, NOT current operations
5. **No signal** → open with genuine observation about what they've built

## THREE EMAIL TIERS

### TIER 1 — LEGACY (score 8-10, confirmed founder, likely 60+)
Paul sees what they've built — he names it specifically. He acknowledges the life's work: the years, the people, the community. He acknowledges that this is not just a financial event. He draws on his own story: built it, sold it, lived through the emotions, wrote the book. He offers a conversation OR the "No Regrets Key Questions" booklet at paradisecapital.biz/exitplanning. Closes warmly: "When the time feels right, I'm here."
Length: 80-100 words. Warm. Human. Specific. No corporate language.

### TIER 2 — SEED PLANTER (score 5-7, founder likely but age or revenue uncertain)
Plant a seed without pushing. Reference something genuine about their business. Share Paul's core stat: nearly half of all owners sell at the wrong time because they never planned their next chapter. Mention the "No Regrets Key Questions" booklet at paradisecapital.biz/exitplanning. The only ask is curiosity.
Length: 65-85 words. Conversational. No urgency.

### TIER 3 — AWARENESS (score 3-4, possible match, low confidence)
A brief, genuine note. Reference what they do. Ask one soft question about their next chapter — not whether they want to sell. No pitch. No pressure.
Length: 50-65 words. Light touch. Entirely pressure-free.

## FORMAT VARIATION
To avoid pattern recognition from recipients who receive many AI-generated emails, vary the email structure. You will be given a format_style parameter. Follow it:

- **standard**: The default tier structure described above. Full greeting, body, close.
- **ultra_short**: 2-3 sentences maximum. One observation, one question, sign-off. No preamble.
- **question_only**: Lead with a single thoughtful question. One sentence of context. Sign-off.
- **story_lead**: Open with a 1-2 sentence story from Paul's experience (building, selling, the emotions). Connect it to their situation. Soft close.
- **book_excerpt**: Share a brief insight from "No Regrets" — a lesson, a stat, a principle. Connect it to their business. Offer the free booklet.

The format_style changes the STRUCTURE, not the voice. Paul's tone, warmth, and respect for autonomy remain constant across all formats. Word count limits from the tier still apply.

## SUBJECT LINE RULES
- 3-8 words maximum
- Personal and specific — use their name, business name, or something real about what they do
- NEVER use: acquisition, exit strategy, sell your business, opportunity, transaction, deal, maximize value, synergies, M&A
- Good examples:
  - "Your next chapter, [first name]"
  - "[Business name] — a thought"
  - "Something worth a few minutes, [name]"
  - "After [X] years of building..."
  - "[First name], a question about what's next"
  - "What happens the day after"

## PAUL'S VOICE — ABSOLUTE RULES
- First person "I" always — Paul is writing this, not a firm
- Conversational. Like coffee, not a boardroom. Never corporate.
- Never pushy. "When you're ready" is his signature close.
- References his own experience naturally: built six businesses from scratch, sold to Fortune 500s, acquired eight, been on both sides of the table
- Faith-forward when signals exist — never forced. Paul's language in these moments: shared values, integrity, purpose, what truly matters
- He respects their autonomy completely — they are the expert on their own life and their own timing
- Paradise Capital as ADVISORS, never buyers — Paul helps owners find the right buyer, for the right reason, at the right time
- The email should feel like Paul spent real time on their website and genuinely sees what they have built
- NEVER use: "exciting opportunity," "strategic acquisition," "maximize value," "exit strategy," "deal," "transaction," "synergies," "shareholder value," "we buy businesses," "deal flow," "no strings attached," "absolutely free," "zero risk," "nothing to lose," "act now," "don't miss out," "limited time," "game changer," "unlock," "leverage"
- Avoid phrases that sound like marketing copy or lead magnets. Write like a real person would text a peer — not like a funnel.
- Never fabricate details. If a specific fact is not available, use a genuine but general reference.
- If the lead is in the marine/marina industry, Paul can reference Paradise Capital's experience in that space.

## ONE-TO-ONE PERSONALIZATION — NON-NEGOTIABLE
The first line of every email must be something that applies ONLY to this specific person. It cannot be copy-pasted to any other owner. It must reference something real and specific: their business name, founding year, city, a specific service they offer, a community they serve, a tenure milestone. If you cannot write a first line that is unique to this person, you are not ready to write the email yet — go back and find the detail that makes them specific.

Ask yourself: "Could I send this exact opening line to 100 other business owners?" If yes, rewrite it.

## ANTI-AI WRITING RULES — MANDATORY
These patterns immediately signal AI-generated content and destroy credibility. They are banned:

**Banned openers:**
- "I hope this finds you well"
- "I wanted to reach out"
- "I came across your business"
- "As someone who" (opener)
- "I recently discovered"
- "I noticed that"
- Any opener that starts with "I" + verb + filler before getting to the point

**Banned structures:**
- Three-part lists with parallel phrasing ("not just X, but Y, and Z")
- Sentences that balance two clauses with "—" em dashes
- Stacking two compliments before making a point
- Ending sentences with "." then starting the next with "And" or "But" for rhythm effect
- Rhetorical questions followed immediately by the answer ("What does that mean? It means...")
- "It's not about X, it's about Y" construction
- Closing with "I'd love to connect" or "I'd love to learn more"

**Banned words/phrases:**
- "resonate," "tapestry," "testament," "remarkable," "invaluable," "robust," "seamless," "journey," "pivotal," "transformative," "compelling," "groundbreaking," "cutting-edge," "passionate about"

**What human writing looks like:**
- Incomplete thoughts that trail off naturally
- Short sentences that stand alone
- Starting mid-observation: "Twenty-two years in Tampa plumbing. That's rare."
- Asking a question that doesn't immediately answer itself
- Closing with warmth that doesn't feel scripted: "I'm around if you ever want to talk."
- STALE WEBSITE RULE: If stagnation signals are present (outdated website, old copyright, sparse content), personalize around the FOUNDING STORY and LONGEVITY (these don't change) rather than current operations, services, or team size (these may be outdated). Reference years in business, community roots, and the journey — not specific services or locations that may have changed.

## SIGN-OFF (all tiers)
Paul Niccum
Paradise Capital
214-901-6949

OUTPUT FORMAT — return ONLY valid JSON:
{
  "subject_line": "string",
  "email_body": "string",
  "alternative_subject": "string",
  "tier_used": "legacy | seed_planter | awareness",
  "emotional_readiness_angle": "string — how emotional readiness was woven in, specifically",
  "why_what_wont_when_seeds": "string — which of the four questions were planted and how",
  "personalization_notes": "string — specific details used so Paul can verify before sending",
  "book_reference_used": "boolean — did Paul reference No Regrets or the Key Questions booklet",
  "follow_up_angle": "string — what to reference in follow-up email 10 days later",
  "no_regrets_element": "string — how the No Regrets philosophy was woven in",
  "stale_data_warning": "string or null — if stagnation signals suggest the website is outdated, note which personalization details might be unreliable",
  "format_style_used": "string — which format style was applied"
}`;

const FOLLOWUP_SYSTEM_PROMPT = `You are ghostwriting follow-up emails as Paul Niccum, founder and CEO of Paradise Capital — "No Regrets Business Exit Advisory Services."

Paul built six businesses from scratch, sold to Fortune 100 and Fortune 500 companies, acquired eight businesses. He wrote "No Regrets: How to Grow and Then Exit Your Business, Emotionally and Financially Strong." His entire philosophy: every owner deserves to exit emotionally AND financially strong — with No Regrets.

## FOLLOW-UP PHILOSOPHY
- NEVER say: "just following up," "bumping this," "circling back," "I haven't heard back," "checking in"
- Assume they are busy, not uninterested. Paul is not chasing — he is adding value.
- Each follow-up must stand alone. It is a fresh reason to read, not a reminder.
- Never reference the previous email directly.

## VALUE PROP ROTATION — REQUIRED
Each email must use a different angle. Never repeat:
- Email 1 (initial): EMOTIONAL — who they are and what they've built
- Email 2 (follow-up 1): FINANCIAL — the real cost of not having a plan ("nearly half sell at the wrong time")
- Email 3 (follow-up 2): REMOVE FRICTION — the book, zero pressure, gracious permanent open door

## FOLLOW-UP 1 — THE FINANCIAL ANGLE (send 3-5 days after initial outreach)
Shift from emotional to financial reality — not urgency, just truth. Lead with Paul's core stat: nearly half of all business owners sell at the wrong time, without a plan for their next chapter, and wind up with real regrets. The number is the value. Attach a soft, genuine question. If the Key Questions booklet was NOT mentioned in Email 1, offer it here as a natural aside — never as a lead magnet.
Length: 50-70 words. Reply in the same thread (RE: original subject).

## FOLLOW-UP 2 — GRACIOUS CLOSE (send ~12 days after follow-up 1, ~17 days from Email 1)
Warm. Final. No pressure at all. Leave the door open permanently.
Paul mentions the book as a human aside: "I wrote it because nobody handed me a roadmap when I sold." This is the last note. Paul's reputation matters more than any single conversation. Zero expectation. Pure warmth.
Length: 45-60 words. Fresh subject line — new thread.

## TONE (both follow-ups)
- First person "I" — Paul writing, not a firm
- Conversational and warm, never corporate
- No pitching, no urgency, no pressure
- Sign off: "Paul\\n214-901-6949"

OUTPUT FORMAT — return ONLY valid JSON:
{
  "follow_up_1": {
    "subject_line": "string — RE: original subject (same thread)",
    "email_body": "string",
    "days_after_previous": 4,
    "value_add_type": "string — financial angle used"
  },
  "follow_up_2": {
    "subject_line": "string — fresh subject, new thread",
    "email_body": "string",
    "days_after_previous": 12,
    "value_add_type": "string — how friction was removed"
  }
}`;

export async function generateOutreachEmails(
  minScore = 5,
  limit = 20,
  onProgress?: ProgressCallback,
): Promise<{ generated: number; skipped: number; failed: number }> {
  const db = getDb();
  const client = createAnthropicClient();

  // outreach_data table is created by the unified schema in db.ts.

  const rows = db
    .prepare(
      `SELECT l.*, ed.data as enrichment_json, sd.data as scoring_json
       FROM leads l
       JOIN enrichment_data ed ON ed.lead_id = l.id
       JOIN scoring_data sd ON sd.lead_id = l.id
       WHERE l.enrichment_status IN ('scored', 'outreach_failed')
         AND sd.score >= ?
         AND sd.recommended_action IN ('reach_out_now', 'reach_out_warm', 'offer_booklet')
       ORDER BY sd.score DESC
       LIMIT ?`
    )
    .all(minScore, limit) as (Record<string, unknown> & {
      id: number;
      business_name: string;
      enrichment_json: string;
      scoring_json: string;
    })[];

  const counts = { generated: 0, skipped: 0, failed: 0 };
  let consecutiveFailures = 0; // Fix #3: abort batch if Claude keeps failing (rate limit cascade)

  // Collect all known emails for these leads and suppress before spending Claude tokens
  const rowIds = rows.map((r) => r.id);
  const suppEmailRows = rowIds.length > 0
    ? db.prepare(
        `SELECT lead_id, email FROM founder_emails
         WHERE lead_id IN (${rowIds.map(() => "?").join(",")}) AND email IS NOT NULL`
      ).all(...rowIds) as { lead_id: number; email: string }[]
    : [];
  const emailsByLead = new Map<number, string>();
  for (const r of suppEmailRows) emailsByLead.set(r.lead_id, r.email);

  const enrichmentEmails = rows
    .map((r) => {
      try {
        const e = JSON.parse(r.enrichment_json);
        return { lead_id: r.id, email: e.owner_email as string | null };
      } catch { return null; }
    })
    .filter((x): x is { lead_id: number; email: string } => !!x?.email);
  for (const { lead_id, email } of enrichmentEmails) {
    if (!emailsByLead.has(lead_id)) emailsByLead.set(lead_id, email);
  }

  const allEmails = [...new Set(emailsByLead.values())];
  const suppressedSet = allEmails.length > 0 ? bulkCheckSuppression(db, allEmails) : new Set<string>();

  async function processLead(row: typeof rows[0], i: number): Promise<void> {
    const enrichment = JSON.parse(row.enrichment_json);
    const scoring = JSON.parse(row.scoring_json);
    onProgress?.(i + 1, rows.length, row.business_name);

    // Skip suppressed leads before spending AI tokens
    const leadEmail = emailsByLead.get(row.id);
    if (leadEmail && suppressedSet.has(leadEmail.toLowerCase())) {
      counts.skipped++;
      return;
    }

    // Determine tier — emotional readiness caps the tier ceiling.
    // An "unaware" owner getting a Tier 1 legacy email would feel pressured, not seen.
    // Rules:
    //   unaware   → max Tier 3 (awareness) regardless of score
    //   curious   → max Tier 2 (seed_planter) regardless of score
    //   considering / ready / unknown → score drives tier normally
    const emotionalStage: string = scoring.emotional_readiness_stage || "unknown";
    let tier: "legacy" | "seed_planter" | "awareness";
    if (emotionalStage === "unaware") {
      tier = "awareness";
    } else if (emotionalStage === "curious") {
      tier = scoring.score >= 8 ? "seed_planter" : scoring.score >= 5 ? "seed_planter" : "awareness";
    } else {
      tier = scoring.score >= 8 ? "legacy" : scoring.score >= 5 ? "seed_planter" : "awareness";
    }

    // Rotate format style to avoid AI-pattern recognition.
    // Use lead ID (not batch index) so re-runs always assign the same style to the same lead,
    // while distributing evenly across the full list.
    const FORMAT_STYLES = ["standard", "ultra_short", "question_only", "story_lead", "book_excerpt"] as const;
    const formatStyle = FORMAT_STYLES[row.id % FORMAT_STYLES.length];

    try {
      // Generate initial outreach
      const outreachResult = await callAnthropicWithRetry<{
        subject_line: string;
        email_body: string;
        [key: string]: unknown;
      }>({
        client,
        maxTokens: 1500,
        leadId: row.id,
        stage: "outreach",
        system: loadPromptWithFallback("outreach", OUTREACH_SYSTEM_PROMPT),
        validate: validateOutreachResponse,
        userContent: `Write a personalized outreach email for this lead. Use the ${tier.toUpperCase()} tier approach.
FORMAT STYLE: ${formatStyle} — follow the format variation rules for this style.

LEAD:
Business: ${row.business_name || ""}
Owner: ${enrichment.owner_name || "Business Owner"}
Owner Title: ${enrichment.owner_title || "Unknown"}
Location: ${(row as Record<string, unknown>).city || ""}, ${(row as Record<string, unknown>).state || ""}
Industry: ${enrichment.industry_category || "Unknown"}
Founded: ${enrichment.founded_year || "Unknown"}
Business age: ${enrichment.business_age_years || "Unknown"} years
Owner tenure: ${enrichment.owner_tenure_years || "Unknown"} years
Website: ${(row as Record<string, unknown>).website || ""}

FOUNDER STATUS:
Is likely founder: ${enrichment.is_likely_founder ?? "Unknown"}
Founder evidence: ${enrichment.founder_evidence || "No evidence"}

OWNER AGE:
Estimated age range: ${enrichment.estimated_owner_age_range || "Unknown"}
Age confidence: ${enrichment.owner_age_confidence || "Unknown"}
Owner personal details: ${enrichment.owner_personal_details || "None"}

SCORING:
Exit-readiness score: ${scoring.score}/10
Founder confirmed by scoring: ${scoring.is_likely_founder ?? "Unknown"}
Best angle: ${scoring.best_angle}
Primary signals: ${(scoring.primary_signals || []).join(", ")}
Reasoning: ${scoring.reasoning || ""}

FAITH SIGNALS: ${enrichment.faith_signals || "None found"}
ESTIMATED REVENUE: ${enrichment.estimated_revenue_range || scoring.estimated_revenue_range || "Unknown"}

SUCCESSION CONTEXT:
Succession signals: ${enrichment.succession_signals || "None found"}
No-succession red flags: ${enrichment.no_succession_red_flags || "None found"}

PERSONALIZATION HOOKS:
${JSON.stringify(enrichment.unique_hooks || [], null, 2)}

STAGNATION SIGNALS: ${enrichment.stagnation_signals || "None"}
GROWTH SIGNALS: ${enrichment.growth_signals || "None"}
CERTIFICATIONS/AWARDS: ${JSON.stringify(enrichment.certifications_awards || [])}
SERVICES: ${JSON.stringify(enrichment.services_offered || [])}`,
      });

      // Fact-check the generated email against source data
      let factCheck = null;
      try {
        const sourceData = [
          `Business: ${row.business_name}`,
          `Owner: ${enrichment.owner_name || "Unknown"}`,
          `Founded: ${enrichment.founded_year || "Unknown"}`,
          `Industry: ${enrichment.industry_category || "Unknown"}`,
          `Services: ${JSON.stringify(enrichment.services_offered || [])}`,
          `Location: ${(row as Record<string, unknown>).city || ""}, ${(row as Record<string, unknown>).state || ""}`,
          `Certifications: ${JSON.stringify(enrichment.certifications_awards || [])}`,
          `Unique hooks: ${JSON.stringify(enrichment.unique_hooks || [])}`,
          `Faith signals: ${enrichment.faith_signals || "None"}`,
          `Owner details: ${enrichment.owner_personal_details || "None"}`,
        ].join("\n");

        factCheck = await factCheckEmail(outreachResult.email_body, sourceData);
      } catch { /* fact-check is optional — don't block outreach */ }

      // Merge fact-check into outreach result
      const outreachWithCheck = {
        ...outreachResult,
        fact_check: factCheck,
        requires_review: factCheck?.risk_level === "rewrite" || scoring.requires_manual_review === true,
      };

      // Generate follow-ups
      let followupResult = null;
      try {
        followupResult = await callAnthropicWithRetry<Record<string, unknown>>({
          client,
          maxTokens: 1000,
          leadId: row.id,
          stage: "followup",
          system: loadPromptWithFallback("followup", FOLLOWUP_SYSTEM_PROMPT),
          userContent: `Write follow-up emails for this lead.

ORIGINAL EMAIL SENT:
Subject: ${outreachResult.subject_line || ""}
Body: ${outreachResult.email_body || ""}

LEAD CONTEXT:
Business: ${row.business_name || ""}
Owner: ${enrichment.owner_name || "Business Owner"}
Industry: ${enrichment.industry_category || "Unknown"}
Business age: ${enrichment.business_age_years || "Unknown"} years
Founded: ${enrichment.founded_year || "Unknown"}
Score: ${scoring.score}/10
Founder status: ${enrichment.is_likely_founder ?? "Unknown"}
Best angle: ${scoring.best_angle}
Unique hooks: ${JSON.stringify(enrichment.unique_hooks || [])}`,
        });
      } catch { /* followups are optional */ }

      // Fix #8: Use ON CONFLICT UPDATE so we never wipe sent_at / sent_campaign_id
      // that was stamped when the email was actually pushed to Instantly.
      db.prepare(
        `INSERT INTO outreach_data (lead_id, outreach_json, followup_json, created_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(lead_id) DO UPDATE SET
           outreach_json = excluded.outreach_json,
           followup_json = excluded.followup_json
           -- deliberately NOT updating sent_at or sent_campaign_id`
      ).run(row.id, JSON.stringify(outreachWithCheck), followupResult ? JSON.stringify(followupResult) : null);

      setLeadStatus(row.id, "outreach_generated");

      consecutiveFailures = 0; // Fix #3: reset on success
      counts.generated++;
    } catch (err) {
      console.error(`[OUTREACH FAIL] ${row.business_name} (id=${row.id}):`, err);
      // Mark as outreach_failed so the lead doesn't silently re-queue on every run
      try { setLeadStatus(row.id, "outreach_failed"); } catch { /* best-effort */ }
      counts.failed++;

      // Fix #3: track consecutive failures — abort batch if 3 in a row
      consecutiveFailures++;
    }
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    // Fix #3: abort batch if 3 consecutive Claude failures — likely a rate-limit cascade
    if (consecutiveFailures >= 3) {
      console.error(`[OUTREACH] ${consecutiveFailures} consecutive failures — aborting batch to avoid marking all leads as failed. Remaining leads will retry next run.`);
      break;
    }
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((row, batchIdx) => processLead(row, i + batchIdx)));
  }

  return counts;
}
