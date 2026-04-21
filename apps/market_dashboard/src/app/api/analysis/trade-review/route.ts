import { NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const TRADER_PROFILES = [
  {
    handle: "@markminervini",
    style: "SEPA: tight VCP base, volume dry-up, EPS acceleration, RS new highs. Pivot breakout entry. Stop < 7–8% below pivot. Rewards clean entries on proper bases.",
  },
  {
    handle: "@Clement_Ang17",
    style: "Stage 2 uptrend, 21/50 EMA confluence, ATR-based stops. Rewards structured entries with defined risk and good sector context.",
  },
  {
    handle: "@jftrev",
    style: "Mechanical: A-rated base, confirmed breakout + volume, < 7% stop, no averaging. Rewards rule-based entries with strict adherence.",
  },
  {
    handle: "@TedHZhang",
    style: "Institutional flow + sector rotation + relative strength vs SPY. Rewards entries aligned with institutional accumulation and leading sectors.",
  },
  {
    handle: "@SRxTrades",
    style: "Momentum after consolidation, support/resistance zones, breakout candles, volume profile. Rewards explosive breakout entries with volume confirmation.",
  },
  {
    handle: "@PrimeTrading_",
    style: "Price action precision: candle patterns, EMA/support tests, inside days. Rewards tight low-risk entries at key inflection points.",
  },
];

async function callLLM(provider: string | undefined, prompt: string): Promise<string> {
  const system = `You are an expert trading coach reviewing trades. Analyze the trade quality through specific trader style lenses and return ONLY valid JSON, no markdown fences.`;

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "{}";
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2048,
    });
    return completion.choices[0].message.content ?? "{}";
  }

  if (!process.env.GEMINI_API_KEY) throw new Error("No AI provider available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.");
  const client = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY,
  });
  const completion = await client.chat.completions.create({
    model: "gemini-2.5-pro",
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 2048,
  });
  return completion.choices[0].message.content ?? "{}";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const provider: string | undefined = body.provider;

    const { ticker, side, tradeDate, buyPrice, exitPrice, quantity, fees, pnl, notes } = body.trade ?? {};
    if (!ticker || !buyPrice) {
      return NextResponse.json({ error: "trade.ticker and trade.buyPrice are required" }, { status: 400 });
    }

    const isOpen = pnl == null || pnl === undefined;
    const pnlNum = isOpen ? null : parseFloat(pnl);
    const pnlPct = pnlNum != null && buyPrice && quantity
      ? ((pnlNum / (parseFloat(buyPrice) * parseFloat(quantity))) * 100).toFixed(2)
      : null;

    const tradeContext = `
TRADE DETAILS:
- Ticker: ${ticker}
- Side: ${side ?? "Long"}
- Date: ${tradeDate ? new Date(tradeDate).toLocaleDateString("en-US") : "N/A"}
- Entry Price: $${parseFloat(buyPrice).toFixed(2)}
- Exit Price: ${exitPrice ? "$" + parseFloat(exitPrice).toFixed(2) : "Still open"}
- Quantity: ${quantity ?? "N/A"}
- Fees: ${fees ? "$" + parseFloat(fees).toFixed(2) : "N/A"}
- P&L: ${isOpen ? "Open position" : `$${pnlNum! >= 0 ? "+" : ""}${pnlNum!.toFixed(2)} (${pnlPct}%)`}
- Notes: ${notes || "None"}
`;

    const traderList = TRADER_PROFILES.map((t) => `${t.handle}: ${t.style}`).join("\n\n");

    const prompt = `Review this ${isOpen ? "open" : "closed"} trade through 6 trader style lenses.

${tradeContext}

TRADER PROFILES:
${traderList}

Score the ENTRY QUALITY of this trade from each trader's perspective (1–10). Consider: Was the entry at the right price structure? Was it a clean setup? Was risk defined? For closed trades also comment on exit quality.

Return ONLY this JSON:
{
  "ticker": "${ticker}",
  "is_open": ${isOpen},
  "trader_reviews": [
    {
      "handle": "@markminervini",
      "entry_score": <1-10>,
      "verdict": "<GREAT ENTRY | GOOD ENTRY | AVERAGE | POOR ENTRY | MISTAKE>",
      "note": "<2-3 sentences: was this a valid setup by this trader's rules? What's missing or what's good?>"
    },
    ... (all 6 traders)
  ],
  "strengths": ["<what was done right>", ...],
  "weaknesses": ["<what could be improved>", ...],
  "overall_score": <weighted average 1-10>,
  "overall_verdict": "<GREAT ENTRY | GOOD ENTRY | AVERAGE | POOR ENTRY | MISTAKE>",
  "lesson": "<1-2 sentence key takeaway or improvement for next time>"
}`;

    const raw = await callLLM(provider, prompt);

    let review: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      review = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON. Please try again." }, { status: 500 });
    }

    return NextResponse.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
