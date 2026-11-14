/**
 * UK rate card. Money is integer pence. Time classification is per minute in Europe/London.
 * Multipliers do not stack: the highest applicable of night / overtime / bank holiday applies.
 */
export type RateConfig = {
  nightUplift: number;        // 22:00-06:00
  overtime: number;           // beyond weeklyThresholdHours
  bankHoliday: number;        // England & Wales bank holidays
  bankHolidayPremium: number; // Christmas Day & New Year's Day
  weeklyThresholdHours: number;
};
export const DEFAULT_RATES: RateConfig = { nightUplift: 1.25, overtime: 1.5, bankHoliday: 1.5, bankHolidayPremium: 2, weeklyThresholdHours: 48 };

/** England & Wales bank holidays (YYYY-MM-DD). Extend yearly. */
export const BANK_HOLIDAYS = new Set([
  "2026-01-01","2026-04-03","2026-04-06","2026-05-04","2026-05-25","2026-08-31","2026-12-25","2026-12-28",
  "2027-01-01","2027-03-26","2027-03-29","2027-05-03","2027-05-31","2027-08-30","2027-12-27","2027-12-28",
]);
const PREMIUM_MM_DD = new Set(["12-25", "01-01"]);

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
function londonParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export type PayLine = { kind: "BASE" | "NIGHT" | "OVERTIME" | "BANK_HOLIDAY" | "BANK_HOLIDAY_PREMIUM"; minutes: number; multiplier: number; pence: number };
export type PayResult = { totalMinutes: number; totalPence: number; lines: PayLine[] };

export function calculateShiftPay(opts: {
  startUtc: Date; endUtc: Date; hourlyRatePence: number;
  /** Hours already worked earlier in the same Mon-Sun week. */
  priorWeekHours?: number; config?: Partial<RateConfig>;
}): PayResult {
  const c = { ...DEFAULT_RATES, ...opts.config };
  const thresholdMin = c.weeklyThresholdHours * 60;
  let worked = (opts.priorWeekHours ?? 0) * 60;
  const buckets = new Map<PayLine["kind"], { minutes: number; multiplier: number }>();

  for (let t = opts.startUtc.getTime(); t < opts.endUtc.getTime(); t += 60_000) {
    const { date, hour } = londonParts(new Date(t));
    const candidates: [PayLine["kind"], number][] = [["BASE", 1]];
    if (hour >= 22 || hour < 6) candidates.push(["NIGHT", c.nightUplift]);
    if (worked >= thresholdMin) candidates.push(["OVERTIME", c.overtime]);
    if (BANK_HOLIDAYS.has(date)) {
      candidates.push(PREMIUM_MM_DD.has(date.slice(5)) ? ["BANK_HOLIDAY_PREMIUM", c.bankHolidayPremium] : ["BANK_HOLIDAY", c.bankHoliday]);
    }
    const [kind, multiplier] = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
    const cur = buckets.get(kind) ?? { minutes: 0, multiplier };
    cur.minutes++; buckets.set(kind, cur);
    worked++;
  }

  const lines: PayLine[] = [...buckets].map(([kind, b]) => ({
    kind, minutes: b.minutes, multiplier: b.multiplier,
    pence: Math.round((b.minutes / 60) * opts.hourlyRatePence * b.multiplier),
  }));
  return { totalMinutes: lines.reduce((s, l) => s + l.minutes, 0), totalPence: lines.reduce((s, l) => s + l.pence, 0), lines };
}

export type ExportRow = { contact: string; invoiceNumber: string; date: string; description: string; hours: number; unitAmountGbp: number; accountCode?: string };

const esc = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Xero invoice-import compatible columns (also accepted by Sage 50 CSV mapping). */
export function toXeroCsv(rows: ExportRow[]): string {
  const head = "*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Description,*Quantity,*UnitAmount,*AccountCode";
  const body = rows.map((r) => [r.contact, r.invoiceNumber, r.date, r.date, r.description, r.hours.toFixed(2), r.unitAmountGbp.toFixed(2), r.accountCode ?? "200"].map(esc).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}
