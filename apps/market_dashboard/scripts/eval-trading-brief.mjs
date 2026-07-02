#!/usr/bin/env node
import fs from "node:fs";
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

function resolveFromAppRoot(value) {
  return path.isAbsolute(value) ? value : path.join(appRoot, value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalize(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(normalize).join(" ");
  if (typeof value === "object") return JSON.stringify(value).toLowerCase();
  return String(value).toLowerCase();
}

function resultText(result) {
  return normalize([
    result.verdict,
    result.convictionScore,
    result.setupTags,
    result.riskFlags,
    result.brief,
    result.summary,
    result.rationale,
    result.citations,
  ]);
}

function includesNeedle(result, needle) {
  return resultText(result).includes(normalize(needle));
}

function scoreList(result, needles, label, issues) {
  if (!needles?.length) return 1;
  const matches = needles.filter((needle) => includesNeedle(result, needle));
  for (const needle of needles) {
    if (!matches.includes(needle)) issues.push(`missing ${label}: ${needle}`);
  }
  return matches.length / needles.length;
}

function scoreForbidden(result, needles, label, issues) {
  if (!needles?.length) return 1;
  const hits = needles.filter((needle) => includesNeedle(result, needle));
  for (const needle of hits) {
    issues.push(`forbidden ${label}: ${needle}`);
  }
  return (needles.length - hits.length) / needles.length;
}

function numericScore(result) {
  const raw = result.convictionScore ?? result.score ?? result.compositeScore;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function evaluateCase(testCase, result) {
  const issues = [];
  if (!result) {
    return { id: testCase.id, points: 0, issues: ["missing result"] };
  }

  const expected = testCase.expected;
  let points = 0;

  const actualVerdict = normalize(result.verdict).toUpperCase();
  const allowedVerdicts = expected.allowedVerdicts ?? [expected.verdict];
  if (allowedVerdicts.map((v) => normalize(v).toUpperCase()).includes(actualVerdict)) {
    points += 30;
  } else {
    issues.push(`verdict ${result.verdict ?? "missing"} not in ${allowedVerdicts.join("/")}`);
  }

  const score = numericScore(result);
  const [minScore, maxScore] = expected.scoreRange;
  if (score != null && score >= minScore && score <= maxScore) {
    points += 25;
  } else {
    issues.push(`score ${score ?? "missing"} outside ${minScore}-${maxScore}`);
  }

  points += 20 * scoreList(result, expected.setupTagsRequired, "setup tag", issues);

  const requiredRisk = scoreList(result, expected.riskFlagsRequired, "risk flag", issues);
  const forbiddenRisk = scoreForbidden(result, expected.riskFlagsForbidden, "risk flag", issues);
  points += 15 * ((requiredRisk + forbiddenRisk) / 2);

  points += 10 * scoreList(result, expected.mustMention, "rationale phrase", issues);

  return {
    id: testCase.id,
    points: Math.round(points * 10) / 10,
    issues,
  };
}

const casesPath = resolveFromAppRoot(
  argValue("--cases", "evals/trading-brief/golden-set.json"),
);
const resultsPath = resolveFromAppRoot(
  argValue("--results", "evals/trading-brief/baseline-results.json"),
);
let minScore = Number(argValue("--min-score", "0.8"));
if (minScore > 1) minScore = minScore / 100;

const goldenSet = readJson(casesPath);
const resultSet = readJson(resultsPath);
const resultsById = new Map((resultSet.results ?? []).map((result) => [result.id, result]));

const rows = goldenSet.cases.map((testCase) => evaluateCase(testCase, resultsById.get(testCase.id)));
const aggregate = rows.reduce((sum, row) => sum + row.points, 0) / (rows.length * 100);

console.log(`Trading brief eval: ${resultSet.model ?? "unknown model"}`);
console.log(`Cases: ${rows.length}`);
for (const row of rows) {
  const status = row.issues.length ? row.issues.join("; ") : "ok";
  console.log(`- ${row.id}: ${row.points.toFixed(1)}/100 (${status})`);
}
console.log(`Aggregate: ${(aggregate * 100).toFixed(1)}%`);
console.log(`Threshold: ${(minScore * 100).toFixed(1)}%`);

if (aggregate < minScore) {
  console.error("Trading brief eval failed quality gate.");
  process.exit(1);
}
