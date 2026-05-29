export type BriefProviderName = "deepseek" | "gemini" | "openai" | "claude";

export interface SelectableBriefEntry {
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

/** True if the brief's structured payload actually carries Live-Ideas content
 *  (a non-empty movers array or a standout pick). Used to avoid surfacing an
 *  empty brief — e.g. a Gemini run that produced `movers: []` — just because
 *  it happens to be the freshest. */
function hasIdeasContent(entry: SelectableBriefEntry | null | undefined): entry is SelectableBriefEntry {
  if (!hasStructuredPayload(entry)) return false;
  const sj = entry.structured as { movers?: unknown; standout?: { ticker?: unknown } | null };
  const moversOk = Array.isArray(sj.movers) && sj.movers.length > 0;
  const standoutOk = Boolean(sj.standout && (sj.standout as { ticker?: unknown }).ticker);
  return moversOk || standoutOk;
}

/**
 * Pick the freshest brief that ACTUALLY has Live-Ideas content (movers/standout).
 * Falls back to the plain freshest brief if none have content (so the panel
 * still renders mood/indices rather than going blank).
 *
 * Fixes: Live Ideas showing empty because the freshest provider (e.g. Gemini)
 * produced movers:[] while an older provider (DeepSeek) had real movers.
 */
export function selectFreshestBriefWithContent(
  providers: Partial<Record<BriefProviderName, SelectableBriefEntry | null>> | null | undefined,
): SelectedBriefProvider | null {
  if (!providers) return null;
  let best: SelectedBriefProvider | null = null;
  for (const provider of BRIEF_PROVIDER_ORDER) {
    const entry = providers[provider];
    if (!hasIdeasContent(entry)) continue;
    if (!best || timestamp(entry) > timestamp(best.entry)) best = { provider, entry };
  }
  return best ?? selectFreshestBriefProvider(providers);
}
