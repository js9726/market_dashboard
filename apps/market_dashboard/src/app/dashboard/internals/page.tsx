import { redirect } from "next/navigation";
import { auth } from "@/auth";
import InternalsView from "@/components/market-desk/InternalsView";

export default async function InternalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <InternalsView />;
}
