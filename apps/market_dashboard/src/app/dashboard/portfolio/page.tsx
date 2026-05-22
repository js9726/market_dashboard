import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { features } from "@/lib/features";
import PortfolioClient from "@/components/broker-journal/PortfolioClient";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  if (!features.brokerJournal) {
    return (
      <div style={{ padding: "2rem", color: "#666" }}>
        <h1>Portfolio</h1>
        <p>This feature is not yet enabled in this environment.</p>
      </div>
    );
  }
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <PortfolioClient />;
}
