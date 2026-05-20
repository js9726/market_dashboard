import { redirect } from "next/navigation";
import { auth } from "@/auth";
import RotationGraph from "@/components/market-desk/RotationGraph";

export default async function RrgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <RotationGraph />;
}
