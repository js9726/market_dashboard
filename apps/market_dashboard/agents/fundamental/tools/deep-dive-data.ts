/**
 * deep-dive-data.ts — yahoo-finance2 grounding for the trade deep-dive scorecard.
 *
 * Fetches the raw facts the 8-section deep-dive needs (company profile, insider +
 * institutional activity, analyst recommendation trend + upgrade/downgrade
 * history, upcoming calendar events, current price, and recent news headlines)
 * and returns them as a single typed grounding object.
 *
 * FAIL-CLOSED CONTRACT: every section carries data OR is explicitly empty. The
 * `availability` map records which sources actually returned rows so the prompt
 * layer can tell the LLM to MARK-as-unverified anything an empty source would
 * otherwise tempt it to invent (especially news links + analyst targets).
 *
 * No interpretation happens here — this is the Data Agent's job. Synthesis is
 * left to the LLM via callLLM in the prompt layer.
 */
import yahooFinance from "yahoo-finance2";
import { withRetry } from "../../../src/utils/retry";

export interface DeepDiveProfile {
  longName: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  fullTimeEmployees: number | null;
  website: string | null;
  longBusinessSummary: string | null;
}

export interface DeepDivePriceFacts {
  currentPrice: number | null;
  changePct: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currency: string | null;
  exchangeName: string | null;
}

export interface DeepDiveFundamentals {
  totalRevenue: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  grossMargins: number | null;
  profitMargins: number | null;
  returnOnEquity: number | null;
  forwardPE: number | null;
  trailingPE: number | null;
  debtToEquity: number | null;
  freeCashflow: number | null;
}

export interface DeepDiveInsiderTxn {
  date: string | null;
  filer: string | null;
  relation: string | null;
  transaction: string | null; // "Buy" | "Sale" | "Stock Award(Grant)" | ...
  shares: number | null;
  value: number | null;
}

export interface DeepDiveInstitutional {
  heldPercentInstitutions: number | null;
  heldPercentInsiders: number | null;
  topHolders: { organization: string | null; pctHeld: number | null; value: number | null; reportDate: string | null }[];
}

export interface DeepDiveRecommendationRow {
  period: string | null; // "0m" | "-1m" | "-2m" | "-3m"
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
}

export interface DeepDiveUpgradeRow {
  date: string | null;
  firm: string | null;
  toGrade: string | null;
  fromGrade: string | null;
  action: string | null; // "up" | "down" | "init" | "main" | "reit"
}

export interface DeepDiveCalendar {
  earningsDates: string[]; // ISO date strings
  exDividendDate: string | null;
  dividendDate: string | null;
}

export interface DeepDiveNewsItem {
  title: string;
  publisher: string | null;
  link: string | null;
  publishedAt: string | null; // ISO
  relatedTickers: string[] | null;
}

