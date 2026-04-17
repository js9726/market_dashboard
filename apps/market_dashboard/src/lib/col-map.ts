export type ColMap = {
  ticker: number;
  date: number;
  buyPrice: number;
  quantity: number;
  pnl: number;
  exitPrice: number | null;
  side: number | null;
  fees: number | null;
  notes: number | null;
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
};
