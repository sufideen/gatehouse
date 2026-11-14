// Placeholder data until the web app is wired to @gatehouse/api (auth + data fetching not yet built).
export const alerts = {
  sos: [] as { guard: string; site: string; since: string }[],
  welfareOverdue: [{ guard: "Daniel O'Brien", site: "Croydon Distribution Depot", minsLate: 7 }],
  scansOverdue: [{ site: "Canary Wharf Tower Lobby", checkpoint: "Plant Room", minsLate: 18 }],
};
export const liveShifts = [
  { guard: "Priya Patel", site: "Canary Wharf Tower Lobby", progress: 62, distanceM: 12, nextWelfare: "04:10", selfie: true },
  { guard: "Connor Mitchell", site: "Shoreditch Retail Park", progress: 31, distanceM: 41, nextWelfare: "11:52", selfie: true },
  { guard: "Daniel O'Brien", site: "Croydon Distribution Depot", progress: 80, distanceM: 6, nextWelfare: "OVERDUE", selfie: true },
];
export const roster = [
  { guard: "Oluwaseun Adeyemi", badge: "red" as const, note: "SIA expired" },
  { guard: "Priya Patel", badge: "amber" as const, note: "SIA expires in 14 days" },
  { guard: "Fatima Khan", badge: "green" as const, note: "Compliant" },
  { guard: "Amira Hassan", badge: "red" as const, note: "BS 7858 in progress" },
];
