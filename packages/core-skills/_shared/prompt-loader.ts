/**
 * Shared loader utilities for runtime skills.
 * Phase 2: only the trader-profiles bridge is needed; prompt template
 * interpolation lands with Phase 3 skill scaffolding.
 */

import traderProfilesData from "./trader-profiles.json";

export interface SharedTraderProfile {
  handle: string;
  name: string;
  styleShort: string;
  styleLong: string;
  dimensions: string;
}

export const SHARED_TRADER_PROFILES: SharedTraderProfile[] =
  traderProfilesData as SharedTraderProfile[];

/** Minimal Mustache-style {placeholder} interpolation. Used by Phase 3 skills. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{${key}}`
  );
}
