import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import yahooFinance from "yahoo-finance2";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { callLLM } from "@/utils/llm-router";
import {
  buildPrompt as buildStockPrompt,
  SYSTEM_PROMPT as stockAnalystSystem,
  type StockDisplayFields,
} from "@/lib/trader-scorer-stock/handler";
import {
  fetchDeepDiveData,
  type DeepDiveGrounding,
} from "../../../../../agents/fundamental/tools/deep-dive-data";

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

type NewsItem = {
  title: string;
  publisher: string | null;
  link: string | null;
  publishedAt: string | null;
};

async function fetchYahooNews(query: string, count = 5): Promise<NewsItem[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = yahooFinance as any;
    const result = await yf.search(query, { quotesCount: 0, newsCount: count });
    const rows = Array.isArray(result?.news) ? result.news : [];
    return rows.slice(0, count).map((n: Record<string, unknown>) => {
      const providerPublishTime = typeof n.providerPublishTime === "number" ? n.providerPublishTime : null;
      return {
        title: String(n.title ?? "").trim(),
        publisher: typeof n.publisher === "string" ? n.publisher : null,
        link: typeof n.link === "string" ? n.link : null,
        publishedAt: providerPublishTime ? new Date(providerPublishTime * 1000).toISOString() : null,
      };
    }).filter((n: NewsItem) => n.title);
  } catch {
    return [];
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

function renderNews(label: string, rows: NewsItem[]): string {
  if (rows.length === 0) return `\n${label}: none returned by Yahoo Finance search.`;
  return `\n${label}:\n${rows.map((n) => {
    const date = n.publishedAt ? n.publishedAt.slice(0, 10) : "undated";
    const publisher = n.publisher ? ` (${n.publisher})` : "";
    return `- ${date}: ${n.title}${publisher}`;
  }).join("\n")}`;
}

function renderDeepDiveGrounding(g: DeepDiveGrounding): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("CATALYST / FILINGS GROUNDING (use only these facts for dated rows; do not invent missing data):");
  lines.push(`- Fetched at: ${g.fetchedAt}`);
  lines.push(`- Availability: ${Object.entries(g.availability).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")}`);
  if (g.profile?.longBusinessSummary) {
    lines.push(`- Business summary: ${g.profile.longBusinessSummary}`);
  }
  if (g.fundamentals) {
    lines.push(`- Fundamentals: revenue=${fmtBig(g.fundamentals.totalRevenue)} revenueGrowth=${g.fundamentals.revenueGrowth != null ? fmt(g.fundamentals.revenueGrowth * 100) + "%" : "N/A"} earningsGrowth=${g.fundamentals.earningsGrowth != null ? fmt(g.fundamentals.earningsGrowth * 100) + "%" : "N/A"} grossMargin=${g.fundamentals.grossMargins != null ? fmt(g.fundamentals.grossMargins * 100) + "%" : "N/A"} profitMargin=${g.fundamentals.profitMargins != null ? fmt(g.fundamentals.profitMargins * 100) + "%" : "N/A"} ROE=${g.fundamentals.returnOnEquity != null ? fmt(g.fundamentals.returnOnEquity * 100) + "%" : "N/A"} FCF=${fmtBig(g.fundamentals.freeCashflow)}`);
  }
  if (g.insiderTransactions.length) {
    lines.push("INSIDER TRANSACTIONS:");
    for (const t of g.insiderTransactions.slice(0, 12)) {
      lines.push(`- ${t.date?.slice(0, 10) ?? "undated"} | ${t.filer ?? "unknown"} (${t.relation ?? "unknown"}) | ${t.transaction ?? "unknown"} | shares=${t.shares ?? "N/A"} value=${t.value ?? "N/A"}`);
    }
  } else {
    lines.push("INSIDER TRANSACTIONS: none returned by fetched source.");
  }
  if (g.institutional) {
    lines.push(`INSTITUTIONAL OWNERSHIP: heldByInstitutions=${g.institutional.heldPercentInstitutions != null ? fmt(g.institutional.heldPercentInstitutions * 100) + "%" : "N/A"} heldByInsiders=${g.institutional.heldPercentInsiders != null ? fmt(g.institutional.heldPercentInsiders * 100) + "%" : "N/A"}`);
    for (const h of g.institutional.topHolders.slice(0, 6)) {
      lines.push(`- ${h.organization ?? "unknown"} | pctHeld=${h.pctHeld != null ? fmt(h.pctHeld * 100) + "%" : "N/A"} | value=${h.value ?? "N/A"} | reportDate=${h.reportDate?.slice(0, 10) ?? "N/A"}`);
    }
  } else {
    lines.push("INSTITUTIONAL OWNERSHIP: none returned by fetched source.");
  }
  if (g.recommendationTrend.length) {
    lines.push("ANALYST RECOMMENDATION TREND:");
    for (const r of g.recommendationTrend) {
      lines.push(`- ${r.period ?? "unknown"}: strongBuy=${r.strongBuy ?? "N/A"} buy=${r.buy ?? "N/A"} hold=${r.hold ?? "N/A"} sell=${r.sell ?? "N/A"} strongSell=${r.strongSell ?? "N/A"}`);
    }
  }
  if (g.upgradeDowngradeHistory.length) {
    lines.push("ANALYST UPGRADE / DOWNGRADE HISTORY:");
    for (const u of g.upgradeDowngradeHistory.slice(0, 15)) {
      lines.push(`- ${u.date?.slice(0, 10) ?? "undated"} | ${u.firm ?? "unknown"} | ${u.fromGrade ?? "?"} -> ${u.toGrade ?? "?"} | action=${u.action ?? "unknown"}`);
    }
  } else {
    lines.push("ANALYST UPGRADE / DOWNGRADE HISTORY: none returned by fetched source.");
  }
  if (g.calendar) {
    lines.push(`UPCOMING CALENDAR: earnings=${g.calendar.earningsDates.map((d) => d.slice(0, 10)).join(", ") || "N/A"} exDividend=${g.calendar.exDividendDate?.slice(0, 10) ?? "N/A"} dividend=${g.calendar.dividendDate?.slice(0, 10) ?? "N/A"}`);
  } else {
    lines.push("UPCOMING CALENDAR: none returned by fetched source.");
  }
  if (g.news.length) {
    lines.push("RECENT NEWS HEADLINES:");
    for (const n of g.news.slice(0, 15)) {
      lines.push(`- ${n.publishedAt?.slice(0, 10) ?? "undated"} | ${n.publisher ?? "unknown"} | ${n.title} | ${n.link ?? "no-link"}`);
    }
  } else {
    lines.push("RECENT NEWS HEADLINES: none returned by fetched source.");
  }
  if (g.errors.length) {
    lines.push(`FETCH ERRORS: ${g.errors.join("; ")}`);
  }
  return lines.join("\n");
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

function operatorFromSheetTab(sheetTab: string | null | undefined): string | null {
  const m = (sheetTab ?? "").match(/\[([A-Za-z0-9]{2,8})\]/);
  return m?.[1]?.toUpperCase() ?? null;
}

function dateOnly(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function score(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const m = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    const [tickerNews, sectorNews, deepDiveGrounding] = await Promise.all([
      fetchYahooNews(`${ticker} stock`, 6),
      sector ? fetchYahooNews(`${sector} stocks`, 4) : Promise.resolve([]),
      fetchDeepDiveData(ticker),
    ]);

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
${screenerExtra}
${renderNews("LATEST TICKER NEWS", tickerNews)}
${renderNews("LATEST SECTOR NEWS", sectorNews)}
${renderDeepDiveGrounding(deepDiveGrounding)}`;

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
    const llmMeta: { providerUsed?: string; modelUsed?: string; note?: string } = {};
    const raw = await callLLM(prompt, stockAnalystSystem, { maxTokens: 3800, provider, tier: "fast" }, llmMeta);

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

    const connection = await prisma.spreadsheetConnection.findUnique({
      where: { userId },
      select: { sheetTab: true },
    });
    const operatorLabel = operatorFromSheetTab(connection?.sheetTab);

    // Persist dashboard-triggered ad-hoc analyses so provider output does not
    // evaporate after the modal closes. We only write when the account has an
    // explicit operator label; otherwise, skip rather than leaking into JS.
    let dashboardIngest: { ok: boolean; reason?: string; id?: string; action?: string } = {
      ok: false,
      reason: "No operator label on spreadsheet connection",
    };
    if (operatorLabel) {
      const tradeDate = dateOnly(new Date());
      const year = tradeDate.toISOString().slice(0, 4);
      const existing = await prisma.wikiTradeVerdict.findUnique({
        where: { operatorLabel_tradeDate_ticker: { operatorLabel, tradeDate, ticker } },
        select: { id: true, intent: true },
      });
      const entryPlan = (analysis.entry_plan ?? {}) as Record<string, unknown>;
      const compositeScore = score(analysis.composite_score);
      const day0Json = JSON.parse(JSON.stringify({
        ticker,
        entry_date: tradeDate.toISOString().slice(0, 10),
        intent: "analysis",
        setup_classification: "STOCK-ANALYSIS",
        setup_justification: text(analysis.composite_note),
        composite_technical_score: compositeScore,
        best_style_match: text(analysis.best_match_trader),
        weakest_dimension: null,
        predicted_outcome: text(analysis.composite_note) ?? text(analysis.composite_verdict),
        predicted_exit_price: firstPrice(entryPlan.target),
        predicted_stop_price: firstPrice(entryPlan.stop),
        model: llmMeta.modelUsed ?? provider ?? "unknown",
        provider: llmMeta.providerUsed ?? provider ?? null,
        verdict_timestamp: new Date().toISOString(),
        eli12: analysis.eli12 ?? [],
        professional_summary: text(analysis.professional_summary),
        hot_theme: text(analysis.hot_theme),
        catalysts: Array.isArray(analysis.catalysts) ? analysis.catalysts : [],
        significant_fundamentals: Array.isArray(analysis.significant_fundamentals) ? analysis.significant_fundamentals : [],
        recent_events: Array.isArray(analysis.recent_events) ? analysis.recent_events : [],
        insider_institutional_activity: Array.isArray(analysis.insider_institutional_activity) ? analysis.insider_institutional_activity : [],
        peer_sector_trend: analysis.peer_sector_trend ?? null,
        upcoming_catalysts: Array.isArray(analysis.upcoming_catalysts) ? analysis.upcoming_catalysts : [],
        analyst_target_changes: Array.isArray(analysis.analyst_target_changes) ? analysis.analyst_target_changes : [],
        big_move_reasons: Array.isArray(analysis.big_move_reasons) ? analysis.big_move_reasons : [],
        medical_biotech_risk: text(analysis.medical_biotech_risk),
        unverified_flags: Array.isArray(analysis.unverified_flags) ? analysis.unverified_flags : [],
        ticker_news: tickerNews,
        sector_news: sectorNews,
        grounding_availability: deepDiveGrounding.availability,
        grounding_errors: deepDiveGrounding.errors,
        raw_stock_analysis: analysis,
      })) as Prisma.InputJsonObject;

      if (!existing) {
        const row = await prisma.wikiTradeVerdict.create({
          data: { operatorLabel, intent: "analysis", tradeDate, ticker, year, day0Json },
          select: { id: true },
        });
        dashboardIngest = { ok: true, id: row.id, action: "created" };
      } else if (existing.intent === "analysis") {
        const row = await prisma.wikiTradeVerdict.update({
          where: { id: existing.id },
          data: { day0Json, year, ingestedAt: new Date() },
          select: { id: true },
        });
        dashboardIngest = { ok: true, id: row.id, action: "updated" };
      } else {
        dashboardIngest = {
          ok: false,
          reason: "Journal verdict already exists for this ticker/date; analysis row not overwritten",
        };
      }
    }

    analysis.dashboard_ingest = dashboardIngest;

    // Quota: increment only after successful LLM call + parse + best-effort persist.
    // Failed runs do NOT consume quota.
    await incrementScanCount(userId);

    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
