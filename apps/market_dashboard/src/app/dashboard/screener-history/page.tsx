import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ScreenerView from "@/components/audits/ScreenerView";

export default async function ScreenerHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <ScreenerView />;
}
