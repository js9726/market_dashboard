/**
 * Broker CSV format detection + column-mapping presets.
 *
 * Each format declares:
 *   - `detect`: a list of header columns that uniquely identify this broker
 *   - `map`: { ourField: their header name(s) }
 *   - `dateFormat`: format string for executedAt parsing (or null = ISO parse)
 *   - `sideMap`: how this broker labels BUY/SELL (e.g. Schwab uses 'Buy'/'Sell')
 *   - `tickerTransform`: optional fn to convert their ticker → our 'US.HUT' format
 *
 * Adding a new broker: add a new entry to BROKER_FORMATS.
 */

export type CsvFieldMap = {
  ticker: string;
  date: string;
  side: string;
  qty: string;
  price: string;
  fees?: string[];     // some brokers split fees across multiple columns (e.g. Fidelity)
  notes?: string;
};

export type BrokerFormat = {
  name: string;        // matches BrokerPreset.name when possible
  detect: string[];    // header signature (case-insensitive substring match)
  map: CsvFieldMap;
  sideMap: { buy: string[]; sell: string[] };
  // Optional default ticker prefix when CSV has bare symbols (e.g. Schwab "AAPL" → "US.AAPL")
  defaultPrefix?: string;
};

export const BROKER_FORMATS: BrokerFormat[] = [
  {
    name: "Charles Schwab",
    detect: ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
    map: {
      ticker: "Symbol",
      date: "Date",
      side: "Action",
      qty: "Quantity",
      price: "Price",
      fees: ["Fees & Comm"],
    },
    sideMap: { buy: ["Buy", "Reinvest"], sell: ["Sell"] },
    defaultPrefix: "US",
  },
  {
    name: "Fidelity",
    detect: ["Run Date", "Action", "Symbol", "Quantity", "Price ($)", "Commission ($)"],
    map: {
      ticker: "Symbol",
      date: "Run Date",
      side: "Action",
      qty: "Quantity",
      price: "Price ($)",
      fees: ["Commission ($)", "Fees ($)"],
    },
    sideMap: { buy: ["YOU BOUGHT", "Bought", "Buy"], sell: ["YOU SOLD", "Sold", "Sell"] },
    defaultPrefix: "US",
  },
  {
    name: "IBKR Flex",
    detect: ["Asset Category", "Symbol", "Date/Time", "Quantity", "T. Price", "Comm/Fee"],
    map: {
      ticker: "Symbol",
      date: "Date/Time",
      side: "Quantity",  // IBKR uses signed quantity (negative = sell)
      qty: "Quantity",
      price: "T. Price",
      fees: ["Comm/Fee"],
    },
    sideMap: { buy: [], sell: [] },  // determined by quantity sign
    defaultPrefix: "US",
  },
  {
    name: "moomoo (Malaysia)",
    detect: ["Code", "Trade Time", "Order Direction", "Filled Quantity", "Average Price"],
    map: {
      ticker: "Code",
      date: "Trade Time",
      side: "Order Direction",
      qty: "Filled Quantity",
      price: "Average Price",
      fees: ["Commission"],
    },
    sideMap: { buy: ["Buy"], sell: ["Sell"] },
  },
];

/** Best-effort detection. Returns the format whose detect list has the most header matches. */
export function detectBrokerFormat(headers: string[]): BrokerFormat | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  let best: { format: BrokerFormat; score: number } | null = null;

  for (const format of BROKER_FORMATS) {
    let score = 0;
    for (const sig of format.detect) {
      if (lowerHeaders.some((h) => h.includes(sig.toLowerCase()))) score++;
    }
    // Need at least half the signature columns to consider it a match
    if (score >= Math.ceil(format.detect.length / 2)) {
      if (!best || score > best.score) best = { format, score };
    }
  }
  return best?.format ?? null;
}

/** Minimal RFC4180-ish CSV parser. Handles quoted fields with commas and escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;  // CRLF
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

/** Parse a price/quantity string that may have $ signs, commas, parentheses for negatives. */
export function parseNumeric(s: string): number | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed === "" || trimmed === "--") return null;
  const isNeg = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[(),$]/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isNeg ? -n : n;
}
