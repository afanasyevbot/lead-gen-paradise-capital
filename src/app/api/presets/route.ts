import { NextRequest, NextResponse } from "next/server";
import { SEARCH_PRESETS } from "@/lib/config";
import fs from "fs";
import path from "path";

const CUSTOM_PRESETS_PATH = path.join(process.cwd(), "data", "custom-presets.json");

function loadCustomPresets(): Record<string, string[]> {
  try {
    if (fs.existsSync(CUSTOM_PRESETS_PATH)) {
      return JSON.parse(fs.readFileSync(CUSTOM_PRESETS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function saveCustomPresets(presets: Record<string, string[]>) {
  const dir = path.dirname(CUSTOM_PRESETS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CUSTOM_PRESETS_PATH, JSON.stringify(presets, null, 2));
}

/** GET /api/presets — returns merged built-in + custom presets */
export async function GET() {
  const custom = loadCustomPresets();
  const merged: Record<string, { queries: string[]; isCustom: boolean }> = {};

  for (const [key, queries] of Object.entries(SEARCH_PRESETS)) {
    merged[key] = { queries, isCustom: false };
  }
  for (const [key, queries] of Object.entries(custom)) {
    merged[key] = { queries, isCustom: true };
  }

  return NextResponse.json({ presets: merged });
}

/** POST /api/presets — create or update a custom preset */
export async function POST(req: NextRequest) {
  const { name, queries } = await req.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!key) {
    return NextResponse.json({ error: "Invalid preset name" }, { status: 400 });
  }

  if (!Array.isArray(queries) || queries.length === 0) {
    return NextResponse.json({ error: "At least one search query is required" }, { status: 400 });
  }

  const cleanQueries = queries.map((q: string) => String(q).trim()).filter(Boolean);
  if (cleanQueries.length === 0) {
    return NextResponse.json({ error: "At least one non-empty query is required" }, { status: 400 });
  }

  const custom = loadCustomPresets();
  custom[key] = cleanQueries;
  saveCustomPresets(custom);

  return NextResponse.json({ success: true, key, queries: cleanQueries });
}

/** DELETE /api/presets — delete a custom preset */
export async function DELETE(req: NextRequest) {
  const { key } = await req.json();

  if (!key) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  // Can't delete built-in presets
  if (SEARCH_PRESETS[key]) {
    return NextResponse.json({ error: "Cannot delete built-in presets" }, { status: 400 });
  }

  const custom = loadCustomPresets();
  if (!custom[key]) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  delete custom[key];
  saveCustomPresets(custom);

  return NextResponse.json({ success: true });
}
