// Sourced from the inlined profiles in @/lib/brief/trader-profiles (no cross-boundary import).
import { TRADER_PROFILES as _BRIEF_PROFILES } from "@/lib/brief/trader-profiles";

export interface TraderProfile {
  handle: string;
  /** styleShort mapped to `style` for backwards-compat with callers that use `.style` */
  style: string;
  dimensions: string;
}

export const TRADER_PROFILES: TraderProfile[] = _BRIEF_PROFILES.map((p) => ({
  handle: p.handle,
  style: p.styleShort,
  dimensions: p.dimensions,
}));
