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
          scope:
            "openid email profile https://www.googleapis.com/auth/spreadsheets",
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

    async jwt({ token, user }) {
      // `user` is only present on the first sign-in; persist role into JWT
      if (user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true },
        });
        token.userId = dbUser?.id;
        token.role = dbUser?.role ?? "pending";
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
