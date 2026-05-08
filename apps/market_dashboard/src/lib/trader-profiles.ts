import {
  SHARED_TRADER_PROFILES,
  type SharedTraderProfile,
} from "@core-skills/_shared/prompt-loader";

export interface TraderProfile {
  handle: string;
  style: string;
  dimensions: string;
}

export const TRADER_PROFILES: TraderProfile[] = SHARED_TRADER_PROFILES.map(
  (p: SharedTraderProfile) => ({
    handle: p.handle,
    style: p.styleShort,
    dimensions: p.dimensions,
  })
);
