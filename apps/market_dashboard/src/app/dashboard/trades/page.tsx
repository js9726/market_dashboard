import { auth } from "@/auth";
import { redirect } from "next/navigation";
import TradesHubView from "@/components/trades-hub/TradesHubView";

export default async function TradesHubPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <TradesHubView />;
}
