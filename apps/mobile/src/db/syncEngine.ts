import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system";
import NetInfo from "@react-native-community/netinfo";
import { uuidv7 } from "uuidv7";
import { backoffDelayMs } from "./backoff";
import { getToken } from "../session";

/**
 * Offline-first queue (CLAUDE.md rule 3): every action is persisted locally with a client-generated
 * UUIDv7 and device UTC timestamp BEFORE any network call, then pushed idempotently in batches.
 */
export type RecordType = "CLOCK_IN" | "CLOCK_OUT" | "PATROL_SCAN" | "WELFARE_CHECK" | "INCIDENT";
export type SyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "REJECTED";

// Local mirrors of attendance_logs, patrol_logs, welfare_checks and incident_reports.
const TABLES: Record<RecordType, string> = {
  CLOCK_IN: "attendance_logs", CLOCK_OUT: "attendance_logs", PATROL_SCAN: "patrol_logs", WELFARE_CHECK: "welfare_checks", INCIDENT: "incident_reports",
};
const TABLE_NAMES = [...new Set(Object.values(TABLES))];

export type EngineConfig = { apiUrl: string; deviceId: string; /** Called when the server says the token is no longer valid (password reset, erased account). */ onAuthLost?: () => void };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
export const getDb = () => (dbPromise ??= SQLite.openDatabaseAsync("gatehouse.db"));

export async function initLocalDb() {
  const db = await getDb();
  await db.execAsync("PRAGMA journal_mode = WAL;");
  for (const t of TABLE_NAMES) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS ${t} (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      record_type TEXT NOT NULL,
      device_utc TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT
    ); CREATE INDEX IF NOT EXISTS ${t}_status ON ${t}(sync_status, next_attempt_at);`);
  }
  await db.execAsync(`CREATE TABLE IF NOT EXISTS media_queue (
    id TEXT PRIMARY KEY NOT NULL, local_uri TEXT NOT NULL, content_type TEXT NOT NULL, s3_key TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0
  );`);
  // A crash mid-flush leaves rows SYNCING; return them to the queue (server dedupes by key).
  for (const t of TABLE_NAMES) await db.runAsync(`UPDATE ${t} SET sync_status='PENDING' WHERE sync_status='SYNCING'`);
}

/** Persist locally first. Returns the idempotency key (also the server-side sync_uuid). */
export async function enqueue(type: RecordType, payload: Record<string, unknown>): Promise<string> {
  const db = await getDb();
  const key = uuidv7();
  const deviceUtc = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO ${TABLES[type]} (idempotency_key, record_type, device_utc, payload_json) VALUES (?, ?, ?, ?)`,
    [key, type, deviceUtc, JSON.stringify(payload)],
  );
  return key;
}

/** Queue a photo/audio file locally; uploaded to S3 via pre-signed URL when online. Returns the S3 key to reference in records. */
export async function enqueueMedia(localUri: string, contentType: string, folder: "selfies" | "incidents" | "sos"): Promise<string> {
  const db = await getDb();
  const id = uuidv7();
  const s3Key = `${folder}/${id}`;
  await db.runAsync(`INSERT INTO media_queue (id, local_uri, content_type, s3_key) VALUES (?, ?, ?, ?)`, [id, localUri, contentType, s3Key]);
  return s3Key;
}

type Row = { idempotency_key: string; record_type: RecordType; device_utc: string; payload_json: string; attempts: number };

