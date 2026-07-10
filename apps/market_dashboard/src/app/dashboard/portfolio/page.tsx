import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { features } from "@/lib/features";
import PortfolioClient from "@/components/broker-journal/PortfolioClient";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  if (!features.brokerJournal) {
    return (
      <section className="market-panel p-6">
        <h1 className="mb-2 text-[22px] font-extrabold text-[var(--fg-1)]">Portfolio</h1>
        <p className="text-sm text-[var(--fg-3)]">This feature is not yet enabled in this environment.</p>
      </section>
    );
  }
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <PortfolioClient />;
}
