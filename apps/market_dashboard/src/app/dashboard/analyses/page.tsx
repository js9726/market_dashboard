import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AnalysesView from "@/components/audits/AnalysesView";

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <AnalysesView />;
}
