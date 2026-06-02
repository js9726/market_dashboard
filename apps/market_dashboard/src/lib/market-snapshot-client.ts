import type { MarketSnapshot } from "@/types/market-dashboard";

const STATIC_SNAPSHOT_URL = "/market-dashboard/snapshot.json";
const LIVE_SNAPSHOT_URL = "/api/market-snapshot";

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const live = await fetch(LIVE_SNAPSHOT_URL, { cache: "no-store" });
  if (live.ok) return live.json() as Promise<MarketSnapshot>;

  const fallback = await fetch(STATIC_SNAPSHOT_URL, { cache: "no-store" });
  if (!fallback.ok) {
    throw new Error(`snapshot ${live.status}/${fallback.status}`);
  }
  return fallback.json() as Promise<MarketSnapshot>;
}
