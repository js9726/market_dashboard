import { describe, expect, it } from "vitest";
import { salvageJsonObject } from "../brief/salvage";

describe("salvageJsonObject", () => {
  it("extracts a fenced ```json block", () => {
    const text = 'Here is the brief:\n```json\n{"mood": {"label": "risk-off"}}\n```\nDone.';
    expect(salvageJsonObject(text)).toEqual({ mood: { label: "risk-off" } });
  });

  it("extracts a bare object wrapped in prose (DeepSeek failure mode)", () => {
    const text = 'Sure! {"breadth": {"up": 1200, "down": 2400}} Let me know if you need more.';
    expect(salvageJsonObject(text)).toEqual({ breadth: { up: 1200, down: 2400 } });
  });

  it("returns null for truncated JSON", () => {
    expect(salvageJsonObject('{"mood": {"label": "risk-')).toBeNull();
  });

  it("returns null for arrays and empty input", () => {
    expect(salvageJsonObject("[1,2,3]")).toBeNull();
    expect(salvageJsonObject("")).toBeNull();
  });

  it("prefers the fenced block over surrounding braces", () => {
    const text = 'prefix {bad json} ```json\n{"ok": true}\n``` suffix';
    expect(salvageJsonObject(text)).toEqual({ ok: true });
  });
});
