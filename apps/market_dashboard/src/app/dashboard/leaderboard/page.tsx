import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LeaderboardTable from "@/components/profile/LeaderboardTable";

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <LeaderboardTable />;
}
