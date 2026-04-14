# Lead Gen Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 real-world safeguards to the Paradise Capital lead gen system — covering compliance, data quality, accuracy verification, feedback loops, and format variation.

**Architecture:** New database tables (suppression_list, outreach_outcomes) created in db.ts. New modules for suppression checking and fact-checking. Modifications to scoring prompt (age/revenue confidence penalties), outreach pipeline (manual review gate, format variation, fact-check step, suppression check), Instantly push route (suppression filter), LinkedIn scraper (quality tracking), and validation (new action type). UI changes to lead detail page for warnings/review status.

**Tech Stack:** TypeScript, better-sqlite3, Next.js App Router, Anthropic Claude API, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/db.ts` | Modify (lines 19-98) | Add `suppression_list` and `outreach_outcomes` tables to `createTables` |
| `src/lib/suppression.ts` | Create | Suppression list CRUD: check, add, bulk check, sync-from-instantly stub |
| `src/lib/enrichment/score.ts` | Modify (lines 5-112) | Add age/revenue confidence penalty rules to SYSTEM_PROMPT; add `requires_manual_review` to JSON output |
| `src/lib/enrichment/outreach.ts` | Modify (lines 5-94, 143-289) | Add format_style to prompt + generation; add `offer_booklet` to query filter; add fact-check step; add suppression check |
| `src/lib/enrichment/fact-check.ts` | Create | Second Claude call to verify outreach claims against source data |
| `src/lib/enrichment/validate.ts` | Modify (lines 136-182) | Add `offer_booklet` to valid recommended_actions |
| `src/lib/instantly.ts` | Modify (lines 172-225) | No changes needed — suppression happens at push route level |
| `src/app/api/instantly/push/route.ts` | Modify (lines 11-97) | Add suppression list check before push |
| `src/app/api/suppression/route.ts` | Create | API route for managing suppression list (GET, POST, DELETE) |
| `src/app/api/outcomes/route.ts` | Create | API route for logging outreach outcomes |
| `src/lib/scraper/linkedin.ts` | Modify | Add `data_quality` field to linkedin_data inserts |
| `src/__tests__/suppression.test.ts` | Create | Tests for suppression list module |
| `src/__tests__/fact-check.test.ts` | Create | Tests for fact-check module |
| `src/__tests__/validate.test.ts` | Modify | Add test for `offer_booklet` action |

---

### Task 1: Suppression List Table + Module (#4 — Compliance Safety Net)

**Files:**
- Modify: `src/lib/db.ts:19-98`
- Create: `src/lib/suppression.ts`
- Test: `src/__tests__/suppression.test.ts`

- [ ] **Step 1: Write the failing tests for suppression module**

```typescript
// src/__tests__/suppression.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSuppressionTable,
  isEmailSuppressed,
  addToSuppressionList,
  bulkCheckSuppression,
  getSuppressionList,
  removeFromSuppressionList,
} from "@/lib/suppression";

function freshDb() {
  const db = new Database(":memory:");
  createSuppressionTable(db);
  return db;
}

