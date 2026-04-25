import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";

const CHUNK_SIZE = 1000;

const CSV_COLS = [
  "id", "business_name", "address", "city", "state", "zip_code",
  "phone", "website", "google_rating", "review_count",
  "search_query", "search_location",
  "is_chain", "high_review_flag", "no_website_flag",
  "enrichment_status", "scraped_at",
];

function csvCell(val: unknown): string {
  if (val == null) return "";
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const format = p.get("format") || "csv";

    const filters = {
      status: p.get("status") || undefined,
      minRating: p.get("minRating") ? Number(p.get("minRating")) : undefined,
      hasWebsite: p.get("hasWebsite") === "true",
      excludeChains: p.get("excludeChains") === "true",
    };

    if (format === "json") {
      // JSON streaming as a true array — write `[`, then chunks comma-separated, then `]`.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode("["));
          let page = 1;
          let first = true;
          while (true) {
            const { leads } = getLeads({ ...filters, page, pageSize: CHUNK_SIZE });
            if (leads.length === 0) break;
            for (const lead of leads) {
              const { raw_data: _raw, ...rest } = lead as unknown as Record<string, unknown> & { raw_data?: unknown };
              controller.enqueue(enc.encode((first ? "" : ",") + JSON.stringify(rest)));
              first = false;
            }
            if (leads.length < CHUNK_SIZE) break;
            page++;
          }
          controller.enqueue(enc.encode("]"));
          controller.close();
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=paradise_leads.json",
        },
      });
    }

    // CSV streaming
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(CSV_COLS.join(",") + "\n"));
        let page = 1;
        while (true) {
          const { leads } = getLeads({ ...filters, page, pageSize: CHUNK_SIZE });
          if (leads.length === 0) break;
          for (const lead of leads) {
            const row = CSV_COLS.map((col) => csvCell((lead as unknown as Record<string, unknown>)[col]));
            controller.enqueue(enc.encode(row.join(",") + "\n"));
          }
          if (leads.length < CHUNK_SIZE) break;
          page++;
        }
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=paradise_leads.csv",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
