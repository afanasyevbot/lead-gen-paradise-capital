import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const format = p.get("format") || "csv";

    const { leads } = getLeads({
      status: p.get("status") || undefined,
      minRating: p.get("minRating") ? Number(p.get("minRating")) : undefined,
      hasWebsite: p.get("hasWebsite") === "true",
      excludeChains: p.get("excludeChains") === "true",
      pageSize: 10000,
    });

    if (format === "json") {
      const cleaned = leads.map(({ raw_data, ...rest }) => rest);
      return new NextResponse(JSON.stringify(cleaned, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=paradise_leads.json",
        },
      });
    }

    // CSV
    const cols = [
      "id", "business_name", "address", "city", "state", "zip_code",
      "phone", "website", "google_rating", "review_count",
      "search_query", "search_location",
      "is_chain", "high_review_flag", "no_website_flag",
      "enrichment_status", "scraped_at",
    ];

    const rows = [cols.join(",")];
    for (const lead of leads) {
      const row = cols.map((col) => {
        const val = (lead as unknown as Record<string, unknown>)[col];
        if (val == null) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
      rows.push(row.join(","));
    }

    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=paradise_leads.csv",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
