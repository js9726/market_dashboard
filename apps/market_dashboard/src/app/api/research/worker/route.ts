import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { researchJobs } from "@/server/research-jobs";
import { errorResponse, readBody, workerTokenValid } from "@/lib/research/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const operation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claim"), provider: z.enum(["claude", "deepseek"]) }).strict(),
  ...(["heartbeat", "fail", "receipt"] as const).map(op => z.object({ operation: z.literal(op), id: z.string().cuid(), leaseToken: z.string().uuid() }).strict()),
  z.object({ operation: z.literal("checkpoint"), id: z.string().cuid(), leaseToken: z.string().uuid(), context: z.unknown() }).strict(),
  z.object({ operation: z.literal("complete"), id: z.string().cuid(), leaseToken: z.string().uuid(), report: z.unknown(), sessionId: z.string().uuid().optional() }).strict(),
]);

/** Dedicated machine credential, fixed owner binding; deliberately no shared ingest key. */
export async function POST(request: Request) {
  if (!workerTokenValid(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.RESEARCH_ENABLED !== "true") return NextResponse.json({ error: "Research worker is not enabled" }, { status: 503 });
  const userId = process.env.RESEARCH_WORKER_USER_ID;
  if (!userId || (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role !== "owner") return NextResponse.json({ error: "Worker owner unavailable" }, { status: 403 });
  try {
    const body = operation.parse(await readBody(request));
    const jobs = researchJobs(prisma);
    if (body.operation === "claim") return NextResponse.json({ job: await jobs.claim(userId, body.provider) });
    if (body.operation === "receipt") return NextResponse.json(await jobs.receipt(userId, body.id, body.leaseToken));
    if (body.operation === "heartbeat") await jobs.heartbeat(userId, body.id, body.leaseToken);
    if (body.operation === "fail") await jobs.fail(userId, body.id, body.leaseToken);
    if (body.operation === "checkpoint") await jobs.checkpoint(userId, body.id, body.leaseToken, body.context);
    if (body.operation === "complete") return NextResponse.json(await jobs.complete(userId, body.id, body.leaseToken, body.report, body.sessionId));
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
