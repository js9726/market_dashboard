import MarketDeskShell from "@/components/market-desk/MarketDeskShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <MarketDeskShell>{children}</MarketDeskShell>;
}
