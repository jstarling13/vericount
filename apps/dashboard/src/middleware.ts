import { NextRequest, NextResponse } from "next/server";

// Simple password-based auth for the internal dashboard.
// Set DASHBOARD_SECRET in your .env. Access via the login page.
// The auth cookie is checked on every request.

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("dashboard_auth")?.value;
  const secret = process.env.DASHBOARD_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
