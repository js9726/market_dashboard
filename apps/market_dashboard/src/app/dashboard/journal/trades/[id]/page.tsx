import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { features } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import JournalEditorClient from "@/components/broker-journal/JournalEditorClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function JournalEditorPage({ params }: Props) {
  if (!features.brokerJournal) {
    return (
      <div style={{ padding: "2rem", color: "#666" }}>
        <h1>Journal entry</h1>
        <p>This feature is not yet enabled in this environment.</p>
      </div>
    );
  }
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const trade = await prisma.tradeRecord.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      ticker: true,
      side: true,
      buyPrice: true,
      quantity: true,
      tradeDate: true,
      executedAt: true,
      industry: true,
      state: true,
    },
  });
  if (!trade) {
    return (
      <div style={{ padding: "2rem", color: "#b91c1c" }}>
        <h1>Trade not found</h1>
        <p>This trade either doesn&apos;t exist or doesn&apos;t belong to you.</p>
      </div>
    );
  }

  // Serialize Decimal fields for client
  const tradeSerialized = {
    id: trade.id,
    ticker: trade.ticker,
    side: trade.side,
    buyPrice: trade.buyPrice ? Number(trade.buyPrice) : null,
    quantity: trade.quantity ? Number(trade.quantity) : null,
    tradeDate: trade.tradeDate?.toISOString() ?? null,
    executedAt: trade.executedAt?.toISOString() ?? null,
    industry: trade.industry,
    state: trade.state,
  };

  return <JournalEditorClient trade={tradeSerialized} />;
}
