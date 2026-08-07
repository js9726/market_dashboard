const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const PREFIX_RE = /^\s*(?:\/journal(?:@\w+)?|journal this|my trading thoughts?)\b[:\s-]*/i;

function dateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
  };
}

function previousWeekday(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function mostRecentlyCompletedUsSession(now = new Date()): string {
  const ny = dateParts(now, "America/New_York");
  if (["Sat", "Sun"].includes(ny.weekday)) return previousWeekday(ny.isoDate);
  return ny.hour >= 16 ? ny.isoDate : previousWeekday(ny.isoDate);
}

export function parseJournalThought(text: unknown, now = new Date()): {
  sessionDate: string;
  text: string;
} | null {
  if (typeof text !== "string" || !PREFIX_RE.test(text)) return null;
  const explicitDate = text.match(DATE_RE)?.[1];
  const cleaned = text.replace(PREFIX_RE, "").replace(DATE_RE, "").trim();
  if (!cleaned) return null;
  return {
    sessionDate: explicitDate ?? mostRecentlyCompletedUsSession(now),
    text: cleaned,
  };
}
