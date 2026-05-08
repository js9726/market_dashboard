import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { callLLM } from "@/utils/llm-router";
import {
  buildPrompt as buildStockPrompt,
  SYSTEM_PROMPT as stockAnalystSystem,
  type StockDisplayFields,
} from "@core-skills/trader-scorer-stock/handler";

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
  const guard = await requireUserIdAndQuota();
  if (guard.error) return guard.error;
  const userId = guard.userId;

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

    const display: StockDisplayFields = {
      name,
      sector,
      industry,
      exchange,
      currentPrice,
      changePct,
      week52Low,
      week52High,
      analystPT,
      earningsDate,
      earningsDays,
      marketCap: fmtBig(marketCap),
      revenueTtm: fmtBig(totalRevenue),
      grossMarginPct: grossMargins != null ? grossMargins * 100 : null,
      trailingEps,
      forwardEps,
      dividendYieldPct: dividendYield != null ? dividendYield * 100 : null,
    };
    const prompt = buildStockPrompt({ stockContext, display });

    const raw = await callLLM(prompt, stockAnalystSystem, { maxTokens: 2048, provider });

    let analysis: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        "[/api/analysis/stock] LLM returned invalid JSON for ticker=%s. Error: %s. Raw output (first 500 chars): %s",
        ticker,
        parseErr instanceof Error ? parseErr.message : String(parseErr),
        raw.slice(0, 500)
      );
      return NextResponse.json({ error: "AI returned invalid JSON. Please try again." }, { status: 500 });
    }

    // Quota: increment only after successful LLM call + parse. Failed runs do NOT consume quota.
    await incrementScanCount(userId);

    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