describe("suppression list", () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it("returns false for email not in list", () => {
    expect(isEmailSuppressed(db, "clean@example.com")).toBe(false);
  });

  it("returns true after adding email", () => {
    addToSuppressionList(db, "bad@example.com", "unsubscribed", "manual");
    expect(isEmailSuppressed(db, "bad@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    addToSuppressionList(db, "Bad@Example.COM", "bounced", "instantly_sync");
    expect(isEmailSuppressed(db, "bad@example.com")).toBe(true);
  });

  it("bulk checks multiple emails", () => {
    addToSuppressionList(db, "blocked@test.com", "complained", "manual");
    const result = bulkCheckSuppression(db, ["clean@test.com", "blocked@test.com", "also-clean@test.com"]);
    expect(result).toEqual(new Set(["blocked@test.com"]));
  });

  it("lists all suppressed entries", () => {
    addToSuppressionList(db, "a@test.com", "unsubscribed", "manual");
    addToSuppressionList(db, "b@test.com", "bounced", "instantly_sync");
    const list = getSuppressionList(db);
    expect(list).toHaveLength(2);
    expect(list[0].email).toBe("a@test.com");
  });

  it("removes an email from the list", () => {
    addToSuppressionList(db, "removeme@test.com", "manual", "manual");
    removeFromSuppressionList(db, "removeme@test.com");
    expect(isEmailSuppressed(db, "removeme@test.com")).toBe(false);
  });

  it("does not duplicate on re-add", () => {
    addToSuppressionList(db, "dupe@test.com", "bounced", "instantly_sync");
    addToSuppressionList(db, "dupe@test.com", "unsubscribed", "manual");
    const list = getSuppressionList(db);
    const dupes = list.filter((e) => e.email === "dupe@test.com");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].reason).toBe("unsubscribed"); // updated to latest reason
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/matthewafanasiev/Downloads/paradise-capital/web && npx vitest run src/__tests__/suppression.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the suppression module**

```typescript
// src/lib/suppression.ts
import type Database from "better-sqlite3";

export function createSuppressionTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppression_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function isEmailSuppressed(db: Database.Database, email: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM suppression_list WHERE LOWER(email) = LOWER(?)"
  ).get(email);
  return !!row;
}

export function addToSuppressionList(
  db: Database.Database,
  email: string,
  reason: string,
  source: string,
): void {
  db.prepare(`
    INSERT INTO suppression_list (email, reason, source, created_at, updated_at)
    VALUES (LOWER(?), ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(email) DO UPDATE SET reason = ?, source = ?, updated_at = datetime('now')
  `).run(email, reason, source, reason, source);
}

export function bulkCheckSuppression(
  db: Database.Database,
  emails: string[],
): Set<string> {
  if (emails.length === 0) return new Set();
  const suppressed = new Set<string>();
  // Check in batches to avoid SQLite variable limits
  const BATCH = 500;
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT email FROM suppression_list WHERE LOWER(email) IN (${placeholders})`
    ).all(...batch.map(e => e.toLowerCase())) as { email: string }[];
    for (const row of rows) suppressed.add(row.email);
  }
  return suppressed;
}

export function getSuppressionList(
  db: Database.Database,
): { email: string; reason: string; source: string; created_at: string }[] {
  return db.prepare(
    "SELECT email, reason, source, created_at FROM suppression_list ORDER BY created_at ASC"
  ).all() as { email: string; reason: string; source: string; created_at: string }[];
}

export function removeFromSuppressionList(db: Database.Database, email: string): void {
  db.prepare("DELETE FROM suppression_list WHERE LOWER(email) = LOWER(?)").run(email);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/matthewafanasiev/Downloads/paradise-capital/web && npx vitest run src/__tests__/suppression.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Add suppression_list and outreach_outcomes tables to db.ts createTables**

In `src/lib/db.ts`, add after the `linkedin_data` CREATE TABLE block (after line 97):

```sql
    CREATE TABLE IF NOT EXISTS suppression_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      outreach_data_id INTEGER,
      outcome TEXT NOT NULL,
      tier_used TEXT,
      score_at_send INTEGER,
      notes TEXT,
      outcome_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/suppression.ts src/__tests__/suppression.test.ts src/lib/db.ts
git commit -m "feat: add suppression list table and module with tests"
```

---

### Task 2: Suppression Check in Instantly Push Route (#4 continued)

**Files:**
- Modify: `src/app/api/instantly/push/route.ts:55-76`

- [ ] **Step 1: Add suppression filtering to the push route**

In `src/app/api/instantly/push/route.ts`, add import at top:

```typescript
import { createSuppressionTable, bulkCheckSuppression } from "@/lib/suppression";
```

Then modify the loop at lines 55-76. After the existing `for (const row of rows)` loop that builds `instantlyLeads` and `skipped`, add a suppression filter before the `pushLeadsBulk` call:

```typescript
    // Check suppression list
    createSuppressionTable(db);
    const allEmails = instantlyLeads.map(l => l.email);
    const suppressedEmails = bulkCheckSuppression(db, allEmails);

    const suppressed: { email: string; reason: string }[] = [];
    const cleanLeads = instantlyLeads.filter(l => {
      if (suppressedEmails.has(l.email.toLowerCase())) {
        suppressed.push({ email: l.email, reason: "Email on suppression list" });
        return false;
      }
      return true;
    });

    if (cleanLeads.length === 0) {
      return NextResponse.json({
        success: false,
        error: "All leads with emails are on the suppression list",
        skipped,
        suppressed,
      }, { status: 400 });
    }

    const result = await pushLeadsBulk(campaignId, cleanLeads);

    return NextResponse.json({
      ...result,
      skipped,
      suppressed,
      total_requested: leadIds.length,
      total_with_email: instantlyLeads.length,
      total_after_suppression: cleanLeads.length,
    });
```

Replace the existing `pushLeadsBulk` call and its return statement (lines 86-93) with this block.

- [ ] **Step 2: Verify the route compiles**

Run: `cd /Users/matthewafanasiev/Downloads/paradise-capital/web && npx tsc --noEmit src/app/api/instantly/push/route.ts 2>&1 || echo "Type check done"`
Note: This may require full project type check. Alternatively: `npx next build --no-lint 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/instantly/push/route.ts
git commit -m "feat: filter suppressed emails before pushing to Instantly"
```

---

### Task 3: Suppression List API Route (#4 continued)

**Files:**
- Create: `src/app/api/suppression/route.ts`

- [ ] **Step 1: Create the suppression API route**

```typescript
// src/app/api/suppression/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createSuppressionTable,
  addToSuppressionList,
  getSuppressionList,
  removeFromSuppressionList,
} from "@/lib/suppression";

export async function GET() {
  const db = getDb();
  createSuppressionTable(db);
  const list = getSuppressionList(db);
  return NextResponse.json({ suppression_list: list, total: list.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, reason, source } = body as {
      email: string;
      reason: string;
      source?: string;
    };

    if (!email || !reason) {
      return NextResponse.json(
        { error: "email and reason are required" },
        { status: 400 },
      );
    }

    const db = getDb();
    createSuppressionTable(db);
    addToSuppressionList(db, email, reason, source || "manual");

    return NextResponse.json({ success: true, email, reason });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body as { email: string };

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const db = getDb();
    createSuppressionTable(db);
    removeFromSuppressionList(db, email);

    return NextResponse.json({ success: true, removed: email });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/suppression/route.ts
git commit -m "feat: add suppression list API route (GET/POST/DELETE)"
```

---

### Task 4: Outreach Outcomes Table + API Route (#10 — Feedback Loop)

**Files:**
- Create: `src/app/api/outcomes/route.ts`

- [ ] **Step 1: Create the outcomes API route**

```typescript
// src/app/api/outcomes/route.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/outcomes/route.ts
git commit -m "feat: add outreach outcomes API with auto-suppression on unsubscribe/bounce"
```

---

### Task 5: Manual Review Gate in Scoring (#1 — Wrong Person, Right Business)

**Files:**
- Modify: `src/lib/enrichment/score.ts:5-112` (SYSTEM_PROMPT)

- [ ] **Step 1: Add `requires_manual_review` and `founder_confidence_detail` to scoring prompt JSON output**

In `src/lib/enrichment/score.ts`, inside the SYSTEM_PROMPT, add these two fields to the JSON output block (before the closing `}`):

```
  "requires_manual_review": "boolean — TRUE if founder evidence is circumstantial (name match only, title only, no first-person founding story). TRUE if owner_age_confidence is 'low' and estimated age would affect tier. FALSE only when founder status is confirmed by explicit evidence (first-person founding story, 'Founded by' with matching name, Founder title + founding year). When in doubt, set TRUE — Paul reviewing a strong lead costs 30 seconds, sending a wrong email costs the relationship.",
  "review_reason": "string or null — if requires_manual_review is true, explain what Paul should verify: e.g. 'Founder status inferred from name match only — confirm they started the business' or 'Age estimated from founding year alone — could be off by 10+ years'"
```

- [ ] **Step 2: Add age confidence penalty and revenue confidence to scoring prompt CRITICAL WEIGHTING section**

In the CRITICAL WEIGHTING section, add after the existing age rules:

```
- AGE CONFIDENCE PENALTY: If owner_age_confidence is "low," reduce the age bonus to +0 regardless of estimated age. Do not award +1 or +2 for an age estimate you are not confident about.
- REVENUE CONFIDENCE: If revenue estimation relies on a single weak indicator (e.g., just "seems established"), do not apply the +1 revenue bonus. Only apply when multiple revenue signals converge (employee count + locations, or fleet size + regional presence).
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrichment/score.ts
git commit -m "feat: add manual review gate and confidence penalties to scoring prompt"
```

---

### Task 6: Stale Website Warning in Outreach Prompt (#5 — Stale Data)

**Files:**
- Modify: `src/lib/enrichment/outreach.ts:5-94` (OUTREACH_SYSTEM_PROMPT)

- [ ] **Step 1: Add stale data rule to PAUL'S VOICE section of OUTREACH_SYSTEM_PROMPT**

In the OUTREACH_SYSTEM_PROMPT, in the "PAUL'S VOICE — ABSOLUTE RULES" section, add:

```
- STALE WEBSITE RULE: If stagnation signals are present (outdated website, old copyright, sparse content), personalize around the FOUNDING STORY and LONGEVITY (these don't change) rather than current operations, services, or team size (these may be outdated). Reference years in business, community roots, and the journey — not specific services or locations that may have changed.
```

Add a new field to the JSON output:

```
  "stale_data_warning": "string or null — if stagnation signals suggest the website is outdated, note which personalization details might be unreliable"
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrichment/outreach.ts
git commit -m "feat: add stale website personalization rule to outreach prompt"
```

---

### Task 7: Fact-Check Module (#6 — Claude Hallucination Prevention)

**Files:**
- Create: `src/lib/enrichment/fact-check.ts`
- Test: `src/__tests__/fact-check.test.ts`
- Modify: `src/lib/enrichment/outreach.ts:191-244` (add fact-check call after outreach generation)

- [ ] **Step 0: Write fact-check tests**

```typescript
// src/__tests__/fact-check.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic client and retry module
vi.mock("@/lib/enrichment/client", () => ({
  createAnthropicClient: () => ({}),
}));

const mockRetry = vi.fn();
vi.mock("@/lib/enrichment/retry", () => ({
  callAnthropicWithRetry: (...args: unknown[]) => mockRetry(...args),
}));

import { factCheckEmail } from "@/lib/enrichment/fact-check";

describe("factCheckEmail", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns safe when all claims verified", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: true,
      claims: [{ claim: "Founded in 1992", found_in_source: true, source_text: "Founded in 1992" }],
      unverified_claims: [],
      risk_level: "safe",
    });
    const result = await factCheckEmail("Founded in 1992", "Business founded in 1992");
    expect(result.risk_level).toBe("safe");
    expect(result.all_claims_verified).toBe(true);
  });

  it("returns rewrite when claims are fabricated", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: false,
      claims: [{ claim: "Won 2023 Industry Award", found_in_source: false, source_text: null }],
      unverified_claims: ["Won 2023 Industry Award"],
      risk_level: "rewrite",
    });
    const result = await factCheckEmail("Won 2023 Industry Award", "No awards mentioned");
    expect(result.risk_level).toBe("rewrite");
    expect(result.unverified_claims).toContain("Won 2023 Industry Award");
  });

  it("calls Claude with email body and source data", async () => {
    mockRetry.mockResolvedValueOnce({
      all_claims_verified: true, claims: [], unverified_claims: [], risk_level: "safe",
    });
    await factCheckEmail("test email body", "test source data");
    expect(mockRetry).toHaveBeenCalledTimes(1);
    const callArgs = mockRetry.mock.calls[0][0];
    expect(callArgs.userContent).toContain("test email body");
    expect(callArgs.userContent).toContain("test source data");
  });
});
```

- [ ] **Step 0b: Run test to verify it fails**

Run: `cd /Users/matthewafanasiev/Downloads/paradise-capital/web && npx vitest run src/__tests__/fact-check.test.ts`
Expected: FAIL — module not found

- [ ] **Step 1: Write the fact-check module**

```typescript
// src/lib/enrichment/fact-check.ts
import { createAnthropicClient } from "./client";
import { callAnthropicWithRetry } from "./retry";

const FACT_CHECK_PROMPT = `You are a fact-checker for outreach emails. You will be given an email draft and the source data it was written from. Your job is to verify every specific claim in the email against the source data.

For each specific claim (a name, year, number, location, service, award, or any concrete detail), check if it appears in the source data.

Return ONLY valid JSON:
{
  "all_claims_verified": boolean,
  "claims": [
    {
      "claim": "string — the specific detail from the email",
      "found_in_source": boolean,
      "source_text": "string or null — the matching text from source data, or null if not found"
    }
  ],
  "unverified_claims": ["string — claims that could not be found in the source data"],
  "risk_level": "safe | review | rewrite — safe if all verified, review if 1 unverified non-critical claim, rewrite if any fabricated core detail"
}`;

export interface FactCheckResult {
  all_claims_verified: boolean;
  claims: { claim: string; found_in_source: boolean; source_text: string | null }[];
  unverified_claims: string[];
  risk_level: "safe" | "review" | "rewrite";
}

export async function factCheckEmail(
  emailBody: string,
  sourceData: string,
): Promise<FactCheckResult> {
  const client = createAnthropicClient();
  return callAnthropicWithRetry<FactCheckResult>({
    client,
    maxTokens: 800,
    system: FACT_CHECK_PROMPT,
    userContent: `EMAIL DRAFT:\n${emailBody}\n\nSOURCE DATA:\n${sourceData}`,
  });
}
```

- [ ] **Step 2: Integrate fact-check into outreach generation**

In `src/lib/enrichment/outreach.ts`, add import at top:

```typescript
import { factCheckEmail } from "./fact-check";
```

After the outreach result is generated (after line 244), add the fact-check call. Modify the block that stores the result to include fact-check data:

```typescript
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
```

Then update the db.prepare INSERT to use `outreachWithCheck` instead of `outreachResult`:

```typescript
      db.prepare(
        `INSERT OR REPLACE INTO outreach_data (lead_id, outreach_json, followup_json, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).run(row.id, JSON.stringify(outreachWithCheck), followupResult ? JSON.stringify(followupResult) : null);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrichment/fact-check.ts src/lib/enrichment/outreach.ts
git commit -m "feat: add fact-check step to outreach pipeline to catch hallucinated details"
```

---

### Task 8: Format Variation in Outreach (#7 — AI Pattern Recognition)

**Files:**
- Modify: `src/lib/enrichment/outreach.ts:5-94` (OUTREACH_SYSTEM_PROMPT)
- Modify: `src/lib/enrichment/outreach.ts:188-201` (tier/format assignment + user content)

- [ ] **Step 1: Add FORMAT VARIATION section to OUTREACH_SYSTEM_PROMPT**

After the "THREE EMAIL TIERS" section and before "SUBJECT LINE RULES", add:

```
## FORMAT VARIATION
To avoid pattern recognition from recipients who receive many AI-generated emails, vary the email structure. You will be given a format_style parameter. Follow it:

- **standard**: The default tier structure described above. Full greeting, body, close.
- **ultra_short**: 2-3 sentences maximum. One observation, one question, sign-off. No preamble.
- **question_only**: Lead with a single thoughtful question. One sentence of context. Sign-off.
- **story_lead**: Open with a 1-2 sentence story from Paul's experience (building, selling, the emotions). Connect it to their situation. Soft close.
- **book_excerpt**: Share a brief insight from "No Regrets" — a lesson, a stat, a principle. Connect it to their business. Offer the free booklet.

The format_style changes the STRUCTURE, not the voice. Paul's tone, warmth, and respect for autonomy remain constant across all formats. Word count limits from the tier still apply.
```

- [ ] **Step 2: Add format_style selection and pass it in the user content**

In `src/lib/enrichment/outreach.ts`, after the tier determination (line 189), add:

```typescript
    // Rotate format style to avoid AI-pattern recognition
    const FORMAT_STYLES = ["standard", "ultra_short", "question_only", "story_lead", "book_excerpt"] as const;
    const formatStyle = FORMAT_STYLES[i % FORMAT_STYLES.length];
```

Then in the userContent string (line 201), add after the tier line:

```
FORMAT STYLE: ${formatStyle} — follow the format variation rules for this style.
```

Add `format_style` to the JSON output spec in the OUTREACH_SYSTEM_PROMPT:

```
  "format_style_used": "string — which format style was applied"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrichment/outreach.ts
git commit -m "feat: add rotating format variation to outreach emails"
```

---

### Task 9: Update Outreach Query to Include `offer_booklet` Leads (#3/scoring update)

**Files:**
- Modify: `src/lib/enrichment/outreach.ts:161-171` (query)
- Modify: `src/lib/enrichment/validate.ts:163` (valid actions list)

- [ ] **Step 1: Update the outreach query to also include `offer_booklet` leads**

In `src/lib/enrichment/outreach.ts`, modify the SQL WHERE clause at line 169:

Change:
```sql
AND sd.recommended_action IN ('reach_out_now', 'reach_out_warm')
```
To:
```sql
AND sd.recommended_action IN ('reach_out_now', 'reach_out_warm', 'offer_booklet')
```

- [ ] **Step 2: Update validation to accept `offer_booklet`**

In `src/lib/enrichment/validate.ts` line 163, change:

```typescript
  const validActions = ["reach_out_now", "reach_out_warm", "monitor", "skip"];
```
To:
```typescript
  const validActions = ["reach_out_now", "reach_out_warm", "offer_booklet", "monitor", "skip"];
```

- [ ] **Step 3: Add test for new valid action**

In `src/__tests__/validate.test.ts`, add a test in the `validateScoringData` describe block:

```typescript
  it("accepts offer_booklet as a valid recommended_action", () => {
    const result = validateScoringData({
      score: 5,
      confidence: "medium",
      recommended_action: "offer_booklet",
      best_angle: "Test angle",
      primary_signals: ["founder likely"],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.filter(w => w.includes("recommended_action"))).toHaveLength(0);
  });
```

- [ ] **Step 4: Run validation tests**

Run: `cd /Users/matthewafanasiev/Downloads/paradise-capital/web && npx vitest run src/__tests__/validate.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrichment/outreach.ts src/lib/enrichment/validate.ts src/__tests__/validate.test.ts
git commit -m "feat: include offer_booklet leads in outreach pipeline and validation"
```

---

### Task 10: LinkedIn Data Quality Tracking (#9 — LinkedIn Scraping Reliability)

**Files:**
- Modify: `src/lib/db.ts:89-97`
- Modify: `src/lib/scraper/linkedin.ts:157-167` (CREATE TABLE) and `src/lib/scraper/linkedin.ts:266-276` (INSERT)

**IMPORTANT:** The `linkedin_data` table schema is defined in TWO places — `db.ts` (lines 89-97) and `linkedin.ts` (lines 157-167). Both must be updated.

- [ ] **Step 1: Add columns to linkedin_data in db.ts (lines 89-97)**

In `src/lib/db.ts`, change the CREATE TABLE for linkedin_data to:

```sql
    CREATE TABLE IF NOT EXISTS linkedin_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      linkedin_url TEXT,
      owner_name_from_linkedin TEXT,
      owner_title_from_linkedin TEXT,
      linkedin_headline TEXT,
      rate_limited INTEGER DEFAULT 0,
      data_quality TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL
    );
```

- [ ] **Step 2: Add same columns to linkedin_data CREATE TABLE in linkedin.ts (lines 157-167)**

In `src/lib/scraper/linkedin.ts`, change the CREATE TABLE at lines 157-167 to match:

```sql
    CREATE TABLE IF NOT EXISTS linkedin_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER UNIQUE NOT NULL REFERENCES leads(id),
      linkedin_url TEXT,
      owner_name_from_linkedin TEXT,
      owner_title_from_linkedin TEXT,
      linkedin_headline TEXT,
      rate_limited INTEGER DEFAULT 0,
      data_quality TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL
    )
```

- [ ] **Step 3: Track rate-limit state and update INSERT in linkedin.ts**

Add a `let batchRateLimited = false;` variable before the `for` loop at line 205. When rate_limited is detected (line 230), set `batchRateLimited = true;`.

Then change the INSERT at lines 266-276 from:

```typescript
        db.prepare(
          `INSERT OR REPLACE INTO linkedin_data
           (lead_id, linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, linkedin_headline, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          row.id,
          result.linkedin_url,
          result.owner_name_from_linkedin,
          result.owner_title_from_linkedin,
          result.linkedin_headline,
        );
```

To:

```typescript
        const dataQuality = !result.linkedin_url
          ? "not_found"
          : batchRateLimited
            ? "degraded_rate_limited"
            : "normal";

        db.prepare(
          `INSERT OR REPLACE INTO linkedin_data
           (lead_id, linkedin_url, owner_name_from_linkedin, owner_title_from_linkedin, linkedin_headline, rate_limited, data_quality, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          row.id,
          result.linkedin_url,
          result.owner_name_from_linkedin,
          result.owner_title_from_linkedin,
          result.linkedin_headline,
          batchRateLimited ? 1 : 0,
          dataQuality,
        );
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/lib/scraper/linkedin.ts
git commit -m "feat: track LinkedIn data quality for degraded-rate-limit detection"
```

---

### Task 11: Lead Detail UI — Review Warnings + Outcome Logging

**Files:**
- Modify: `src/app/leads/[id]/page.tsx`

This is the largest UI task. Add four things to the lead detail page:

- [ ] **Step 0: Update LeadDetail TypeScript interface**

In `src/app/leads/[id]/page.tsx`, update the `scoring` type (lines 24-32) to add:

```typescript
    requires_manual_review?: boolean;
    review_reason?: string | null;
```

Update the `outreach` type (lines 40-46) to add:

```typescript
    requires_review?: boolean;
    stale_data_warning?: string | null;
    fact_check?: {
      all_claims_verified: boolean;
      unverified_claims: string[];
      risk_level: string;
    } | null;
    tier_used?: string;
    format_style_used?: string;
```

- [ ] **Step 1: Add review warning banner**

In `src/app/leads/[id]/page.tsx`, after the scoring section renders, add a conditional warning banner. Check `lead.outreach?.requires_review` or `lead.scoring?.requires_manual_review`:

```tsx
{(lead.scoring?.requires_manual_review || lead.outreach?.requires_review) && (
  <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4 mb-4">
    <h3 className="text-yellow-400 font-semibold text-sm mb-1">Manual Review Required</h3>
    <p className="text-yellow-200/80 text-sm">
      {lead.scoring?.review_reason || "Founder status or age estimate has low confidence. Paul should verify before sending."}
    </p>
    {lead.outreach?.fact_check?.unverified_claims?.length > 0 && (
      <div className="mt-2">
        <p className="text-yellow-300 text-xs font-medium">Unverified claims in email:</p>
        <ul className="text-yellow-200/60 text-xs mt-1 list-disc list-inside">
          {lead.outreach.fact_check.unverified_claims.map((c: string, i: number) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Add stale data warning**

```tsx
{lead.outreach?.stale_data_warning && (
  <div className="bg-orange-900/20 border border-orange-700 rounded-xl p-3 mb-4">
    <p className="text-orange-300 text-sm">
      <span className="font-semibold">Stale data notice:</span> {lead.outreach.stale_data_warning}
    </p>
  </div>
)}
```

- [ ] **Step 3: Add outcome logging buttons**

After the outreach section, add an outcome logging section:

```tsx
<Section title="Log Outcome">
  <div className="flex flex-wrap gap-2">
    {["no_response", "opened", "replied_positive", "replied_negative", "meeting_booked", "unsubscribed", "bounced"].map(outcome => (
      <button
        key={outcome}
        onClick={async () => {
          await fetch("/api/outcomes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lead_id: lead.id,
              outcome,
              tier_used: lead.outreach?.tier_used,
              score_at_send: lead.scoring?.score,
            }),
          });
          // Refresh or show confirmation
          window.location.reload();
        }}
        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--border)] hover:bg-[#333] transition-colors"
      >
        {outcome.replace(/_/g, " ")}
      </button>
    ))}
  </div>
</Section>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/leads/[id]/page.tsx
git commit -m "feat: add review warnings, stale data notice, and outcome logging to lead detail UI"
```

---

### Task 12: Randomize LinkedIn Processing Order (#9 continued)

**Files:**
- Modify: `src/lib/scraper/linkedin.ts`

- [ ] **Step 1: Shuffle the rows array before processing**

In `src/lib/scraper/linkedin.ts`, after the rows are fetched from the database query, add a Fisher-Yates shuffle:

```typescript
    // Randomize processing order so rate-limited leads aren't always the same ones
    for (let j = rows.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [rows[j], rows[k]] = [rows[k], rows[j]];
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scraper/linkedin.ts
git commit -m "feat: randomize LinkedIn processing order to distribute rate-limit impact"
```

---

### Summary of All Mitigations by Issue Number

| # | Issue | Files Changed | Key Change |
|---|-------|---------------|------------|
| 1 | Wrong person, right business | `score.ts` | `requires_manual_review` + `review_reason` in scoring output |
| 2 | Age estimation guesswork | `score.ts` | Age confidence penalty: low confidence = +0 bonus |
| 3 | Emails land in spam | `outreach.ts` | Already handled by subject line rules; `offer_booklet` expands pipeline |
| 4 | No compliance safety net | `suppression.ts`, `db.ts`, `push/route.ts`, `suppression/route.ts` | Full suppression list with auto-add on bounce/unsub |
| 5 | Stale website data | `outreach.ts` | Stale data personalization rule + `stale_data_warning` field |
| 6 | Claude hallucination | `fact-check.ts`, `outreach.ts` | Post-generation fact-check against source data |
| 7 | AI email pattern recognition | `outreach.ts` | 5 rotating format styles |
| 8 | Revenue mistiering | `score.ts` | Revenue confidence rule: single weak indicator = no bonus |
| 9 | LinkedIn scraping breaks | `linkedin.ts`, `db.ts` | `data_quality` column + randomized processing order |
| 10 | No feedback loop | `db.ts`, `outcomes/route.ts`, `leads/[id]/page.tsx` | `outreach_outcomes` table + API + UI buttons |
