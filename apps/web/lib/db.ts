import { createDb } from "@gatehouse/db";

// PoC: single shared connection pool (survives Next dev hot reloads). Defaults to the local docker/postgres DB.
const g = globalThis as unknown as { __gh?: ReturnType<typeof createDb> };
export const { db, sql: pg } = (g.__gh ??= createDb());