export interface DeepDiveGrounding {
  ticker: string;
  fetchedAt: string;
  profile: DeepDiveProfile | null;
  price: DeepDivePriceFacts | null;
  fundamentals: DeepDiveFundamentals | null;
  insiderTransactions: DeepDiveInsiderTxn[];
  institutional: DeepDiveInstitutional | null;
  recommendationTrend: DeepDiveRecommendationRow[];
  upgradeDowngradeHistory: DeepDiveUpgradeRow[];
  calendar: DeepDiveCalendar | null;
  news: DeepDiveNewsItem[];
  /** Which sources returned usable data — drives fail-closed marking downstream. */
  availability: {
    profile: boolean;
    price: boolean;
    fundamentals: boolean;
    insiderTransactions: boolean;
    institutional: boolean;
    recommendationTrend: boolean;
    upgradeDowngradeHistory: boolean;
    calendar: boolean;
    news: boolean;
  };
  /** Non-fatal fetch errors, for diagnostics + the prompt's "unverified" notes. */
  errors: string[];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // yahoo-finance2 sometimes returns { raw } shapes when validation is skipped.
  if (v && typeof v === "object" && "raw" in v) {
    const raw = (v as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") {
    // Yahoo epoch is seconds for some modules.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (v && typeof v === "object" && "raw" in v) return toIso((v as { raw?: unknown }).raw);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Fetch all deep-dive grounding for a ticker. Never throws — partial failures
 * are recorded in `errors` + reflected in `availability`.
 */
export async function fetchDeepDiveData(ticker: string): Promise<DeepDiveGrounding> {
  const errors: string[] = [];
  const sym = ticker.trim().toUpperCase();

  const grounding: DeepDiveGrounding = {
    ticker: sym,
    fetchedAt: new Date().toISOString(),
    profile: null,
    price: null,
    fundamentals: null,
    insiderTransactions: [],
    institutional: null,
    recommendationTrend: [],
    upgradeDowngradeHistory: [],
    calendar: null,
    news: [],
    availability: {
      profile: false,
      price: false,
      fundamentals: false,
      insiderTransactions: false,
      institutional: false,
      recommendationTrend: false,
      upgradeDowngradeHistory: false,
      calendar: false,
      news: false,
    },
    errors,
  };

  const modules = [
    "assetProfile",
    "summaryProfile",
    "price",
    "summaryDetail",
    "financialData",
    "defaultKeyStatistics",
    "insiderTransactions",
    "institutionOwnership",
    "majorHoldersBreakdown",
    "recommendationTrend",
    "upgradeDowngradeHistory",
    "calendarEvents",
  ] as const;

  // ── quoteSummary (one round-trip, all modules) ─────────────────────────────
  let qs: Record<string, unknown> | null = null;
  try {
    qs = await withRetry(
      async () =>
        // @ts-expect-error: yahoo-finance2 types omit the queryOptions 3rd argument
        yahooFinance.quoteSummary(sym, { modules: modules as unknown as string[] }, { skipValidation: true }),
      3,
      2000,
    );
  } catch (e) {
    errors.push(`quoteSummary failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (qs) {
    const assetProfile = (qs.assetProfile ?? qs.summaryProfile) as Record<string, unknown> | undefined;
    const price = qs.price as Record<string, unknown> | undefined;
    const summaryDetail = qs.summaryDetail as Record<string, unknown> | undefined;
    const financialData = qs.financialData as Record<string, unknown> | undefined;
    const keyStats = qs.defaultKeyStatistics as Record<string, unknown> | undefined;
    const insider = qs.insiderTransactions as Record<string, unknown> | undefined;
    const instOwn = qs.institutionOwnership as Record<string, unknown> | undefined;
    const majorHolders = qs.majorHoldersBreakdown as Record<string, unknown> | undefined;
    const recTrend = qs.recommendationTrend as Record<string, unknown> | undefined;
    const upgrades = qs.upgradeDowngradeHistory as Record<string, unknown> | undefined;
    const calendar = qs.calendarEvents as Record<string, unknown> | undefined;

    // Profile
    if (assetProfile) {
      grounding.profile = {
        longName: str(price?.longName) ?? str(price?.shortName),
        sector: str(assetProfile.sector),
        industry: str(assetProfile.industry),
        country: str(assetProfile.country),
        fullTimeEmployees: num(assetProfile.fullTimeEmployees),
        website: str(assetProfile.website),
        longBusinessSummary: str(assetProfile.longBusinessSummary),
      };
      grounding.availability.profile = !!grounding.profile.longBusinessSummary || !!grounding.profile.industry;
    }

    // Price
    if (price) {
      grounding.price = {
        currentPrice: num(price.regularMarketPrice),
        changePct: num(price.regularMarketChangePercent),
        marketCap: num(price.marketCap),
        fiftyTwoWeekHigh: num(summaryDetail?.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: num(summaryDetail?.fiftyTwoWeekLow),
        currency: str(price.currency),
        exchangeName: str(price.exchangeName),
      };
      grounding.availability.price = grounding.price.currentPrice != null;
    }

    // Fundamentals
    if (financialData || keyStats) {
      grounding.fundamentals = {
        totalRevenue: num(financialData?.totalRevenue),
        revenueGrowth: num(financialData?.revenueGrowth),
        earningsGrowth: num(financialData?.earningsGrowth) ?? num(keyStats?.earningsQuarterlyGrowth),
        grossMargins: num(financialData?.grossMargins),
        profitMargins: num(financialData?.profitMargins) ?? num(keyStats?.profitMargins),
        returnOnEquity: num(financialData?.returnOnEquity),
        forwardPE: num(summaryDetail?.forwardPE) ?? num(keyStats?.forwardPE),
        trailingPE: num(summaryDetail?.trailingPE),
        debtToEquity: num(financialData?.debtToEquity),
        freeCashflow: num(financialData?.freeCashflow),
      };
      grounding.availability.fundamentals = Object.values(grounding.fundamentals).some((x) => x != null);
    }

    // Insider transactions
    const insiderRows = (insider?.transactions as Record<string, unknown>[] | undefined) ?? [];
    if (insiderRows.length) {
      grounding.insiderTransactions = insiderRows.slice(0, 25).map((t) => ({
        date: toIso(t.startDate),
        filer: str(t.filerName),
        relation: str(t.filerRelation),
        transaction: str(t.transactionText) ?? str(t.moneyText),
        shares: num(t.shares),
        value: num(t.value),
      }));
      grounding.availability.insiderTransactions = grounding.insiderTransactions.length > 0;
    }

    // Institutional ownership
    const instRows = (instOwn?.ownershipList as Record<string, unknown>[] | undefined) ?? [];
    const instPct = num(majorHolders?.institutionsPercentHeld) ?? num(majorHolders?.institutionsFloatPercentHeld);
    const insiderPct = num(majorHolders?.insidersPercentHeld);
    if (instRows.length || instPct != null || insiderPct != null) {
      grounding.institutional = {
        heldPercentInstitutions: instPct,
        heldPercentInsiders: insiderPct,
        topHolders: instRows.slice(0, 10).map((h) => ({
          organization: str(h.organization),
          pctHeld: num(h.pctHeld),
          value: num(h.value),
          reportDate: toIso(h.reportDate),
        })),
      };
      grounding.availability.institutional =
        grounding.institutional.topHolders.length > 0 || instPct != null;
    }

    // Recommendation trend
    const trendRows = (recTrend?.trend as Record<string, unknown>[] | undefined) ?? [];
    if (trendRows.length) {
      grounding.recommendationTrend = trendRows.map((r) => ({
        period: str(r.period),
        strongBuy: num(r.strongBuy),
        buy: num(r.buy),
        hold: num(r.hold),
        sell: num(r.sell),
        strongSell: num(r.strongSell),
      }));
      grounding.availability.recommendationTrend = grounding.recommendationTrend.length > 0;
    }

    // Upgrade / downgrade history (analyst PT + rating changes)
    const upgradeRows = (upgrades?.history as Record<string, unknown>[] | undefined) ?? [];
    if (upgradeRows.length) {
      grounding.upgradeDowngradeHistory = upgradeRows
        .slice(0, 30)
        .map((u) => ({
          date: toIso(u.epochGradeDate),
          firm: str(u.firm),
          toGrade: str(u.toGrade),
          fromGrade: str(u.fromGrade),
          action: str(u.action),
        }))
        .filter((u) => u.date || u.firm);
      grounding.availability.upgradeDowngradeHistory = grounding.upgradeDowngradeHistory.length > 0;
    }

    // Calendar events (upcoming earnings / dividends)
    if (calendar) {
      const earnings = calendar.earnings as Record<string, unknown> | undefined;
      const rawDates = (earnings?.earningsDate as unknown[] | undefined) ?? [];
      grounding.calendar = {
        earningsDates: rawDates.map(toIso).filter((d): d is string => !!d),
        exDividendDate: toIso(calendar.exDividendDate),
        dividendDate: toIso(calendar.dividendDate),
      };
      grounding.availability.calendar =
        grounding.calendar.earningsDates.length > 0 ||
        grounding.calendar.exDividendDate != null ||
        grounding.calendar.dividendDate != null;
    }
  }

  // ── News headlines (search) ────────────────────────────────────────────────
  try {
    const res = (await withRetry(
      () =>
        // @ts-expect-error: yahoo-finance2 search options type omits some fields
        yahooFinance.search(sym, { newsCount: 15, quotesCount: 0, enableFuzzyQuery: false }, { skipValidation: true }),
      2,
      1500,
    )) as { news?: Record<string, unknown>[] } | undefined;
    const newsRows = res?.news ?? [];
    if (newsRows.length) {
      grounding.news = newsRows
        .map((n) => ({
          title: str(n.title) ?? "",
          publisher: str(n.publisher),
          link: str(n.link),
          publishedAt: toIso(n.providerPublishTime),
          relatedTickers: Array.isArray(n.relatedTickers) ? (n.relatedTickers as string[]) : null,
        }))
        .filter((n) => n.title);
      grounding.availability.news = grounding.news.length > 0;
    }
  } catch (e) {
    errors.push(`news search failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return grounding;
}
