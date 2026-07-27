import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get("session")?.value);

  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Excludes Next internals, the call-log download API, and any request for a
  // static file (path segment containing a dot, e.g. /brand-logo.png) — those
  // must be served directly instead of being redirected to /login when the
  // visitor has no session yet (that redirect was returning the login page's
  // HTML in place of the asset, breaking images like the login-page logo).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/call-logs/.*/download|.*\\..*).*)"],
};
