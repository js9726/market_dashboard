export type ColMap = {
  // Required
  ticker: number;
  date: number;
  buyPrice: number;
  quantity: number;
  pnl: number;
  // Optional — execution
  exitPrice: number | null;
  side: number | null;
  fees: number | null;
  notes: number | null;
  // Optional — pre-trade plan
  proposedEntry: number | null;
  proposedSL: number | null;
  proposedTP: number | null;
  rrr: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  positionPct: number | null;
  currency: number | null;
  platform: number | null;
  industry: number | null;
  strategy: number | null;
};

export const DEFAULT_COL_MAP: ColMap = {
  ticker: 0,
  date: 1,
  buyPrice: 19,
  quantity: 20,
  pnl: 41,
  exitPrice: null,
  side: null,
  fees: null,
  notes: null,
  proposedEntry: null,
  proposedSL: null,
  proposedTP: null,
  rrr: null,
  riskPct: null,
  rewardPct: null,
  positionPct: null,
  currency: null,
  platform: null,
  industry: null,
  strategy: null,
};
