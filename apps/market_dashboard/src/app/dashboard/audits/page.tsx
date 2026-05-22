import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AuditsView from "@/components/audits/AuditsView";

export default async function AuditsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <AuditsView />;
}
