/**
 * Mood and market-conditions taxonomies for the Daily Journal.
 * Both are intentionally small + frozen — easier to analyse later than
 * a free-text field, but still expressive enough to capture the day.
 */

export interface MoodOption {
  emoji: string;
  label: string;
  /**
   * -2 (very negative) → +2 (very positive). Used for trend lines in
   * future analytics views; never shown directly to the user.
   */
  score: -2 | -1 | 0 | 1 | 2;
}

export const MOOD_OPTIONS: readonly MoodOption[] = [
  { emoji: "😣", label: "Frustrated",  score: -2 },
  { emoji: "😟", label: "Anxious",     score: -1 },
  { emoji: "😐", label: "Neutral",     score:  0 },
  { emoji: "🙂", label: "Confident",   score:  1 },
  { emoji: "😄", label: "Energised",   score:  2 },
] as const;

export const MOOD_EMOJIS = MOOD_OPTIONS.map((m) => m.emoji);

export function moodScore(emoji: string | null | undefined): number | null {
  if (!emoji) return null;
  const hit = MOOD_OPTIONS.find((m) => m.emoji === emoji);
  return hit ? hit.score : null;
}

export function moodLabel(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  return MOOD_OPTIONS.find((m) => m.emoji === emoji)?.label ?? null;
}

export function isValidMood(emoji: string | null | undefined): boolean {
  if (!emoji) return false;
  return MOOD_EMOJIS.includes(emoji);
}

/**
 * Market-condition choices shown in the dropdown. `null` is the "none"
 * sentinel — the form posts undefined for that and the server stores NULL.
 */
export const MARKET_CONDITIONS = [
  "Trending up",
  "Trending down",
  "Choppy / range",
  "Volatile / wide-range day",
  "Low volume / dead tape",
  "Macro event day (FOMC / CPI / NFP)",
  "Earnings season heavy",
  "Other",
] as const;

export type MarketCondition = (typeof MARKET_CONDITIONS)[number];

export function isValidMarketCondition(value: string | null | undefined): boolean {
  if (value == null) return true;  // null is allowed = "not specified"
  return (MARKET_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Clamp + validate sleep hours: trader-relevant range is 0-12h. Anything outside
 * is almost certainly a typo, so the form rejects it client-side AND the API
 * route refuses it server-side.
 */
export const SLEEP_HOURS_MIN = 0;
export const SLEEP_HOURS_MAX = 12;

export function isValidSleepHours(value: number | null | undefined): boolean {
  if (value == null) return true;
  if (!Number.isFinite(value)) return false;
  return value >= SLEEP_HOURS_MIN && value <= SLEEP_HOURS_MAX;
}