export async function flushOnce(cfg: EngineConfig): Promise<{ sent: number; failed: boolean }> {
  const db = await getDb();
  const now = Date.now();
  const rows: Row[] = [];
  for (const t of TABLE_NAMES) {
    rows.push(...await db.getAllAsync<Row>(
      `SELECT idempotency_key, record_type, device_utc, payload_json, attempts FROM ${t} WHERE sync_status='PENDING' AND next_attempt_at <= ? ORDER BY device_utc LIMIT 100`, [now]));
  }
  if (!rows.length) return { sent: 0, failed: false };
  rows.sort((a, b) => a.device_utc.localeCompare(b.device_utc));
  const byKey = new Map(rows.map((r) => [r.idempotency_key, r]));
  const mark = (r: Row, sql: string, params: unknown[]) => db.runAsync(`UPDATE ${TABLES[r.record_type]} SET ${sql} WHERE idempotency_key=?`, [...params, r.idempotency_key] as SQLite.SQLiteBindValue[]);
  for (const r of rows) await mark(r, "sync_status='SYNCING'", []);

  try {
    const token = await getToken();
    if (!token) throw new Error("not signed in");
    const res = await fetch(`${cfg.apiUrl}/api/mobile/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: cfg.deviceId, // the server takes the guard identity from the token, not from the body
        records: rows.map((r) => ({ ...JSON.parse(r.payload_json), type: r.record_type, syncUuid: r.idempotency_key, deviceUtc: r.device_utc })),
      }),
    });
    if (res.status === 401) { // keep the records; just stop until the guard signs in again
      for (const r of rows) await mark(r, "sync_status='PENDING'", []);
      cfg.onAuthLost?.();
      return { sent: 0, failed: true };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { results } = (await res.json()) as { results: { syncUuid: string; status: "APPLIED" | "DUPLICATE" | "REJECTED"; reason?: string }[] };
    for (const out of results) {
      const r = byKey.get(out.syncUuid);
      if (!r) continue;
      // REJECTED is kept (never silently dropped) so the guard/supervisor can see why it was refused.
      if (out.status === "REJECTED") await mark(r, "sync_status='REJECTED', reject_reason=?", [out.reason ?? null]);
      else await mark(r, "sync_status='SYNCED'", []);
    }
    return { sent: results.length, failed: false };
  } catch {
    for (const r of rows) await mark(r, "sync_status='PENDING', attempts=attempts+1, next_attempt_at=?", [Date.now() + backoffDelayMs(r.attempts + 1)]);
    return { sent: 0, failed: true };
  }
}

/** Upload queued media. `getPresignedPutUrl` is supplied by the app (API endpoint pending). */
export async function flushMedia(getPresignedPutUrl: (s3Key: string, contentType: string) => Promise<string>) {
  const db = await getDb();
  const items = await db.getAllAsync<{ id: string; local_uri: string; content_type: string; s3_key: string }>(`SELECT * FROM media_queue WHERE sync_status='PENDING' LIMIT 10`);
  for (const m of items) {
    try {
      const url = await getPresignedPutUrl(m.s3_key, m.content_type);
      const r = await FileSystem.uploadAsync(url, m.local_uri, { httpMethod: "PUT", headers: { "content-type": m.content_type } });
      if (r.status >= 300) throw new Error(`HTTP ${r.status}`);
      await db.runAsync(`UPDATE media_queue SET sync_status='SYNCED' WHERE id=?`, [m.id]);
    } catch {
      await db.runAsync(`UPDATE media_queue SET attempts=attempts+1 WHERE id=?`, [m.id]);
    }
  }
}

/** Starts a connectivity-driven flush loop. Returns a stop function. */
export function startSyncLoop(cfg: EngineConfig, presign?: Parameters<typeof flushMedia>[0]) {
  let running = false, attempt = 0, timer: ReturnType<typeof setTimeout> | null = null, online = false;
  const tick = async () => {
    if (running || !online) return;
    running = true;
    try {
      const r = await flushOnce(cfg);
      if (presign) await flushMedia(presign);
      attempt = r.failed ? attempt + 1 : 0;
    } finally { running = false; }
    if (online) timer = setTimeout(tick, attempt ? backoffDelayMs(attempt) : 15_000);
  };
  const unsub = NetInfo.addEventListener((s) => {
    const nowOnline = !!s.isConnected && s.isInternetReachable !== false;
    if (nowOnline && !online) { // jitter the first push after reconnect to avoid thundering herd
      timer = setTimeout(tick, Math.floor(Math.random() * 5_000));
    }
    online = nowOnline;
    if (!online && timer) clearTimeout(timer);
  });
  return () => { unsub(); if (timer) clearTimeout(timer); };
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  let n = 0;
  for (const t of TABLE_NAMES) n += (await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) c FROM ${t} WHERE sync_status!='SYNCED'`))?.c ?? 0;
  return n;
}

/** Erasure / sign-out-and-forget: removes every locally stored record and queued file so nothing personal stays on the device. */
export async function wipeLocalData() {
  const db = await getDb();
  const files = await db.getAllAsync<{ local_uri: string }>(`SELECT local_uri FROM media_queue`).catch(() => []);
  for (const f of files) await FileSystem.deleteAsync(f.local_uri, { idempotent: true }).catch(() => {});
  for (const t of TABLE_NAMES) await db.runAsync(`DELETE FROM ${t}`);
  await db.runAsync(`DELETE FROM media_queue`);
}
