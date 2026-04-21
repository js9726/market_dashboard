import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const TRADER_PROFILES = [
  {
    handle: "@markminervini",
    style: "SEPA/Superperformance. Requires tight VCP base, 3-4 weeks minimum, volume dry-up, ADR > 1.5%, EPS acceleration, RS new highs. Entry on pivot breakout with volume surge. Zero tolerance for wide stops.",
  },
  {
    handle: "@Clement_Ang17",
    style: "Process-driven swing trader. Stage 2 uptrend required. Uses 21/50 EMA confluence, clean base structures, defined risk via ATR stops. Prefers high RS in leading sectors. Holds through minor pullbacks if structure intact.",
  },
  {
    handle: "@jftrev",
    style: "Mechanical rule-based system. A-rated base required. Buys confirmed breakouts with volume, cuts losses < 7%, no averaging down. Strict position sizing (1–2% risk per trade). No discretion override.",
  },
  {
    handle: "@TedHZhang",
    style: "Institutional/TURBOTECTION framework. Monitors sector rotation, relative strength vs SPY. Uses options flow for confirmation. Needs institutional accumulation signals. Avoids extended or overhead-supply-laden charts.",
  },
  {
    handle: "@SRxTrades",
    style: "Technical momentum trader. Focuses on explosive price moves after consolidation. Uses support/resistance zones, breakout candles, volume profile. Rides momentum with trailing stops. Avoids choppy, low-range stocks.",
  },
  {
    handle: "@PrimeTrading_",
    style: "Price action precision. Reads candle patterns, daily/weekly structure. Enters at low-risk inflection points (test of EMA/support, inside days). Tight stops just beyond structure. High R:R setups only.",
  },
];

async function fetchStockData(ticker: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = yahooFinance as any;
  const summary = await yf.quoteSummary(
    ticker,
    { modules: ["price", "financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile", "calendarEvents"] },
    { skipValidation: true }
  );
  return summary as Record<string, unknown>;
}

async function callLLM(provider: string | undefined, prompt: string): Promise<string> {
  const system = `You are an expert stock market analyst. Analyze the provided stock data through the lens of 6 specific trader styles and return ONLY valid JSON, no markdown fences.`;

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

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "N/A";
  return v.toFixed(decimals);
}

