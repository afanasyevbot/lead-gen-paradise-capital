import { NextRequest, NextResponse } from "next/server";
import { getDb, upsertLead } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rate-limit";

/**
 * POST /api/upload
 *
 * Accepts a CSV file (multipart/form-data) and imports leads.
 * Supports Apollo.io CSV exports and generic CSVs.
 *
 * Apollo columns are auto-mapped to the leads schema.
 * Owner email/name/title from Apollo are stored in raw_data AND
 * pre-populated into enrichment_data so leads can be pushed to
 * Instantly without running the full enrichment pipeline.
 */

// ── CSV Parser ────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ── Column Mapping ────────────────────────────────────────────────────────

/** Maps common Apollo/generic CSV column names to our schema */
const COLUMN_MAP: Record<string, string> = {
  // Apollo format
  "Company": "business_name",
  "Company Name": "business_name",
  "company": "business_name",
  "Company Name for Emails": "business_name",
  "Company Address": "address",
  "Company City": "city",
  "Company State": "state",
  "Company Country": "country",
  "Company Zip": "zip_code",
  "Company Phone": "phone",
  "Website": "website",
  "Company Website": "website",
  "# Employees": "employees",
  "Number of Employees": "employees",
  "Annual Revenue": "revenue",
  "Industry": "industry",
  "Person Linkedin Url": "person_linkedin",
  "LinkedIn URL": "person_linkedin",
  "Company Linkedin Url": "company_linkedin",
  "First Name": "first_name",
  "Last Name": "last_name",
  "Name": "full_name",
  "Email": "email",
  "Email Address": "email",
  "Title": "title",
  "Job Title": "title",
  "Phone": "phone",
  "City": "city",
  "State": "state",
  "Zip": "zip_code",
  "Zip Code": "zip_code",
  "Address": "address",
  // Generic
  "business_name": "business_name",
  "Business Name": "business_name",
  "Business": "business_name",
  "company_name": "business_name",
  "website": "website",
  "phone": "phone",
  "city": "city",
  "state": "state",
  "email": "email",
};

