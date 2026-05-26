import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { parseAudit, type AuditReport } from "@/lib/wiki/audits";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const OPERATOR_RE = /^[A-Z]{2,8}$/;

interface RouteContext {
  params: Promise<{ period: string }>;
}

function normaliseOperator(raw: string | null): string {
  if (!raw) return "JS";
  const trimmed = raw.trim().toUpperCase();
  return OPERATOR_RE.test(trimmed) ? trimmed : "JS";
}

export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { period } = await context.params;
  if (!PERIOD_RE.test(period)) {
    return NextResponse.json({ error: "Invalid period (expected YYYY-MM)" }, { status: 400 });
  }

  const url = new URL(req.url);
  const operatorLabel = normaliseOperator(url.searchParams.get("operator"));

  try {
    const row = await prisma.wikiAudit.findUnique({
      where: { operatorLabel_period: { operatorLabel, period } },
    });
    if (row) return NextResponse.json(row.parsedJson as unknown as AuditReport);
  } catch {
    // Local dev fallback below. Production should have the Prisma table.
  }

  // Local dev fallback: public/wiki/audits/{operator}/_audit_{period}.md
  const filePath = path.join(
    process.cwd(),
    "public",
    "wiki",
    "audits",
    operatorLabel,
    `_audit_${period}.md`,
  );
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return NextResponse.json(parseAudit(raw, period, operatorLabel));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: `No audit for ${operatorLabel}/${period}` },
        { status: 404 },
      );
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Read failed: ${msg}` }, { status: 500 });
  }
}
