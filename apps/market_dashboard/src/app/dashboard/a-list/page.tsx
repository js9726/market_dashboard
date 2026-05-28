import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AListView from "@/components/a-list/AListView";

export default async function AListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <AListView />;
}
