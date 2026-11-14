import { getDb } from "./syncEngine";
import type { ApiShift } from "../shifts";

/** Last-known shifts, so the guard can still clock in and patrol in a basement with no signal. */
export async function saveShifts(list: ApiShift[]) {
  const db = await getDb();
  await db.execAsync(`CREATE TABLE IF NOT EXISTS cached_shifts (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL)`);
  await db.runAsync(`DELETE FROM cached_shifts`);
  for (const s of list) await db.runAsync(`INSERT INTO cached_shifts (id, json) VALUES (?, ?)`, [s.id, JSON.stringify(s)]);
}
export async function loadShifts(): Promise<ApiShift[]> {
  const db = await getDb();
  await db.execAsync(`CREATE TABLE IF NOT EXISTS cached_shifts (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL)`);
  return (await db.getAllAsync<{ json: string }>(`SELECT json FROM cached_shifts`)).map((r) => JSON.parse(r.json) as ApiShift);
}