function mapRow(row: Record<string, string>): {
  lead: Record<string, unknown>;
  contactInfo: { email?: string; firstName?: string; lastName?: string; fullName?: string; title?: string; linkedin?: string };
} {
  const mapped: Record<string, string> = {};

  // Map known columns
  for (const [csvCol, value] of Object.entries(row)) {
    const key = COLUMN_MAP[csvCol];
    if (key && value) {
      mapped[key] = value;
    }
  }

  // Build raw_data with all original columns + extracted fields
  const rawData: Record<string, string> = { ...row };
  if (mapped.employees) rawData._employees = mapped.employees;
  if (mapped.revenue) rawData._revenue = mapped.revenue;
  if (mapped.industry) rawData._industry = mapped.industry;
  if (mapped.person_linkedin) rawData._person_linkedin = mapped.person_linkedin;
  if (mapped.company_linkedin) rawData._company_linkedin = mapped.company_linkedin;

  // Build contact info
  const contactInfo: { email?: string; firstName?: string; lastName?: string; fullName?: string; title?: string; linkedin?: string } = {};
  if (mapped.email) contactInfo.email = mapped.email;
  if (mapped.first_name) contactInfo.firstName = mapped.first_name;
  if (mapped.last_name) contactInfo.lastName = mapped.last_name;
  if (mapped.full_name) contactInfo.fullName = mapped.full_name;
  if (mapped.title) contactInfo.title = mapped.title;
  if (mapped.person_linkedin) contactInfo.linkedin = mapped.person_linkedin;

  // Determine business name
  const businessName = mapped.business_name || mapped.full_name || "Unknown Business";

  // Generate unique place_id for dedup
  const city = (mapped.city || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const state = (mapped.state || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameSafe = businessName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 60);
  const placeId = `apollo-${nameSafe}-${city}-${state}`;

  const lead: Record<string, unknown> = {
    place_id: placeId,
    business_name: businessName,
    address: mapped.address || null,
    city: mapped.city || null,
    state: mapped.state || null,
    zip_code: mapped.zip_code || null,
    phone: mapped.phone || null,
    website: mapped.website || null,
    source: "apollo",
    raw_data: rawData,
    is_chain: 0,
    no_website_flag: mapped.website ? 0 : 1,
  };

  return { lead, contactInfo };
}

// ── Pre-populate enrichment ────────────────────────────────────────────────

function upsertApolloEnrichment(
  leadId: number,
  contactInfo: { email?: string; firstName?: string; lastName?: string; fullName?: string; title?: string; linkedin?: string },
  rawData: Record<string, string>
) {
  const db = getDb();
  const now = new Date().toISOString();

  // Build owner name
  let ownerName = contactInfo.fullName || "";
  if (!ownerName && (contactInfo.firstName || contactInfo.lastName)) {
    ownerName = [contactInfo.firstName, contactInfo.lastName].filter(Boolean).join(" ");
  }

  // Build enrichment data object (matches the structure from extract.ts)
  const enrichmentData: Record<string, unknown> = {
    owner_name: ownerName || null,
    owner_email: contactInfo.email || null,
    owner_title: contactInfo.title || null,
    owner_linkedin: contactInfo.linkedin || null,
    employees: rawData["# Employees"] || rawData["Number of Employees"] || null,
    annual_revenue: rawData["Annual Revenue"] || null,
    industry: rawData["Industry"] || null,
    source: "apollo",
  };

  // Only insert if we have meaningful contact data
  if (!contactInfo.email && !ownerName) return;

  db.prepare(`
    INSERT OR REPLACE INTO enrichment_data (lead_id, data, created_at)
    VALUES (?, ?, ?)
  `).run(leadId, JSON.stringify(enrichmentData), now);

  // Update enrichment status to indicate we have some data
  db.prepare(`
    UPDATE leads SET enrichment_status = 'enriched', updated_at = ? WHERE id = ?
  `).run(now, leadId);
}

// ── Route Handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(clientKey(req, "upload"), { capacity: 10, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many uploads — slow down" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json({ error: "Only CSV files are supported" }, { status: 400 });
    }

    // Hard cap on upload size so a malicious or accidental huge file can't
    // OOM the server. 50 MB ≈ 200k Apollo rows — well above any real export.
    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB > 50MB limit` },
        { status: 413 }
      );
    }

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV file is empty or has no data rows" }, { status: 400 });
    }

    const db = getDb();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const { lead, contactInfo } = mapRow(row);

        // Skip rows without a business name
        if (!lead.business_name || lead.business_name === "Unknown Business") {
          skipped++;
          continue;
        }

        const isNew = upsertLead(lead);
        if (isNew) inserted++;
        else updated++;

        // Get the lead ID for enrichment data
        const dbLead = db
          .prepare("SELECT id FROM leads WHERE place_id = ?")
          .get(lead.place_id as string) as { id: number } | undefined;

        if (dbLead && (contactInfo.email || contactInfo.firstName)) {
          upsertApolloEnrichment(dbLead.id, contactInfo, row);
        }
      } catch (err) {
        // Distinguish parse/upsert errors from intentional skips. Capture the
        // first 20 so the caller can debug bad CSV input rather than getting
        // silent skip counts that hide every kind of failure.
        failed++;
        if (failures.length < 20) {
          failures.push({ row: i + 1, error: String(err) });
        }
        console.error(`[UPLOAD] row ${i + 1} failed:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      inserted,
      updated,
      skipped,
      failed,
      failures,
      total: rows.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/upload/preview — returns first 5 rows with mapped columns */
export async function PUT(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
    }

    // Return first 5 rows with column mapping info
    const preview = rows.slice(0, 5).map((row) => {
      const { lead, contactInfo } = mapRow(row);
      return {
        original: row,
        mapped: {
          business_name: lead.business_name,
          city: lead.city,
          state: lead.state,
          phone: lead.phone,
          website: lead.website,
          email: contactInfo.email || null,
          owner_name: [contactInfo.firstName, contactInfo.lastName].filter(Boolean).join(" ") || contactInfo.fullName || null,
          title: contactInfo.title || null,
        },
      };
    });

    const columns = Object.keys(rows[0]);
    const mappedColumns = columns.filter((c) => COLUMN_MAP[c]).map((c) => ({ from: c, to: COLUMN_MAP[c] }));
    const unmappedColumns = columns.filter((c) => !COLUMN_MAP[c]);

    return NextResponse.json({
      totalRows: rows.length,
      columns,
      mappedColumns,
      unmappedColumns,
      preview,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
