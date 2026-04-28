export interface TraderProfile {
  handle: string;
  style: string;
  dimensions: string;
}

export const TRADER_PROFILES: TraderProfile[] = [
  {
    handle: "@markminervini",
    style: "SEPA/Superperformance. Stage 2 uptrend ONLY. VCP base required (volatility contracting toward pivot). EPS acceleration + RS at new highs. Pivot breakout entry. Stop 7–8% below pivot. Score high for: Stage 2 confirmed, proper base ≥5wks, clean breakout on volume. Score low for: below 50MA, no base, extended entry.",
    dimensions: "Entry: is there a VCP/base? Is it Stage 2? Risk: stop defined under pivot? Setup: EPS+RS confirmation?",
  },
  {
    handle: "@Clement_Ang17",
    style: "Swing + Superperformance. Liquid leaders only. Pocket pivot or 21EMA pullback entry. 21/50 EMA confluence. Never cut winners early — trail with moving averages. Score high for: liquid A-rated leader, pullback to rising 21EMA on lower volume. Score low for: thin stock, no EMA support, chasing extended move.",
    dimensions: "Entry: 21EMA pullback or pocket pivot? Risk: EMA-based trailing stop? Setup: liquid leader, sector leading?",
  },
  {
    handle: "@jfsrev",
    style: "Mechanical/Systematic. LoD must be < 60% ATR (tight stop). RVOL required at entry (institutional conviction). Not extended > 4× ATR from 50-MA. Delay 30 min post open unless extreme RVOL. No earnings within days. Score high for: RVOL confirmed, tight LoD, not extended. Score low for: no RVOL, wide stop, pre-earnings.",
    dimensions: "Entry: RVOL present? LoD < 60% ATR? Risk: stop width vs ATR? Setup: not extended, no binary events?",
  },
  {
    handle: "@TedHZhang",
    style: "Portfolio Manager/Institutional. Three-pillar thesis: sector leadership + fundamental quality + price structure. Longer holds. Score high for: high-quality company, sector leader, clean SMA stack (price>20>50>200), strong thesis. Score low for: weak fundamentals, sector laggard, below key MAs.",
    dimensions: "Entry: SMA stack intact? Risk: position sized for portfolio? Setup: three-pillar thesis present?",
  },
  {
    handle: "@SRxTrades",
    style: "Technical Swing. Two methods: (A) Breakout — tight coil above MAs, volume drying up, trigger = break above resistance on volume. (B) MA Pullback — 8/21/50 EMA pullback on LOW volume. 4-tranche exit: 25% at resistance, 25% at 8EMA break, 25% at 21EMA, 25% at 50EMA. Score high for: tight base, clean setup, volume confirms.",
    dimensions: "Entry: breakout or MA pullback? Volume confirming? Risk: 4-tranche plan? Setup: coiled above MAs?",
  },
  {
    handle: "@PrimeTrading_",
    style: "Momentum/Price Action. ONLY 21dma pullbacks — no breakout chasing. Entry must be within 0–1× ATR of rising 21dma. Liquid leaders, top RS. Earnings 7+ days away. Soft structure stop (close below 21dma = exit). Score high for: within ATR of 21dma, liquid, rising 21dma. Score low for: extended above 21dma, pre-earnings, illiquid.",
    dimensions: "Entry: within 1×ATR of rising 21dma? Risk: close below 21dma as stop? Setup: liquid leader, earnings clear?",
  },
];
