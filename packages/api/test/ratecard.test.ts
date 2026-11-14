import { describe, expect, it } from "vitest";
import { calculateShiftPay, toXeroCsv } from "../src/ratecard";

const pay = (start: string, end: string, prior = 0) =>
  calculateShiftPay({ startUtc: new Date(start), endUtc: new Date(end), hourlyRatePence: 1200, priorWeekHours: prior });

describe("UK rate card", () => {
  it("pays plain day shift at base rate", () => expect(pay("2026-11-17T06:00:00Z", "2026-11-17T18:00:00Z").totalPence).toBe(14400));
  it("applies 22:00-06:00 night uplift (winter, GMT)", () => {
    const r = pay("2026-11-16T18:00:00Z", "2026-11-17T06:00:00Z");
    expect(r.lines.find((l) => l.kind === "NIGHT")!.minutes).toBe(480);
    expect(r.totalPence).toBe(4 * 1200 + 8 * 1500);
  });
  it("uses London local time in summer (21:00Z is 22:00 BST = night)", () =>
    expect(pay("2026-08-10T21:00:00Z", "2026-08-10T23:00:00Z").totalPence).toBe(2 * 1500));
  it("applies overtime beyond 48h/week", () => expect(pay("2026-11-17T10:00:00Z", "2026-11-17T14:00:00Z", 46).totalPence).toBe(2 * 1200 + 2 * 1800));
  it("pays a bank holiday at 1.5x", () => expect(pay("2026-05-25T10:00:00Z", "2026-05-25T18:00:00Z").totalPence).toBe(8 * 1800));
  it("pays Christmas Day at 2x", () => expect(pay("2026-12-25T10:00:00Z", "2026-12-25T18:00:00Z").totalPence).toBe(8 * 2400));
  it("takes the highest multiplier rather than stacking (night on a bank holiday)", () =>
    expect(pay("2026-05-25T21:00:00Z", "2026-05-25T22:00:00Z").totalPence).toBe(1800));
  it("exports Xero CSV and neutralises formula injection", () => {
    const csv = toXeroCsv([{ contact: "=HYPERLINK(\"x\")", invoiceNumber: "INV-1", date: "2026-11-17", description: "Guard, night", hours: 12, unitAmountGbp: 19.5 }]);
    expect(csv.split("\r\n")[0]).toContain("*ContactName");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Guard, night"');
  });
});
