/**
 * GET  /api/broker-accounts → user's UserBrokerAccount[]
 * POST /api/broker-accounts → create a new account linked to a preset
 *
 * Body (POST):
 * {
 *   presetId:        string (FK BrokerPreset.id),
 *   alias:           string ("Main margin", "IRA", ...),
 *   brokerAccountId?: string (external broker's account id, e.g. moomoo 286260...),
 *   displayCurrency?: string,
 *   isLive?:          boolean (false = paper)
 * }
 *
 * DELETE /api/broker-accounts?id=xxx → soft-delete (isActive=false)
 *
 * Auth: session-based. Caller owns/manages only their own accounts.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: session.user.id, isActive: true },
    include: { preset: { select: { name: true, region: true, currency: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ accounts });
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const presetId = typeof body.presetId === "string" ? body.presetId : null;
  const alias = typeof body.alias === "string" ? body.alias.trim() : null;
  if (!presetId || !alias) {
    return NextResponse.json({ error: "presetId and alias required" }, { status: 400 });
  }

  const preset = await prisma.brokerPreset.findUnique({ where: { id: presetId } });
  if (!preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 });

  try {
    const account = await prisma.userBrokerAccount.create({
      data: {
        userId: session.user.id,
        presetId,
        alias,
        brokerAccountId: typeof body.brokerAccountId === "string" ? body.brokerAccountId : null,
        displayCurrency: typeof body.displayCurrency === "string" ? body.displayCurrency : null,
        isLive: body.isLive === true,
      },
    });
    return NextResponse.json({ ok: true, account });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const account = await prisma.userBrokerAccount.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.userBrokerAccount.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true });
}
