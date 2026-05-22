/**
 * /dashboard/settings/brokers — manage broker accounts (Phase 0 Tier 2 setup).
 *
 * Feature-flagged behind NEXT_PUBLIC_FEATURE_BROKER_JOURNAL. When the flag is
 * off, the page renders a placeholder rather than 404 (so the URL stays valid
 * once the flag flips, no link breakage).
 *
 * Server component (auth-gated) wrapping a client island for the interactive
 * add-account form.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { features } from "@/lib/features";
import BrokerSettingsClient from "@/components/broker-journal/BrokerSettingsClient";

export const dynamic = "force-dynamic";

export default async function BrokerSettingsPage() {
  if (!features.brokerJournal) {
    return (
      <div style={{ padding: "2rem", color: "#666" }}>
        <h1>Broker settings</h1>
        <p>This feature is not yet enabled in this environment.</p>
      </div>
    );
  }

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return <BrokerSettingsClient />;
}
