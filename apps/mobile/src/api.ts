export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3100"; // Android emulator: use http://10.0.2.2:3100

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

/** Thin fetch wrapper for the Gatehouse mobile API (/api/mobile/*). Bearer token, JSON only. */
export async function api<T>(path: string, o: { method?: "GET" | "POST"; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/mobile${path}`, {
      method: o.method ?? (o.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
  } catch { throw new ApiError(0, "OFFLINE", "No connection. This needs internet."); }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "ERROR", data.message);
  return data as T;
}
