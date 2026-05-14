/**
 * Canonical trader-style profiles used by the brief-providers system prompt.
 *
 * Source: packages/core-skills/_shared/trader-profiles.json
 * Inlined here so the Vercel bundle has no file-system dependency.
 * When profiles are updated in the shared JSON, sync this file too.
 */

export interface TraderProfile {
  handle: string;
  name: string;
  /** Short (~1-sentence) style description used in prompts */
  styleShort: string;
  /** Dimensions/questions for trade scoring */
  dimensions: string;
}

export const TRADER_PROFILES: TraderProfile[] = [
  {
    handle: "@markminervini",
    name: "Mark Minervini",
    styleShort:
      "SEPA/Superperformance. Stage 2 uptrend ONLY. VCP base required (volatility contracting toward pivot). " +
      "EPS acceleration + RS at new highs. Pivot breakout entry. Stop 7-8% below pivot. " +
      "Score high for: Stage 2 confirmed, proper base >=5wks, clean breakout on volume. " +
      "Score low for: below 50MA, no base, extended entry.",
    dimensions:
      "Entry: is there a VCP/base? Is it Stage 2? Risk: stop defined under pivot? Setup: EPS+RS confirmation?",
  },
  {
    handle: "@Clement_Ang17",
    name: "Clement Ang",
    styleShort:
      "Swing + Superperformance. Liquid leaders only. Pocket pivot or 21EMA pullback entry. " +
      "21/50 EMA confluence. Never cut winners early — trail with moving averages. " +
      "Score high for: liquid A-rated leader, pullback to rising 21EMA on lower volume. " +
      "Score low for: thin stock, no EMA support, chasing extended move.",
    dimensions:
      "Entry: 21EMA pullback or pocket pivot? Risk: EMA-based trailing stop? Setup: liquid leader, sector leading?",
  },
  {
    handle: "@jfsrev",
    name: "Jeff",
    styleShort:
      "Mechanical/Systematic. LoD must be < 60% ATR (tight stop). RVOL required at entry (institutional conviction). " +
      "Not extended > 4x ATR from 50-MA. Delay 30 min post open unless extreme RVOL. No earnings within days. " +
      "Score high for: RVOL confirmed, tight LoD, not extended. " +
      "Score low for: no RVOL, wide stop, pre-earnings.",
    dimensions:
      "Entry: RVOL present? LoD < 60% ATR? Risk: stop width vs ATR? Setup: not extended, no binary events?",
  },
  {
    handle: "@TedHZhang",
    name: "Ted Zhang",
    styleShort:
      "Portfolio Manager/Institutional. Three-pillar thesis: sector leadership + fundamental quality + price structure. " +
      "Longer holds. Score high for: high-quality company, sector leader, clean SMA stack (price>20>50>200), strong thesis. " +
      "Score low for: weak fundamentals, sector laggard, below key MAs.",
    dimensions:
      "Entry: SMA stack intact? Risk: position sized for portfolio? Setup: three-pillar thesis present?",
  },
  {
    handle: "@SRxTrades",
    name: "SRxTrades",
    styleShort:
      "Technical Swing. Two methods: (A) Breakout — tight coil above MAs, volume drying up, trigger = break above resistance on volume. " +
      "(B) MA Pullback — 8/21/50 EMA pullback on LOW volume. " +
      "4-tranche exit: 25% at resistance, 25% at 8EMA break, 25% at 21EMA, 25% at 50EMA. " +
      "Score high for: tight base, clean setup, volume confirms.",
    dimensions:
      "Entry: breakout or MA pullback? Volume confirming? Risk: 4-tranche plan? Setup: coiled above MAs?",
  },
  {
    handle: "@PrimeTrading_",
    name: "Alex Desjardins (PrimeTrading)",
    styleShort:
      "Momentum/Price Action. ONLY 21dma pullbacks — no breakout chasing. " +
      "Entry must be within 0-1x ATR of rising 21dma. Liquid leaders, top RS. Earnings 7+ days away. " +
      "Soft structure stop (close below 21dma = exit). " +
      "Score high for: within ATR of 21dma, liquid, rising 21dma. " +
      "Score low for: extended above 21dma, pre-earnings, illiquid.",
    dimensions:
      "Entry: within 1x ATR of rising 21dma? Risk: close below 21dma as stop? Setup: liquid leader, earnings clear?",
  },
  {
    handle: "@Qullamaggie",
    name: "Qullamaggie",
    styleShort:
      "Momentum Breakouts + Episodic Pivots. Breakout: strong prior 30-100% move, tight 2w-2m base, ORH/daily breakout trigger. " +
      "EP: fresh catalyst, ideally 10%+ gap and huge opening volume. Stop = low of day, not wider than ATR/ADR. " +
      "Risk 0.25-1%, position usually 10-20%, max 30% overnight.",
    dimensions:
      "Entry: clean breakout/ORH or EP trigger? Risk: LOD stop within ATR/ADR and size within 0.25-1% risk? " +
      "Setup: prior momentum or catalyst, tight base/clear air, volume confirmation?",
  },
];

/**
 * Builds the `traderLens` section of the SYSTEM_PROMPT.
 * Lists each trader's style concisely so the LLM can colour views.
 */
export function buildTraderLensBlock(): string {
  const lines = TRADER_PROFILES.map(
    (p) => `- **${p.name}** (${p.handle}): ${p.styleShort}`,
  );
  return lines.join("\n");
}
