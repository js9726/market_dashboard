import { ideasObservedAt, liveIdeasFromBrief } from "./source-evidence";
import type { StructuredBrief } from "@/types/structured-brief";

export type BriefProviderName = "deepseek" | "gemini" | "openai" | "claude";

export interface SelectableBriefEntry {
  liveIdeas?: StructuredBrief | null;
  liveIdeasAsOf?: string | null;
  html?: string;
  structured: unknown;
  verdict?: unknown;
  generatedAt: string;
  error: string | null;
  stale?: boolean;
}

export type BriefProviderMap = Record<BriefProviderName, SelectableBriefEntry | null>;

export interface SelectedBriefProvider {
  provider: BriefProviderName;
  entry: SelectableBriefEntry;
}

export const BRIEF_PROVIDER_ORDER: BriefProviderName[] = ["deepseek", "gemini", "openai", "claude"];

function hasStructuredPayload(entry: SelectableBriefEntry | null | undefined): entry is SelectableBriefEntry {
  return Boolean(entry && !entry.error && entry.structured && typeof entry.structured === "object");
}

function timestamp(entry: SelectableBriefEntry): number {
  const n = Date.parse(entry.generatedAt);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeBriefProvider(provider: string | null | undefined): BriefProviderName | null {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p === "deepseek-search") return "deepseek";
  return BRIEF_PROVIDER_ORDER.includes(p as BriefProviderName) ? (p as BriefProviderName) : null;
}

export function selectFreshestBriefProvider(
  providers: Partial<Record<BriefProviderName, SelectableBriefEntry | null>> | null | undefined,
): SelectedBriefProvider | null {
  if (!providers) return null;
  let best: SelectedBriefProvider | null = null;
  for (const provider of BRIEF_PROVIDER_ORDER) {
    const entry = providers[provider];
    if (!hasStructuredPayload(entry)) continue;
    if (!best || timestamp(entry) > timestamp(best.entry)) {
      best = { provider, entry };
    }
  }
  return best;
}

export function selectBriefProvider(
  providers: Partial<Record<BriefProviderName, SelectableBriefEntry | null>> | null | undefined,
  manualProvider?: BriefProviderName | null,
): SelectedBriefProvider | null {
  if (!providers) return null;
  if (manualProvider) {
    const entry = providers[manualProvider];
    if (hasStructuredPayload(entry)) return { provider: manualProvider, entry };
  }
  return selectFreshestBriefProvider(providers);
}

/**
 * Ideas require server-reconciled per-symbol evidence, rechecked at render time.
 * Normal brief selection above retains archived briefs; this panel fails closed.
 */
export function selectFreshestBriefWithContent(
  providers: Partial<Record<BriefProviderName, SelectableBriefEntry | null>> | null | undefined,
  now = new Date(),
): SelectedBriefProvider | null {
  if (!providers) return null;
  let best: SelectedBriefProvider | null = null;
  for (const provider of BRIEF_PROVIDER_ORDER) {
    const entry = providers[provider];
    if (!entry || entry.error) continue;
    const liveIdeas = liveIdeasFromBrief(entry.liveIdeas, now);
    if (!liveIdeas) continue;
    const liveIdeasAsOf = ideasObservedAt(liveIdeas);
    if (!best || Date.parse(liveIdeasAsOf ?? "") > Date.parse(best.entry.liveIdeasAsOf ?? "")) {
      best = { provider, entry: { ...entry, liveIdeas, liveIdeasAsOf } };
    }
  }
  return best;
}
