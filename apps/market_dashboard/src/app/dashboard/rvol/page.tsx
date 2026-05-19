import { redirect } from "next/navigation";
import { auth } from "@/auth";
import RvolOverview from "@/components/market-desk/RvolOverview";

export default async function RvolPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <RvolOverview />;
}
