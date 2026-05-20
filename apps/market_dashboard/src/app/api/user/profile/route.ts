/**
 * GET   /api/user/profile          -> current user's editable profile
 * PATCH /api/user/profile          -> update username / bio / dashboardTagline / publicProfileEnabled
 *
 * Public profiles live at /profile/[username] and use a separate read path.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

interface PatchBody {
  username?: unknown;
  bio?: unknown;
  dashboardTagline?: unknown;
  publicProfileEnabled?: unknown;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      username: true,
      bio: true,
      dashboardTagline: true,
      publicProfileEnabled: true,
    },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user);
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Prisma.UserUpdateInput = {};

  // username — normalise to lowercase, validate format. Pass null to clear.
  if (body.username !== undefined) {
    if (body.username === null || body.username === "") {
      updates.username = null;
    } else if (typeof body.username !== "string") {
      return NextResponse.json({ error: "username must be a string" }, { status: 400 });
    } else {
      const lower = body.username.trim().toLowerCase().replace(/^@/, "");
      if (!USERNAME_RE.test(lower)) {
        return NextResponse.json(
          { error: "username must be 3-30 chars, lowercase letters/digits/underscore only" },
          { status: 400 },
        );
      }
      updates.username = lower;
    }
  }

  if (body.bio !== undefined) {
    if (body.bio === null || body.bio === "") {
      updates.bio = null;
    } else if (typeof body.bio !== "string") {
      return NextResponse.json({ error: "bio must be a string" }, { status: 400 });
    } else if (body.bio.length > 200) {
      return NextResponse.json({ error: "bio exceeds 200 chars" }, { status: 400 });
    } else {
      updates.bio = body.bio;
    }
  }

  if (body.dashboardTagline !== undefined) {
    if (body.dashboardTagline === null || body.dashboardTagline === "") {
      updates.dashboardTagline = null;
    } else if (typeof body.dashboardTagline !== "string") {
      return NextResponse.json({ error: "dashboardTagline must be a string" }, { status: 400 });
    } else if (body.dashboardTagline.length > 60) {
      return NextResponse.json({ error: "dashboardTagline exceeds 60 chars" }, { status: 400 });
    } else {
      updates.dashboardTagline = body.dashboardTagline;
    }
  }

  if (body.publicProfileEnabled !== undefined) {
    if (typeof body.publicProfileEnabled !== "boolean") {
      return NextResponse.json({ error: "publicProfileEnabled must be boolean" }, { status: 400 });
    }
    updates.publicProfileEnabled = body.publicProfileEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updates,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        username: true,
        bio: true,
        dashboardTagline: true,
        publicProfileEnabled: true,
      },
    });
    return NextResponse.json(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "username already taken" }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Update failed: ${msg}` }, { status: 500 });
  }
}
