import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { callLLM } from "@/utils/llm-router";

const TRADER_PROFILES = [
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

const systemPrompt = `You are an expert trading coach reviewing trades using the SEPA scoring rubric.
For each trader, score three dimensions: Entry Quality (0–4), Risk Management (0–3), Setup Alignment (0–3). Max = 10.
Use your knowledge of the stock (sector, industry, fundamentals, recent catalysts, technical context at the trade date) to make the review accurate.
Return ONLY valid JSON — no markdown fences, no extra text.`;

type TradePromptInput = {
  ticker: string;
  tradeDate?: string | Date | null;
  side?: string | null;
  buyPrice: string;
  exitPrice?: string | null;
  quantity?: string | null;
  fees?: string | null;
  pnl?: string | null;
  notes?: string | null;
  strategy?: string | null;
  industry?: string | null;
  platform?: string | null;
  proposedEntry?: string | null;
  proposedSL?: string | null;
  proposedTP?: string | null;
  rrr?: string | null;
  riskPct?: string | null;
  rewardPct?: string | null;
  positionPct?: string | null;
};

function parseNumeric(value?: string | null): number | null {
  return value == null || value === "" ? null : parseFloat(value);
}

function buildPrompt(trade: TradePromptInput): string {
  const isOpen = trade.pnl == null;
  const pnlNum = isOpen ? null : parseNumeric(trade.pnl);
  const buyPrice = parseNumeric(trade.buyPrice);
  const quantity = parseNumeric(trade.quantity);
  const pnlPct = pnlNum != null && buyPrice != null && quantity != null
    ? ((pnlNum / (buyPrice * quantity)) * 100).toFixed(2)
    : null;

  const hasPlan = trade.proposedEntry || trade.proposedSL || trade.proposedTP;
  const planSection = hasPlan ? `
Pre-trade plan:
- Planned entry: ${parseNumeric(trade.proposedEntry) != null ? "$" + parseNumeric(trade.proposedEntry)!.toFixed(2) : "N/A"}
- Stop loss: ${parseNumeric(trade.proposedSL) != null ? "$" + parseNumeric(trade.proposedSL)!.toFixed(2) : "N/A"}${parseNumeric(trade.riskPct) != null ? " (risk: " + parseNumeric(trade.riskPct)!.toFixed(1) + "%)" : ""}
- Target: ${parseNumeric(trade.proposedTP) != null ? "$" + parseNumeric(trade.proposedTP)!.toFixed(2) : "N/A"}${parseNumeric(trade.rewardPct) != null ? " (reward: " + parseNumeric(trade.rewardPct)!.toFixed(1) + "%)" : ""}${parseNumeric(trade.rrr) != null ? " (RRR: " + parseNumeric(trade.rrr)!.toFixed(2) + ")" : ""}
- Position size: ${parseNumeric(trade.positionPct) != null ? parseNumeric(trade.positionPct)!.toFixed(1) + "%" : "N/A"}` : "";

  const traderList = TRADER_PROFILES.map((t) =>
    `${t.handle}\nStyle: ${t.style}\nDimensions: ${t.dimensions}`
  ).join("\n\n");

  return `Review this ${isOpen ? "open" : "closed"} trade.

TRADE DETAILS:
- Ticker: ${trade.ticker}
- Date: ${trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "N/A"}
- Side: ${trade.side ?? "Long"}
- Entry: $${buyPrice?.toFixed(2) ?? "N/A"}
- Exit: ${parseNumeric(trade.exitPrice) != null ? "$" + parseNumeric(trade.exitPrice)!.toFixed(2) : "Still open"}
- Quantity: ${trade.quantity ?? "N/A"}
- Fees: ${parseNumeric(trade.fees) != null ? "$" + parseNumeric(trade.fees)!.toFixed(2) : "N/A"}
- P&L: ${isOpen ? "Open position" : `$${pnlNum! >= 0 ? "+" : ""}${pnlNum!.toFixed(2)} (${pnlPct}%)`}
- Strategy: ${trade.strategy ?? "N/A"}
- Industry: ${trade.industry ?? "N/A"}
- Platform: ${trade.platform ?? "N/A"}
- Notes: ${trade.notes ?? "None"}
${planSection}

Using your knowledge of ${trade.ticker} around ${trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "the trade date"}, infer the stock's sector, industry, fundamental quality, recent catalysts, and technical structure at that time.

TRADER PROFILES:
${traderList}

Score each trader using Entry Quality (0–4) + Risk Management (0–3) + Setup Alignment (0–3) = total /10.

Return ONLY this JSON (no markdown):
{
  "ticker": "${trade.ticker}",
  "sector": "<inferred sector>",
  "industry": "<inferred industry>",
  "market_cap_tier": "<Large/Mid/Small/Micro>",
  "is_open": ${isOpen},
  "trader_reviews": [
    {
      "handle": "@markminervini",
      "entry_score": <0-4>,
      "risk_score": <0-3>,
      "setup_score": <0-3>,
      "total_score": <0-10>,
      "verdict": "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
      "note": "<2-3 sentences from this trader's perspective>"
    }
  ],
  "best_match": "<handle of trader whose style this most resembles>",
  "weakest_dimension": "<Entry Quality | Risk Management | Setup Alignment>",
  "bull_case": ["<reason 1>", "<reason 2>", "<reason 3>"],
  "bear_case": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "entry_plan": {
    "ideal_entry": "<price or condition>",
    "stop_loss": "<price or condition>",
    "target_1": "<price or condition>",
    "target_2": "<price or condition>",
    "position_size": "<% of portfolio recommendation>",
    "batch_sells": [
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" }
    ]
  },
  "overall_score": <0-10 weighted average>,
  "overall_verdict": "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
  "lesson": "<1-2 sentence key takeaway>"
}`;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const tradeId: string | undefined = body.tradeId;
    const force: boolean = body.force === true;

    let tradeData = body.trade;

    // If tradeId provided, fetch from DB and check cache
    if (tradeId) {
      const dbTrade = await prisma.trade.findUnique({
        where: { id: tradeId, userId: session.user.id },
      });
      if (!dbTrade) {
        return NextResponse.json({ error: "Trade not found" }, { status: 404 });
      }

      // Return cached verdict if not forcing a rerun
      if (!force && dbTrade.verdict) {
        return NextResponse.json(dbTrade.verdict);
      }

      // Use DB record as trade data
      tradeData = {
        ticker: dbTrade.ticker,
        tradeDate: dbTrade.tradeDate,
        side: dbTrade.side,
        buyPrice: dbTrade.buyPrice?.toString(),
        exitPrice: dbTrade.exitPrice?.toString(),
        quantity: dbTrade.quantity?.toString(),
        fees: dbTrade.fees?.toString(),
        pnl: dbTrade.pnl?.toString() ?? null,
        notes: dbTrade.notes,
        strategy: dbTrade.strategy,
        industry: dbTrade.industry,
        platform: dbTrade.platform,
        proposedEntry: dbTrade.proposedEntry?.toString(),
        proposedSL: dbTrade.proposedSL?.toString(),
        proposedTP: dbTrade.proposedTP?.toString(),
        rrr: dbTrade.rrr?.toString(),
        riskPct: dbTrade.riskPct?.toString(),
        rewardPct: dbTrade.rewardPct?.toString(),
        positionPct: dbTrade.positionPct?.toString(),
      };
    }

    if (!tradeData?.ticker || !tradeData?.buyPrice) {
      return NextResponse.json({ error: "trade.ticker and trade.buyPrice are required" }, { status: 400 });
    }

    const prompt = buildPrompt(tradeData);
    const raw = await callLLM(prompt, systemPrompt, { maxTokens: 3000 });

    let review: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      review = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON. Please try again." }, { status: 500 });
    }

    // Compute composite score for badge
    const overallScore = typeof review.overall_score === "number" ? review.overall_score : null;

    // Save to DB if we have a tradeId
    if (tradeId) {
      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          verdict: review as import("@prisma/client").Prisma.InputJsonValue,
          verdictScore: overallScore,
          verdictGeneratedAt: new Date(),
        },
      });
    }

    return NextResponse.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
