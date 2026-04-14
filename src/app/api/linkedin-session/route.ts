import { NextRequest, NextResponse } from "next/server";
import { saveLinkedInCookie, loadLinkedInCookie, hasLinkedInSession } from "@/lib/scraper/linkedin-profile";

/** GET /api/linkedin-session — check if a session is configured */
export async function GET() {
  const configured = hasLinkedInSession();
  let savedAt: string | null = null;

  if (configured) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const SESSION_PATH = path.resolve(process.cwd(), "data", "linkedin-session.json");
      const raw = fs.readFileSync(SESSION_PATH, "utf-8");
      savedAt = JSON.parse(raw).saved_at || null;
    } catch { /* ignore */ }
  }

  return NextResponse.json({ configured, savedAt });
}

/** POST /api/linkedin-session — save the li_at cookie value */
export async function POST(req: NextRequest) {
  try {
    const { li_at } = await req.json() as { li_at: string };

    if (!li_at || typeof li_at !== "string" || li_at.trim().length < 20) {
      return NextResponse.json({ error: "Invalid li_at cookie value" }, { status: 400 });
    }

    saveLinkedInCookie(li_at.trim());
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/linkedin-session — remove the saved session */
export async function DELETE() {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const SESSION_PATH = path.resolve(process.cwd(), "data", "linkedin-session.json");
    if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
