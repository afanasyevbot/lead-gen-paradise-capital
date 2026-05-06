import { describe, it, expect } from "vitest";
import { parseIcpResponse } from "@/pipeline/stages/00b-icp-screen";

describe("parseIcpResponse", () => {
  it("parses clean JSON", () => {
    const r = parseIcpResponse('{"match": true, "reason": "founder-owned HVAC"}');
    expect(r).toEqual({ match: true, reason: "founder-owned HVAC" });
  });

  it("strips markdown code fences", () => {
    const r = parseIcpResponse('```json\n{"match": false, "reason": "chain"}\n```');
    expect(r?.match).toBe(false);
    expect(r?.reason).toBe("chain");
  });

  it("extracts JSON when wrapped in commentary", () => {
    const r = parseIcpResponse(
      'Here is my analysis: {"match": true, "reason": "good fit"} — let me know if you need more.'
    );
    expect(r?.match).toBe(true);
  });

  it("handles assistant pre-fill ({-prepended response)", () => {
    // Simulates response when we pre-fill with "{" — full text is "{...key:value}"
    const r = parseIcpResponse('{"match": true, "reason": "fit"}');
    expect(r?.match).toBe(true);
  });

  it("falls back to regex on broken JSON (missing closing brace)", () => {
    const r = parseIcpResponse('{"match": false, "reason": "too small"');
    expect(r?.match).toBe(false);
    // Regex picks up the reason field even from unclosed JSON
    expect(r?.reason).toBe("too small");
  });

  it("falls back to regex on single-quoted JSON", () => {
    const r = parseIcpResponse("{'match': true, 'reason': 'fits'}");
    expect(r?.match).toBe(true);
  });

  it("handles trailing commas", () => {
    // JSON.parse fails on trailing comma — regex fallback should catch it
    const r = parseIcpResponse('{"match": true, "reason": "good",}');
    expect(r?.match).toBe(true);
  });

  it("returns null for empty string", () => {
    expect(parseIcpResponse("")).toBeNull();
  });

  it("returns null when no match key found", () => {
    expect(parseIcpResponse("Sorry, I cannot determine this.")).toBeNull();
  });

  it("returns null when match key has invalid value", () => {
    // Regex requires true|false
    expect(parseIcpResponse('{"match": "yes", "reason": "x"}')).toBeNull();
  });

  it("handles nested braces in reason field", () => {
    const r = parseIcpResponse('{"match": true, "reason": "this {is} fine"}');
    expect(r?.match).toBe(true);
  });
});
