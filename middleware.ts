import { NextRequest, NextResponse } from "next/server";

// /api/webhooks/pancake and /api/cron carry their own auth (HMAC signature
// verification and the CRON_SECRET bearer token respectively) instead of a
// browser session cookie.
// /reset-password is reached from an emailed link, so by definition without a
// session -- the token in the URL is what stands in for one.
// /api/sso is the hand-off from the company portal: it is how a session BEGINS,
// so requiring one to reach it would be a door that only opens from inside. It
// carries its own auth -- an HMAC the portal signs, good for sixty seconds --
// and refuses anything else.
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/webhooks/pancake", "/api/cron", "/api/sso"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get("session")?.value);

  if (!hasSession) {
    // A redirect is useless to fetch(). It obeys the 307 without telling the
    // caller, receives the login page's HTML, and the caller then fails trying
    // to read JSON out of it — which every screen in the app reported as a
    // network error. So an expired session looked like a broken save, and the
    // one thing the user needed to be told was the one thing hidden from them.
    //
    // Data endpoints get a 401 they can actually read. A top-level navigation
    // still gets the login page, because a download link opened in a tab should
    // land on a form rather than on a line of JSON.
    const isNavigation = req.headers.get("sec-fetch-mode") === "navigate";
    if (pathname.startsWith("/api/") && !isNavigation) {
      return NextResponse.json(
        { ok: false, error: "Your session has expired. Log in again, then retry." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // The authenticated layout needs the current path to enforce the
  // must-change-password lockout (it cannot read the URL itself). Middleware
  // runs on the edge and has no database access, so the decision itself belongs
  // in the layout — this only carries the path across.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Excludes Next internals, the call-log download API, and any request for a
  // static file (path segment containing a dot, e.g. /brand-logo.png) — those
  // must be served directly instead of being redirected to /login when the
  // visitor has no session yet (that redirect was returning the login page's
  // HTML in place of the asset, breaking images like the login-page logo).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/call-logs/.*/download|.*\\..*).*)"],
};
