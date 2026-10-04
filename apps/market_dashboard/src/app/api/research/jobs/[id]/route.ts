import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { researchJobs } from "@/server/research-jobs";
import { errorResponse } from "@/lib/research/http";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
async function guard() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== "owner") return { error: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  if (process.env.RESEARCH_ENABLED !== "true") return { error: NextResponse.json({ error: "Research worker is not enabled" }, { status: 503 }) };
  if (process.env.RESEARCH_WORKER_USER_ID !== session.user.id) return { error: NextResponse.json({ error: "This worker is assigned to another owner or is not configured" }, { status: 403 }) };
  return { userId: session.user.id };
}
export async function GET(_request: Request, { params }: Params) {
  const access = await guard();
  if (access.error) return access.error;
  try {
    const job = await researchJobs(prisma).get(access.userId!, (await params).id);
    return job ? NextResponse.json(job) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(_request: Request, { params }: Params) {
  const access = await guard();
  if (access.error) return access.error;
  try { await researchJobs(prisma).cancel(access.userId!, (await params).id); return NextResponse.json({ status: "cancelled" }); }
  catch (error) { return errorResponse(error); }
}
