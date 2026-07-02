#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(__filename), "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromAppRoot(value) {
  return path.isAbsolute(value) ? value : path.join(appRoot, value);
}

function toNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanTag(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();
}

function scoreToVerdict(score, fallback) {
  const normalizedFallback = String(fallback ?? "").toUpperCase();
  if (normalizedFallback === "WAIT") return "WATCH";
  if (["GO", "WATCH", "PASS"].includes(normalizedFallback)) return normalizedFallback;
  if (score == null) return "WATCH";
  if (score >= 75) return "GO";
  if (score >= 50) return "WATCH";
  return "PASS";
}

function scoreRange(score, verdict) {
  if (score != null) {
    const spread = 6;
    return [Math.max(0, score - spread), Math.min(100, score + spread)];
  }
  if (verdict === "GO") return [75, 100];
  if (verdict === "WATCH") return [50, 74];
  return [0, 49];
}

function setupTags(row, rvol) {
  const tags = new Set();
  const setup = cleanTag(row.setupClassification || "UNKNOWN-SETUP");
  const isBreakout = /^(BO|EP|GAPPER|ORH)/.test(setup);
  const isPullback = /(PB|PULLBACK|MA|21EMA)/.test(setup);
  tags.add(setup);
  if (row.screenSource) tags.add(cleanTag(row.screenSource));
  if (isBreakout) tags.add("breakout");
  if (isPullback) tags.add("pullback");
  if (rvol != null && rvol >= 1.5 && isBreakout) {
    tags.add("volume expansion");
  }
  if (rvol != null && rvol <= 1 && isPullback) {
    tags.add("volume contraction");
  }
  return Array.from(tags);
}

function riskFlags(row, verdict, rvol) {
  const setup = cleanTag(row.setupClassification || "");
  const flags = new Set();
  if (verdict !== "GO") flags.add("not go");
  if (rvol != null && rvol < 1.5 && /^(BO|EP|GAPPER|ORH)/.test(setup)) {
    flags.add("low rvol breakout");
  }
  if (/(PARABOLIC|EXTENDED)/.test(setup)) {
    flags.add("extended");
  }
  if (row.entryGrade === "C") {
    flags.add("weak entry grade");
  }
  return Array.from(flags);
}

function mustMention(row, rvol) {
  const phrases = [];
  const setup = cleanTag(row.setupClassification || "");
  if (setup) phrases.push(setup);
  if (/(PB|PULLBACK|MA|21EMA)/.test(setup)) phrases.push("pullback");
  if (/^(BO|EP|GAPPER|ORH)/.test(setup)) phrases.push("breakout");
  if (rvol != null) phrases.push("RVOL");
  return phrases.slice(0, 4);
}

function caseId(row, index, anonymize) {
  const date = row.pickDate.toISOString().slice(0, 10);
  const ticker = anonymize ? `case-${String(index + 1).padStart(3, "0")}` : row.ticker;
  return `${date}-${ticker}-${cleanTag(row.setupClassification || "setup").toLowerCase()}`;
}

function renderBrief(row, verdict, score, tags, flags, rvol, anonymize, index) {
  const ticker = anonymize ? `CASE-${String(index + 1).padStart(3, "0")}` : row.ticker;
  const setup = row.setupClassification || "UNKNOWN-SETUP";
  const parts = [
    `${ticker} is a ${setup} candidate from ${row.screenSource || "unknown source"}.`,
    `Verdict ${verdict} with Conviction Score ${score ?? "unscored"}.`,
  ];
  if (rvol != null) parts.push(`RVOL is ${rvol}.`);
  if (tags.some((tag) => String(tag).toLowerCase().includes("pullback"))) {
    parts.push("Treat this as a pullback setup; low RVOL can be constructive if volume is contracting.");
  }
  if (tags.some((tag) => String(tag).toLowerCase().includes("breakout"))) {
    parts.push("Treat this as a breakout setup; volume expansion matters.");
  }
  if (flags.length) parts.push(`Risk flags: ${flags.join(", ")}.`);
  const thesis = row.day0Thesis?.trim();
  return thesis ? `${thesis} ${parts.join(" ")}` : parts.join(" ");
}

