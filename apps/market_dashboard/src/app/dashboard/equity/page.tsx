import { auth } from "@/auth";
import { redirect } from "next/navigation";
import EquityTimeline from "@/components/equity/EquityTimeline";
import { canSeePersonalBook } from "@/lib/access";

export default async function EquityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canSeePersonalBook(session)) {
    return (
      <div className="p-5">
        <p className="t-caption">Equity timeline is available after account approval.</p>
      </div>
    );
  }
  return <EquityTimeline />;
}
