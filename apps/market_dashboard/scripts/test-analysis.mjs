/**
 * Validation script for the /api/analysis endpoint.
 * Run from apps/market_dashboard: node scripts/test-analysis.mjs
 *
 * Reads AUTH_TOKEN from .env.local to authenticate, then POSTs a test
 * request for $AAPL and asserts that real financial data is returned.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Read .env.local ---
function loadEnv() {
  const envPath = join(__dirname, '..', '.env.local');
  const env = {};
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  } catch {
    console.error('Could not read .env.local — make sure you are running from apps/market_dashboard/');
    process.exit(1);
  }
  return env;
}

const env = loadEnv();
const AUTH_TOKEN = env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('AUTH_TOKEN not found in .env.local');
  process.exit(1);
}

const BASE_URL = 'http://localhost:3000';
const TICKER = 'AAPL';
const today = new Date().toISOString().split('T')[0];

let passed = 0;
let failed = 0;

function check(label, condition, got) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} — got: ${JSON.stringify(got)}`);
    failed++;
  }
}

console.log(`\n=== Analysis Validation — ${TICKER} (${today}) ===\n`);
console.log(`Target: ${BASE_URL}/api/analysis`);
console.log('');

try {
  const res = await fetch(`${BASE_URL}/api/analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `dashboard_session=${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ tickers: [TICKER], end_date: today }),
  });

  if (!res.ok) {
    console.error(`Request failed: HTTP ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const body = await res.json();
  const fund = body?.data?.analyst_signals?.fundamentals_agent?.[TICKER];
  const tech = body?.data?.analyst_signals?.technical_agent?.[TICKER];

  console.log('--- Fundamental Agent ---');
  check(
    'currentPrice is a positive number',
    typeof fund?.metrics?.currentPrice === 'number' && fund.metrics.currentPrice > 0,
    fund?.metrics?.currentPrice
  );
  check(
    'signal is bullish/bearish/neutral',
    ['bullish', 'bearish', 'neutral'].includes(fund?.signal),
    fund?.signal
  );
  check(
    'confidence is 0–100',
    typeof fund?.confidence === 'number' && fund.confidence >= 0 && fund.confidence <= 100,
    fund?.confidence
  );
  check(
    'profitability reasoning is not "Analysis unavailable"',
    fund?.reasoning?.profitability_signal?.details !== 'Analysis unavailable',
    fund?.reasoning?.profitability_signal?.details
  );

  console.log('');
  console.log('--- Technical Agent ---');
  if (!tech) {
    console.log('  ⚠ Technical agent data absent (GEMINI_API_KEY gate or fetch failed)');
  } else {
    check(
      'price > 0',
      typeof tech?.metrics?.price === 'number' && tech.metrics.price > 0,
      tech?.metrics?.price
    );
    check(
      'RSI is between 0 and 100',
      typeof tech?.metrics?.rsi === 'number' && tech.metrics.rsi > 0 && tech.metrics.rsi < 100,
      tech?.metrics?.rsi
    );
    check(
      'SMA-20 > 0',
      typeof tech?.metrics?.moving_averages?.sma_20 === 'number' && tech.metrics.moving_averages.sma_20 > 0,
      tech?.metrics?.moving_averages?.sma_20
    );
  }

  console.log('');
  if (failed === 0) {
    console.log(`PASS — all ${passed} checks passed`);
  } else {
    console.log(`FAIL — ${failed} of ${passed + failed} checks failed`);
    process.exit(1);
  }
} catch (err) {
  console.error('Fetch error (is the dev server running on port 3000?):', err.message);
  process.exit(1);
}
