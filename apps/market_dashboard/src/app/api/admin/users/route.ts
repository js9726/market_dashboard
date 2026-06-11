import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, email: true, image: true, role: true, createdAt: true,
      dailyScansUsed: true, dailyScansLimit: true,
    },
  });

  return NextResponse.json(users);
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, role: rawRole, dailyScansLimit } = await req.json();
  // Canonical roles (access.ts): owner | member | pending | denied. Accept the
  // legacy "allowed" and normalise it to "member" so the STORED vocabulary
  // matches the middleware + API-route guards.
  const role = rawRole == null ? undefined : rawRole === "allowed" ? "member" : rawRole;
  const limit = dailyScansLimit == null ? undefined : Number(dailyScansLimit);

  if (!userId || (role === undefined && limit === undefined)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (role !== undefined && !["member", "denied", "pending", "owner"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
    return NextResponse.json({ error: "dailyScansLimit must be an integer 1-500" }, { status: 400 });
  }

  // Prevent owner from demoting themselves
  if (role !== undefined && userId === session.user.id && role !== "owner") {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(role !== undefined ? { role } : {}),
      ...(limit !== undefined ? { dailyScansLimit: limit } : {}),
    },
    select: { id: true, email: true, role: true, dailyScansLimit: true },
  });

  return NextResponse.json(updated);
}
