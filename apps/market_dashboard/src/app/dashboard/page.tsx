import { auth } from "@/auth";
import ConvictionDesk from "@/components/market-desk/ConvictionDesk";

export default async function DashboardPage() {
  const session = await auth();
  const isOwner = session?.user?.role === "owner";
  return <ConvictionDesk isOwner={isOwner} />;
}
