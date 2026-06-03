/**
 * operator.ts — resolve the SaaS "operator": the owner-role user whose A-list
 * REC picks (screener output) are the SHARED resource every approved client
 * reads. HELD positions stay personal; only the REC lane fans out from here.
 *
 * Mirrors the stable "earliest owner-role user" rule also used by the brief
 * A-list ingest (a-list-extractor.getOwnerUserId). Kept tiny + on the shared
 * prisma singleton so read routes can call it without pulling the heavy
 * extractor module.
 */
import { prisma } from "@/lib/prisma";

/** Returns the operator (owner) user id whose REC lane is shared, or null. */
export async function getOperatorUserId(): Promise<string | null> {
  const row = await prisma.user.findFirst({
    where: { role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return row?.id ?? null;
}
