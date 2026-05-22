import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { WikiManifest } from "@/lib/wiki/audits";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [audits, trades] = await Promise.all([
      prisma.wikiAudit.findMany({ orderBy: { period: "desc" } }),
      prisma.wikiTradeVerdict.findMany({ orderBy: [{ tradeDate: "desc" }, { ticker: "asc" }] }),
    ]);

    if (audits.length > 0 || trades.length > 0) {
      const manifest: WikiManifest = {
        generated_at: new Date().toISOString(),
        source: "postgres:WikiAudit/WikiTradeVerdict",
        audits_count: audits.length,
        trades_count: trades.length,
        audits: audits.map((audit) => ({
          period: audit.period,
          url: `/api/wiki/audits/${audit.period}`,
          size_bytes: audit.sizeBytes ?? audit.markdown.length,
        })),
        trades: trades.map((trade) => {
          const date = trade.tradeDate.toISOString().slice(0, 10);
          return {
            date,
            ticker: trade.ticker,
            year: trade.year,
            day0_url: trade.day0Json ? `/api/wiki/trades/${date}/${trade.ticker}/day0` : undefined,
            day14_url: trade.day14Json ? `/api/wiki/trades/${date}/${trade.ticker}/day14` : undefined,
          };
        }),
      };
      return NextResponse.json(manifest);
    }
  } catch {
    // Local dev fallback below. Production should have the Prisma tables.
  }

  const manifestPath = path.join(process.cwd(), "public", "wiki", "index.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as WikiManifest;
    return NextResponse.json(manifest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        {
          error: "Wiki audits missing. Run `npm run sync:wiki -- --post` to ingest them.",
          audits: [],
          trades: [],
          audits_count: 0,
          trades_count: 0,
        },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Manifest read failed: ${msg}` }, { status: 500 });
  }
}
