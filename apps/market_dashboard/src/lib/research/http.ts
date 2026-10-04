import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ResearchError } from "@/server/research-jobs";

export function workerTokenValid(request: Request) {
  const expected = process.env.RESEARCH_WORKER_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !received) return false;
  const a = Buffer.from(expected), b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 1_500_000) throw new ResearchError("BODY_TOO_LARGE", 413);
  const body = await request.text();
  if (Buffer.byteLength(body) > 1_500_000) throw new ResearchError("BODY_TOO_LARGE", 413);
  try { return JSON.parse(body); } catch { throw new ResearchError("INVALID_JSON", 400); }
}
export function errorResponse(error: unknown) {
  if (error instanceof ResearchError) return NextResponse.json({ error: error.code }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_RESEARCH_PAYLOAD", fields: error.issues.map(i => i.path.join(".")) }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return NextResponse.json({ error: "CONCURRENT_UPDATE_RETRY" }, { status: 409 });
  // Do not expose database details, source text, tokens or provider responses.
  return NextResponse.json({ error: "RESEARCH_REQUEST_FAILED" }, { status: 500 });
}
