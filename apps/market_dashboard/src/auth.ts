import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // NOTE: adding the Docs scope (WS4 daily-journal Google-Doc auto-write)
          // means existing users must re-consent — their stored OAuth grant does
          // not include `documents` until they sign in again (prompt:"consent"
          // forces the re-consent screen on next login).
          scope:
            "openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents",
          access_type: "offline", // required for refresh_token
          prompt: "consent",      // forces refresh_token even on re-auth
        },
      },
    }),
  ],
  // JWT strategy so middleware never needs a DB call (Edge-safe)
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { role: true },
      });

      // Block denied users before the session is created
      if (existing?.role === "denied") return false;

      return true;
    },

    async jwt({ token, user, account }) {
      // `account` is present on every sign-in — update stored tokens so a
      // fresh refresh_token always replaces any previously revoked one.
      if (account?.provider === "google") {
        await prisma.account.update({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: account.providerAccountId,
            },
          },
          data: {
            access_token: account.access_token,
            expires_at: account.expires_at,
            ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
          },
        });
      }
      // `user` is only present on the first sign-in; persist id + role into JWT.
      if (user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true },
        });
        token.userId = dbUser?.id;
        token.role = dbUser?.role ?? "pending";
        token.roleCheckedAt = Date.now();
      } else if (token.userId) {
        // Periodic role refresh (at most every 60s) so an admin approve/deny
        // propagates within a minute WITHOUT forcing the user to sign out and
        // back in. Fail-open: a transient DB error keeps the cached role rather
        // than breaking the session.
        const checkedAt = typeof token.roleCheckedAt === "number" ? token.roleCheckedAt : 0;
        if (Date.now() - checkedAt > 60_000) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: token.userId as string },
              select: { role: true },
            });
            if (dbUser?.role) token.role = dbUser.role;
            token.roleCheckedAt = Date.now();
          } catch {
            // keep the cached role; retry after the interval
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },

  events: {
    // Auto-assign 'owner' role the first time the owner email signs up
    async createUser({ user }) {
      if (user.email === process.env.OWNER_EMAIL) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "owner" },
        });
      }
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },
});
