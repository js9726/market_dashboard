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
