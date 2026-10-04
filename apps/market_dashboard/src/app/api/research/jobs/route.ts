import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { researchJobs } from "@/server/research-jobs";
import { errorResponse, readBody } from "@/lib/research/http";

export const dynamic = "force-dynamic";
async function guard() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== "owner") return { error: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  if (process.env.RESEARCH_ENABLED !== "true") return { error: NextResponse.json({ error: "Research worker is not enabled" }, { status: 503 }) };
  if (process.env.RESEARCH_WORKER_USER_ID !== session.user.id) return { error: NextResponse.json({ error: "This worker is assigned to another owner or is not configured" }, { status: 403 }) };
  return { userId: session.user.id };
}
export async function POST(request: Request) {
  const access = await guard();
  if (access.error) return access.error;
  try { return NextResponse.json(await researchJobs(prisma).enqueue(access.userId!, await readBody(request)), { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
export async function GET() {
  const access = await guard();
  if (access.error) return access.error;
  try { return NextResponse.json({ jobs: await researchJobs(prisma).list(access.userId!) }); }
  catch (error) { return errorResponse(error); }
}
