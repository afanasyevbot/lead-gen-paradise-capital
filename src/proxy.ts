import { NextRequest, NextResponse } from "next/server";

/**
 * Basic HTTP Auth middleware.
 *
 * Set AUTH_USER and AUTH_PASSWORD env vars to enable.
 * If not set, auth is disabled (open access for local dev).
 */
export default function proxy(req: NextRequest) {
  const user = process.env.AUTH_USER;
  const pass = process.env.AUTH_PASSWORD;

  // Auth disabled if not configured
  if (!user || !pass) return NextResponse.next();

  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(":");
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Paradise Capital"',
    },
  });
}

export const config = {
  matcher: [
    // Protect all routes except static assets and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
