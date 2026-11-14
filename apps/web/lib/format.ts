export const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" }) : "-";
export const name = (f?: string | null, l?: string | null) => (f ? `${f} ${l ?? ""}`.trim() : "Unassigned");
