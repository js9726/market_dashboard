import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MultiAgentRunner from "@/components/analysis/MultiAgentRunner";

export default async function AnalysisPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <MultiAgentRunner />;
}
