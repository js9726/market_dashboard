import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as schema from "../schema";
const { emptyReport } = schema;
// The app preserves JSX for Next; this Node-only suite compiles the actual view
// locally instead of changing the shared test configuration for unrelated tests.
const source = readFileSync(new URL("../../../components/analysis/ResearchReport.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const require = createRequire(import.meta.url);
const exported: { default?: (props: { report: schema.ResearchReport; sources: schema.Evidence[] }) => ReturnType<typeof createElement> } = {};
new Function("require", "exports", compiled)((name: string) => name === "@/lib/research/schema" ? schema : require(name), exported);
const ResearchReport = exported.default!;

describe("saved research presentation", () => {
  it("shows all missing report sections and seven lenses without fake numbers", () => {
    const report = emptyReport({ id: "job", ticker: "NTAP", provider: "claude", asOf: new Date("2026-10-04T10:00:00Z") });
    const html = renderToStaticMarkup(createElement(ResearchReport, { report, sources: [] }));
    expect(html).toContain("Research incomplete"); expect(html).toContain("Latest catalyst");
    expect(html).toContain("Material news: 90 days"); expect(html).toContain("Daily and weekly charts");
    expect(html).toContain("@Qullamaggie"); expect(html).toContain("@Clement_Ang17");
    expect(html).not.toContain("confidence 50"); expect(html).not.toContain("100/100");
    expect(html.indexOf("Latest catalyst")).toBeLessThan(html.indexOf("What the company does"));
  });
  it("renders generated prose as escaped text", () => {
    const report = emptyReport({ id: "job", ticker: "NTAP", provider: "claude", asOf: new Date("2026-10-04T10:00:00Z") });
    report.summary = '<script>alert("x")</script>';
    const html = renderToStaticMarkup(createElement(ResearchReport, { report, sources: [] }));
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
