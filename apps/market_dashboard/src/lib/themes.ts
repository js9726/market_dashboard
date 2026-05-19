import type { TickerRow } from "@/types/market-dashboard";

export type ThemeBucket = "heating" | "accumulate" | "cooling" | "neutral";

/**
 * Human-readable names for the industry ETFs tracked in snapshot.json's
 * `groups.Industries`. Anything not in this map falls back to its ticker.
 */
export const THEME_LABELS: Record<string, string> = {
  TAN: "Solar",
  KCE: "Capital Markets",
  IBUY: "Online Retail",
  JETS: "Airlines",
  IBB: "Biotech",
  SMH: "Semiconductors",
  CIBR: "Cybersecurity",
  UTES: "Utilities",
  ROBO: "Robotics & Automation",
  IGV: "Software",
  WCLD: "Cloud Software",
  ITA: "Aerospace & Defense",
  PAVE: "Infrastructure",
  BLOK: "Blockchain",
  AIQ: "AI Software",
  IYZ: "Telecom",
  PEJ: "Leisure & Entertainment",
  FDN: "Internet",
  KBE: "Banks",
  UNG: "Natural Gas",
  BOAT: "Shipping",
  KWEB: "China Internet",
  KRE: "Regional Banks",
  IBIT: "Bitcoin",
  XRT: "Retail",
  IHI: "Medical Devices",
  DRIV: "EV & Autonomous Vehicles",
  MSOS: "Cannabis",
  SOCL: "Social Media",
  XLU: "Utilities (XLU)",
  ARKF: "Fintech (ARK)",
  SLX: "Steel",
  ARKK: "Disruptive Innovation",
  XTN: "Transportation",
  XME: "Metals & Mining",
  KIE: "Insurance",
  GLD: "Gold",
  GXC: "China Equities",
  SCHH: "REITs",
  GDX: "Gold Miners",
  IPAY: "Mobile Payments",
  IWM: "Small Caps",
  XOP: "Oil & Gas E&P",
  VNQ: "Real Estate",
  EATZ: "Restaurants",
  FXI: "China Large Cap",
  DBA: "Agriculture",
  ICLN: "Clean Energy",
  SILJ: "Silver Miners",
  REZ: "Residential Real Estate",
  LIT: "Lithium & Battery",
  SLV: "Silver",
  XHB: "Homebuilders",
  XHE: "Healthcare Equipment",
  PBJ: "Food & Beverage",
  USO: "Crude Oil",
  DBC: "Commodities",
  FCG: "Natural Gas Producers",
  XBI: "Biotech (Equal Weight)",
  ARKG: "Genomics",
  CPER: "Copper",
  XES: "Oil & Gas Services",
  OIH: "Oil Services",
  PPH: "Pharmaceuticals",
  FNGS: "Mega-Cap Tech",
  URA: "Uranium",
  WGMI: "Bitcoin Miners",
  REMX: "Rare Earth",
};

/**
 * Classifier thresholds — exported as a const object so they can be tuned in
 * one place. Each bucket's predicates live in classifyTheme below.
 */
export const THEME_THRESHOLDS = {
  heating: {
    minDaily: 2.0,
    minIntra: 0,
    minRs: 70,
    requireAbc: "A" as const,
  },
  accumulate: {
    minRs: 55,
    min5d: 0,
    allowedAbc: ["A", "B"] as const,
  },
  cooling: {
    maxDaily: -1.5,
    max5d: -3,
    maxDistSma50Atr: -1,
  },
} as const;

const T = THEME_THRESHOLDS;

/**
 * Deterministic theme classifier.
 *
 * Rules:
 *   HEATING:    daily >= 2.0 AND intra > 0 AND rs >= 70 AND abc == "A"
 *   ACCUMULATE: !heating AND rs >= 55 AND 5d > 0 AND abc in {A, B}
 *   COOLING:    daily <= -1.5 OR (5d < -3 AND abc == "C") OR dist_sma50_atr < -1
 *   NEUTRAL:    everything else
 *
 * Rows with too many nulls to evaluate fall through to neutral (not shown).
 */
export function classifyTheme(row: TickerRow): ThemeBucket {
  const { daily, intra, "5d": d5, dist_sma50_atr, rs, abc } = row;

  const isHeating =
    daily != null &&
    intra != null &&
    rs != null &&
    daily >= T.heating.minDaily &&
    intra > T.heating.minIntra &&
    rs >= T.heating.minRs &&
    abc === T.heating.requireAbc;
  if (isHeating) return "heating";

  const isCooling =
    (daily != null && daily <= T.cooling.maxDaily) ||
    (d5 != null && abc === "C" && d5 < T.cooling.max5d) ||
    (dist_sma50_atr != null && dist_sma50_atr < T.cooling.maxDistSma50Atr);
  if (isCooling) return "cooling";

  const isAccumulate =
    rs != null &&
    d5 != null &&
    rs >= T.accumulate.minRs &&
    d5 > T.accumulate.min5d &&
    (abc === "A" || abc === "B");
  if (isAccumulate) return "accumulate";

  return "neutral";
}

export function themeLabel(ticker: string): string {
  return THEME_LABELS[ticker] ?? ticker;
}
