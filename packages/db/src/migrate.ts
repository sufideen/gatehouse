import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const { db, sql } = createDb();
await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log("migrations applied");
await sql.end();
