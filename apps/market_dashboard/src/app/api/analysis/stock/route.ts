import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { callLLM } from "@/utils/llm-router";
import {
  buildPrompt as buildStockPrompt,
  SYSTEM_PROMPT as stockAnalystSystem,
  type StockDisplayFields,
} from "@/lib/trader-scorer-stock/handler";

const FULL_MODULES   = ["price", "financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile", "calendarEvents"] as const;
const CORE_MODULES   = ["price", "financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"] as const;
const PRICE_ONLY     = ["price"] as const;

async function fetchStockData(ticker: string): Promise<{ summary: Record<string, unknown>; partial: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = yahooFinance as any;
  // Level 1: full modules including earnings calendar
  try {
    const summary = await yf.quoteSummary(ticker, { modules: FULL_MODULES }, { skipValidation: true });
    return { summary: summary as Record<string, unknown>, partial: false };
  } catch { /* fall through */ }
  // Level 2: core modules without calendarEvents
  try {
    const summary = await yf.quoteSummary(ticker, { modules: CORE_MODULES }, { skipValidation: true });
    return { summary: summary as Record<string, unknown>, partial: false };
  } catch { /* fall through */ }
  // Level 3: price only (minimum viable for scoring)
  try {
    const summary = await yf.quoteSummary(ticker, { modules: PRICE_ONLY }, { skipValidation: true });
    return { summary: summary as Record<string, unknown>, partial: true };
  } catch {
    // All attempts exhausted — caller will use screener hit data only
    throw new Error(`Yahoo Finance unavailable for ${ticker}`);
  }
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

/** Screener hit data optionally passed by the dashboard Score button. */
type HitData = {
  close?: number | null;
  change?: number | null;
  relative_volume_10d_calc?: number | null;
  "Perf.W"?: number | null;
  "Perf.1M"?: number | null;
  market_cap_basic?: number | null;
  sector?: string | null;
  industry?: string | null;
};

export async function POST(request: Request) {
  const guard = await requireUserIdAndQuota();
  if (guard.error) return guard.error;
  const userId = guard.userId;

  try {
    const body = await request.json();
    const ticker: string = (body.ticker ?? "").toUpperCase().trim();
    const provider: string | undefined = body.provider;
    // Optional screener metadata — used as fallback when Yahoo Finance is unavailable
    const hitData: HitData | undefined = body.hitData;

    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    let fetchResult: Awaited<ReturnType<typeof fetchStockData>> | null = null;
    let yahooUnavailable = false;
    try {
      fetchResult = await fetchStockData(ticker);
    } catch {
      yahooUnavailable = true;
      // If we have no screener data either, nothing we can do
      if (!hitData) {
        return NextResponse.json(
          { error: `Could not fetch data for ${ticker}. Check the symbol or try again later.` },
          { status: 404 }
        );
      }
    }

    const summary = fetchResult?.summary ?? {};
    const p = (summary.price ?? {}) as Record<string, unknown>;
    const fd = (summary.financialData ?? {}) as Record<string, unknown>;
    const sd = (summary.summaryDetail ?? {}) as Record<string, unknown>;
    const ks = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    const ap = (summary.assetProfile ?? {}) as Record<string, unknown>;
    const ce = (summary.calendarEvents ?? {}) as Record<string, unknown>;

    // Primary: Yahoo Finance data. Fallback: screener hitData where available.
    const currentPrice = (p?.regularMarketPrice as number) ?? hitData?.close ?? null;
    const prevClose = (p?.regularMarketPreviousClose as number) ?? null;
    const changePct = currentPrice && prevClose
      ? ((currentPrice - prevClose) / prevClose) * 100
      : hitData?.change ?? null;
    const week52High = (sd?.fiftyTwoWeekHigh as number) ?? null;
    const week52Low = (sd?.fiftyTwoWeekLow as number) ?? null;
    const analystPT = (fd?.targetMeanPrice as number) ?? null;
    const earningsObj = (ce as { earnings?: { earningsDate?: { fmt?: string }[] } } | undefined)?.earnings;
    const earningsDate = earningsObj?.earningsDate?.[0]?.fmt ?? null;
    const marketCap = (p?.marketCap as number) ?? hitData?.market_cap_basic ?? null;
    const totalRevenue = (fd?.totalRevenue as number) ?? null;
    const grossMargins = (fd?.grossMargins as number) ?? null;
    const trailingEps = (ks?.trailingEps as number) ?? null;
    const forwardEps = (ks?.forwardEps as number) ?? null;
    const dividendYield = (sd?.dividendYield as number) ?? null;
    const sector = (ap?.sector as string) ?? hitData?.sector ?? null;
    const industry = (ap?.industry as string) ?? hitData?.industry ?? null;
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

    // Extra screener context available when Yahoo Finance is unavailable
    const screenerExtra = yahooUnavailable && hitData
      ? `\nSCREENER DATA (Yahoo Finance unavailable — score based on this data):
- Today's Change: ${hitData.change != null ? (hitData.change >= 0 ? "+" : "") + fmt(hitData.change) + "%" : "N/A"}
- RVOL (10d): ${hitData.relative_volume_10d_calc != null ? fmt(hitData.relative_volume_10d_calc) : "N/A"}
- 1-Week Perf: ${hitData["Perf.W"] != null ? fmt(hitData["Perf.W"]) + "%" : "N/A"}
- 1-Month Perf: ${hitData["Perf.1M"] != null ? fmt(hitData["Perf.1M"]) + "%" : "N/A"}
- Market Cap: ${fmtBig(hitData.market_cap_basic ?? null)}
NOTE: Full fundamental data unavailable. Base your score on the screener data above and general sector context.`
      : (hitData && (hitData.relative_volume_10d_calc != null || hitData["Perf.W"] != null)
          ? `\nSCREENER CONTEXT:
- RVOL (10d): ${hitData.relative_volume_10d_calc != null ? fmt(hitData.relative_volume_10d_calc) : "N/A"}
- 1-Week Perf: ${hitData["Perf.W"] != null ? fmt(hitData["Perf.W"]) + "%" : "N/A"}
- 1-Month Perf: ${hitData["Perf.1M"] != null ? fmt(hitData["Perf.1M"]) + "%" : "N/A"}`
          : "");

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
${screenerExtra}`;

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

    // tier:"fast" keeps the request well inside Vercel's function timeout:
    //   deepseek-chat  → primary (fast + cheap)
    //   gemini-2.0-flash → fallback (2-4 s vs 10-20 s for 2.5-pro)
    const raw = await callLLM(prompt, stockAnalystSystem, { maxTokens: 1024, provider, tier: "fast" });

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
