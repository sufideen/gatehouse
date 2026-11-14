import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url = process.env.DATABASE_URL ?? "postgres://gatehouse:gatehouse@localhost:5432/gatehouse") {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}
export type Db = ReturnType<typeof createDb>["db"];
