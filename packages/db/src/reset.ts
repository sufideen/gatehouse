import { createDb } from "./client";

// Local PoC helper: wipes the schema (the append-only triggers also block TRUNCATE, so we drop instead).
const url = process.env.DATABASE_URL ?? "postgres://gatehouse:gatehouse@localhost:5432/gatehouse";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("reset only runs against a local database");
const { sql } = createDb(url);
await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
console.log("schema dropped");
await sql.end();
