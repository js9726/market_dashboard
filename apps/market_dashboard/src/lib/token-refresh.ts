import { prisma } from "@/lib/prisma";

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account) throw new Error("No Google account linked for user");
  if (!account.refresh_token) throw new Error("No refresh token available — user must re-authenticate");

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = account.expires_at !== null && account.expires_at < nowSec + 60;

  if (!isExpired && account.access_token) {
    return account.access_token;
  }

  // Refresh the token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const data = await res.json() as {
    access_token: string;
    expires_in: number;
  };

  await prisma.account.update({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: account.providerAccountId } },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    },
  });

  return data.access_token;
}
