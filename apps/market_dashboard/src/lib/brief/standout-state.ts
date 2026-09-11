import type { BriefStandout } from "@/types/structured-brief";

export type StandoutState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "selected"; standout: BriefStandout };

/** Keep a deliberate no-pick decision distinct from a brief that has not loaded. */
export function resolveStandoutState(
  hasCompletedBrief: boolean,
  standout: BriefStandout | null | undefined,
): StandoutState {
  if (!hasCompletedBrief) return { status: "loading" };
  if (!standout?.ticker) return { status: "none" };
  return { status: "selected", standout };
}
