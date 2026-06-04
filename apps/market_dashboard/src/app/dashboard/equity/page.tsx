import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CoachingInsights from "@/components/equity/CoachingInsights";
import EquityJournalOverview from "@/components/equity/EquityJournalOverview";
import EquityTimeline from "@/components/equity/EquityTimeline";
import JournalDigestCard from "@/components/journal/JournalDigestCard";
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
  return (
    <div className="space-y-5">
      <JournalDigestCard />
      <CoachingInsights />
      <EquityJournalOverview />
      <EquityTimeline />
    </div>
  );
}