const limit = Number(argValue("--limit", "24"));
const outputDir = resolveFromAppRoot(
  argValue("--output-dir", "evals/trading-brief/generated"),
);
const anonymize = hasFlag("--anonymize");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Run with: node --env-file=.env.local scripts/export-neon-trading-eval.mjs");
  process.exit(2);
}

const prisma = new PrismaClient();

try {
  const rows = await prisma.aListCandidate.findMany({
    where: {
      day0Score: { not: null },
      day0Verdict: { not: null },
      setupClassification: { not: null },
    },
    orderBy: [{ pickDate: "desc" }, { day0Score: "desc" }],
    take: limit,
    select: {
      ticker: true,
      pickDate: true,
      setupClassification: true,
      screenSource: true,
      day0Score: true,
      day0Verdict: true,
      day0Rvol: true,
      day0Thesis: true,
      entryGrade: true,
      day14Outcome: true,
      day14Score: true,
    },
  });

  if (rows.length === 0) {
    throw new Error("No AListCandidate rows found with day0Score, day0Verdict, and setupClassification.");
  }

  const cases = [];
  const results = [];

  rows.forEach((row, index) => {
    const id = caseId(row, index, anonymize);
    const score = toNumber(row.day0Score);
    const rvol = toNumber(row.day0Rvol);
    const verdict = scoreToVerdict(score, row.day0Verdict);
    const tags = setupTags(row, rvol);
    const flags = riskFlags(row, verdict, rvol);
    const phrases = mustMention(row, rvol);

    cases.push({
      id,
      name: `${row.setupClassification} ${verdict} from Neon A-list data`,
      source: {
        table: "AListCandidate",
        pickDate: row.pickDate.toISOString().slice(0, 10),
        ticker: anonymize ? undefined : row.ticker,
      },
      input: {
        ticker: anonymize ? `CASE-${String(index + 1).padStart(3, "0")}` : row.ticker,
        setup: row.setupClassification,
        screenSource: row.screenSource,
        rvol,
        priorVerdict: row.day0Verdict,
        day14Outcome: row.day14Outcome,
      },
      expected: {
        verdict,
        scoreRange: scoreRange(score, verdict),
        setupTagsRequired: tags,
        riskFlagsRequired: flags,
        riskFlagsForbidden:
          tags.includes("volume contraction") || row.setupClassification === "PB-21EMA"
            ? ["auto fail", "low rvol breakout"]
            : [],
        mustMention: phrases,
      },
    });

    results.push({
      id,
      verdict,
      convictionScore: score,
      setupTags: tags,
      riskFlags: flags,
      brief: renderBrief(row, verdict, score, tags, flags, rvol, anonymize, index),
      source: {
        table: "AListCandidate",
        pickDate: row.pickDate.toISOString().slice(0, 10),
        ticker: anonymize ? undefined : row.ticker,
      },
    });
  });

  await fs.mkdir(outputDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const goldenSet = {
    schemaVersion: 1,
    description: "Generated from Neon AListCandidate rows. Local artifact; do not commit.",
    generatedAt,
    source: "neon:AListCandidate",
    scoreScale: "0-100",
    cases,
  };
  const resultSet = {
    schemaVersion: 1,
    model: "neon-alist-baseline",
    generatedAt,
    source: "neon:AListCandidate",
    results,
  };

  const casesPath = path.join(outputDir, "neon-golden-set.json");
  const resultsPath = path.join(outputDir, "neon-results.json");
  await fs.writeFile(casesPath, JSON.stringify(goldenSet, null, 2) + "\n");
  await fs.writeFile(resultsPath, JSON.stringify(resultSet, null, 2) + "\n");

  console.log(`Exported ${rows.length} Neon A-list rows`);
  console.log(`Cases:   ${path.relative(appRoot, casesPath)}`);
  console.log(`Results: ${path.relative(appRoot, resultsPath)}`);
  console.log("These files are local generated artifacts and are ignored by git.");
} finally {
  await prisma.$disconnect();
}