function fmtBig(v: number | null | undefined): string {
  if (v == null) return "N/A";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ticker: string = (body.ticker ?? "").toUpperCase().trim();
    const provider: string | undefined = body.provider;

    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    let summary: Awaited<ReturnType<typeof fetchStockData>>;
    try {
      summary = await fetchStockData(ticker);
    } catch {
      return NextResponse.json({ error: `Could not fetch data for ${ticker}. Check the symbol.` }, { status: 404 });
    }

    const p = (summary.price ?? {}) as Record<string, unknown>;
    const fd = (summary.financialData ?? {}) as Record<string, unknown>;
    const sd = (summary.summaryDetail ?? {}) as Record<string, unknown>;
    const ks = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    const ap = (summary.assetProfile ?? {}) as Record<string, unknown>;
    const ce = (summary.calendarEvents ?? {}) as Record<string, unknown>;

    const currentPrice = (p?.regularMarketPrice as number) ?? null;
    const prevClose = (p?.regularMarketPreviousClose as number) ?? null;
    const changePct = currentPrice && prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null;
    const week52High = (sd?.fiftyTwoWeekHigh as number) ?? null;
    const week52Low = (sd?.fiftyTwoWeekLow as number) ?? null;
    const analystPT = (fd?.targetMeanPrice as number) ?? null;
    const earningsObj = (ce as { earnings?: { earningsDate?: { fmt?: string }[] } } | undefined)?.earnings;
    const earningsDate = earningsObj?.earningsDate?.[0]?.fmt ?? null;
    const marketCap = (p?.marketCap as number) ?? null;
    const totalRevenue = (fd?.totalRevenue as number) ?? null;
    const grossMargins = (fd?.grossMargins as number) ?? null;
    const trailingEps = (ks?.trailingEps as number) ?? null;
    const forwardEps = (ks?.forwardEps as number) ?? null;
    const dividendYield = (sd?.dividendYield as number) ?? null;
    const sector = (ap?.sector as string) ?? null;
    const industry = (ap?.industry as string) ?? null;
    const exchange = (p?.exchangeName as string) ?? null;
    const name = (p?.longName as string) ?? (p?.shortName as string) ?? ticker;
    const forwardPE = (sd?.forwardPE as number) ?? null;
    const priceToBook = (ks?.priceToBook as number) ?? null;
    const returnOnEquity = (fd?.returnOnEquity as number) ?? null;
    const revenueGrowth = (fd?.revenueGrowth as number) ?? null;
    const debtToEquity = (fd?.debtToEquity as number) ?? null;
    const currentRatio = (fd?.currentRatio as number) ?? null;
    const freeCashflow = (fd?.freeCashflow as number) ?? null;

    const earningsDays = earningsDate
      ? Math.round((new Date(earningsDate).getTime() - Date.now()) / 86400000)
      : null;

    const stockContext = `
STOCK: ${ticker} — ${name}
Exchange: ${exchange ?? "N/A"} | Sector: ${sector ?? "N/A"} | Industry: ${industry ?? "N/A"}

PRICE DATA:
- Current Price: $${fmt(currentPrice)}
- Change: ${changePct != null ? (changePct >= 0 ? "+" : "") + fmt(changePct) + "%" : "N/A"}
- 52-Week Range: $${fmt(week52Low)} – $${fmt(week52High)}
- Analyst Price Target: ${analystPT ? "$" + fmt(analystPT) : "N/A"}
- Earnings Date: ${earningsDate ?? "N/A"}${earningsDays != null ? ` (${earningsDays > 0 ? "in " + earningsDays + " days" : "today/past"})` : ""}

FUNDAMENTALS:
- Market Cap: ${fmtBig(marketCap)}
- Revenue TTM: ${fmtBig(totalRevenue)}
- Gross Margin: ${grossMargins != null ? fmt(grossMargins * 100) + "%" : "N/A"}
- Trailing EPS: ${trailingEps != null ? "$" + fmt(trailingEps) : "N/A"}
- Forward EPS: ${forwardEps != null ? "$" + fmt(forwardEps) : "N/A"}
- Forward P/E: ${fmt(forwardPE)}
- Price/Book: ${fmt(priceToBook)}
- ROE: ${returnOnEquity != null ? fmt(returnOnEquity * 100) + "%" : "N/A"}
- Revenue Growth YoY: ${revenueGrowth != null ? fmt(revenueGrowth * 100) + "%" : "N/A"}
- Debt/Equity: ${fmt(debtToEquity)}
- Current Ratio: ${fmt(currentRatio)}
- Free Cash Flow: ${fmtBig(freeCashflow)}
- Dividend Yield: ${dividendYield != null ? fmt(dividendYield * 100) + "%" : "None"}
`;

    const traderList = TRADER_PROFILES.map((t) => `${t.handle}: ${t.style}`).join("\n\n");

    const prompt = `Analyze this stock through 6 trader style lenses and return a JSON object.

${stockContext}

TRADER PROFILES:
${traderList}

Return ONLY this JSON structure (no markdown, no explanation):
{
  "name": "${name}",
  "sector": "${sector ?? ""}",
  "industry": "${industry ?? ""}",
  "exchange": "${exchange ?? ""}",
  "price": ${currentPrice ?? "null"},
  "price_change_pct": ${changePct != null ? +changePct.toFixed(2) : "null"},
  "week52_low": ${week52Low ?? "null"},
  "week52_high": ${week52High ?? "null"},
  "analyst_pt": ${analystPT ?? "null"},
  "earnings_date": "${earningsDate ?? ""}",
  "earnings_days": ${earningsDays ?? "null"},
  "market_cap": "${fmtBig(marketCap)}",
  "revenue_ttm": "${fmtBig(totalRevenue)}",
  "gross_margin_pct": ${grossMargins != null ? +(grossMargins * 100).toFixed(1) : "null"},
  "trailing_eps": ${trailingEps ?? "null"},
  "forward_eps": ${forwardEps ?? "null"},
  "dividend_yield_pct": ${dividendYield != null ? +(dividendYield * 100).toFixed(2) : "null"},
  "trader_analysis": [
    {
      "handle": "@markminervini",
      "score": <number 1-10>,
      "verdict": "<STRONG BUY | BUY | HOLD | AVOID | STRONG AVOID>",
      "note": "<2-3 sentence reasoning specific to this trader's style and the stock data>"
    },
    ... (all 6 traders)
  ],
  "entry_plan": {
    "zone": "<price range, e.g. $45.20–$46.00>",
    "stop": "<stop loss price>",
    "target": "<price target>",
    "risk_reward": <number>,
    "batches": "<entry batching strategy, e.g. 50% at breakout, 50% on first pullback>"
  },
  "bulls": ["<bull case point 1>", "<bull case point 2>", "<bull case point 3>"],
  "bears": ["<bear case point 1>", "<bear case point 2>"],
  "composite_score": <number 1-10 weighted average>,
  "composite_verdict": "<STRONG BUY | BUY | HOLD | AVOID | STRONG AVOID>",
  "composite_note": "<1-2 sentence overall summary>",
  "best_match_trader": "<handle of trader whose style fits best>"
}`;

    const raw = await callLLM(provider, prompt);

    let analysis: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON. Please try again." }, { status: 500 });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
