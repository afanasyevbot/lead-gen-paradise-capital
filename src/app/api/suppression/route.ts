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
