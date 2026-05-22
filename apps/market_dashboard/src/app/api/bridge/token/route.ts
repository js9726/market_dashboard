/**
 * Bridge token management — Phase 3.
 *
 * Endpoints (session-authed, owner of token only):
 *   GET    /api/bridge/token            → list user's tokens (without plaintext)
 *   POST   /api/bridge/token            → create new token, return plaintext ONCE
 *   DELETE /api/bridge/token?id=<id>    → revoke a token (soft delete)
 *
 * Storage model: we store SHA-256(plaintext) in BrokerBridgeToken.tokenHash.
 * Plaintext is shown to the user exactly once at creation time — never again.
 * If they lose it, they generate a new one and revoke the old.
 *
 * Schema (BrokerBridgeToken) is unique-per-user — one active bridge per user
 * for now. The label distinguishes machines if you ever change the schema to
 * allow multiple. We treat the unique constraint as "one active token"; on
 * regen we revoke the old and create the new in a single transaction.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const TOKEN_PREFIX = "mdb_";  // "Market Dashboard Bridge"
const TOKEN_BYTES = 32;        // 256 bits of entropy

function generateToken(): { plaintext: string; hash: string } {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${raw}`;
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await prisma.brokerBridgeToken.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastHeartbeat: true,
      revokedAt: true,
    },
  });
  // Single-row-per-user model — return either the row or null
  return NextResponse.json({ token });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!user || (user.role !== "owner" && user.role !== "allowed")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 64) : null;

  const { plaintext, hash } = generateToken();

  // Replace existing token (one-per-user) in a single transaction
  await prisma.$transaction(async (tx) => {
    await tx.brokerBridgeToken.deleteMany({ where: { userId: session.user!.id } });
    await tx.brokerBridgeToken.create({
      data: {
        userId: session.user!.id,
        tokenHash: hash,
        label,
      },
    });
  });

  // Plaintext returned ONCE — caller must save it immediately
  return NextResponse.json({
    ok: true,
    token: plaintext,
    label,
    note: "Save this token immediately. It will not be shown again.",
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Soft-revoke by setting revokedAt
  await prisma.brokerBridgeToken.updateMany({
    where: { userId: session.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
