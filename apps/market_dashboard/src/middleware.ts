import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;

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
