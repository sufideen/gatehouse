import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./backoff";

describe("backoffDelayMs", () => {
  it("grows exponentially and is capped", () => {
    const max = () => 0.999999;
    expect(backoffDelayMs(0, max)).toBeLessThan(2_000);
    expect(backoffDelayMs(3, max)).toBeLessThan(16_000);
    expect(backoffDelayMs(20, max)).toBeLessThan(300_000);
  });
  it("spreads retries (jitter) instead of a fixed delay", () => {
    const d = new Set(Array.from({ length: 50 }, () => backoffDelayMs(5)));
    expect(d.size).toBeGreaterThan(20);
  });
  it("can be zero at the low end", () => expect(backoffDelayMs(4, () => 0)).toBe(0));
});
