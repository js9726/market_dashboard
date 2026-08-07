import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tradingRulesPayloadSchema } from "@/lib/trading-journal/rules";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.TRADING_JOURNAL_INGEST_KEY || process.env.BRIEF_INGEST_KEY;
  return Boolean(expected) && req.headers.get("authorization") === `Bearer ${expected}`;
}

async function ownerUser() {
  const email = process.env.OWNER_EMAIL;
  if (!email) throw new Error("OWNER_EMAIL not set");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("OWNER_EMAIL user not found");
  return user;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const user = await ownerUser();
    const rules = await prisma.tradingRule.findMany({
      where: { userId: user.id },
      orderBy: [{ stage: "asc" }, { ruleKey: "asc" }],
    });
    return NextResponse.json({ ok: true, schemaVersion: "trading-rules/v2", rules });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "read_failed" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let parsed;
  try {
    parsed = tradingRulesPayloadSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json({ ok: false, error: "invalid_rules", detail: error instanceof Error ? error.message : "invalid" }, { status: 400 });
  }
  try {
    const user = await ownerUser();
    const rows = await prisma.$transaction(parsed.rules.map((rule) => prisma.tradingRule.upsert({
      where: { userId_ruleKey: { userId: user.id, ruleKey: rule.ruleKey } },
      create: {
        userId: user.id,
        ruleKey: rule.ruleKey,
        title: rule.title,
        statement: rule.statement,
        stage: rule.stage,
        status: rule.status,
        evidence: rule.evidence as Prisma.InputJsonValue,
        sourceRefs: rule.sourceRefs,
        approvedAt: rule.approvedAt ? new Date(rule.approvedAt) : null,
      },
      update: {
        title: rule.title,
        statement: rule.statement,
        stage: rule.stage,
        status: rule.status,
        evidence: rule.evidence as Prisma.InputJsonValue,
        sourceRefs: rule.sourceRefs,
        approvedAt: rule.approvedAt ? new Date(rule.approvedAt) : null,
      },
    })));
    return NextResponse.json({ ok: true, count: rows.length, ruleKeys: rows.map((row) => row.ruleKey) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "write_failed" }, { status: 503 });
  }
}
