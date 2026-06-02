import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;

  // Always allow login page, NextAuth API routes, and cron endpoints through.
  // Cron endpoints do their own Bearer-token auth via CRON_SECRET — must not be
  // gated behind user session middleware (Vercel Cron sends unauthenticated requests).
  //
  // Machine-auth API routes (CLI tools, GitHub Actions) use Bearer token auth
  // inside the route handler. They MUST be excluded here so the middleware
  // redirect never fires before the handler can inspect the Authorization header.
  // Without this exclusion, urllib/fetch follows the 302 redirect to /login,
  // gets back HTML, and json.loads() fails with "Expecting value: line 1 col 1".
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/morning-verdict/ingest") ||
    pathname.startsWith("/api/wiki/audits/ingest") ||
    pathname.startsWith("/api/watchlist/export") ||
    pathname.startsWith("/api/live-quotes/ingest") ||
    pathname.startsWith("/api/trades/import") ||
    // Breadth: /api/breadth (public read) + /api/breadth/refresh (key/bearer
    // auth, hit by Vercel cron, the bridge daemon, and external uptime crons).
    // Must bypass session middleware or the 307→/login breaks the JSON contract.
    pathname.startsWith("/api/breadth") ||
    // Screeners: same DB-backed pattern as breadth — public read on /api/screeners,
    // key/bearer auth on /refresh.
    pathname.startsWith("/api/screeners") ||
    pathname.startsWith("/api/market-snapshot") ||
    // Journal machine endpoints: closed-today (cron reads via bearer) +
    // entries/ingest (cron writes AI-scored JournalEntry via bearer).
    pathname.startsWith("/api/journal/closed-today") ||
    pathname.startsWith("/api/journal/entries/ingest") ||
    // Bridge daemon uses bearer-token auth (BrokerBridgeToken.tokenHash) plus
    // X-Timestamp replay protection. Token endpoint stays session-authed
    // because only logged-in users generate/revoke their own tokens.
    pathname.startsWith("/api/bridge/sync") ||
    // Public profile pages — visible to anyone, gated server-side by
    // publicProfileEnabled in /profile/[username]/page.tsx itself.
    pathname.startsWith("/profile/")
  ) {
    return NextResponse.next();
  }

  // Not signed in → Google sign-in
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const role = session.user?.role;

  // Approved roles can proceed
  if (role === "owner" || role === "allowed") {
    // Admin area: owner only
    if (pathname.startsWith("/admin") && role !== "owner") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // Pending / unknown → hold page
  if (role === "pending" || !role) {
    if (!pathname.startsWith("/pending")) {
      return NextResponse.redirect(new URL("/pending", req.url));
    }
    return NextResponse.next();
  }

  // Denied → sign them out
  return NextResponse.redirect(new URL("/api/auth/signout", req.url));
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|market-dashboard|.*\\.png$).*)"],
};
