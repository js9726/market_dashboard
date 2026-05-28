import { auth } from "@/auth";
import { redirect } from "next/navigation";
import EquityTimeline from "@/components/equity/EquityTimeline";

export default async function EquityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (role !== "owner") {
    return (
      <div className="p-5">
        <p className="t-caption">Equity timeline is owner-only.</p>
      </div>
    );
  }
  return <EquityTimeline />;
}
