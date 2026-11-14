import { createDb } from "@gatehouse/db";
import { runRetention } from "./privacy";

// Run daily (cron). Anonymises pilot users 30 days after consent; delete the returned S3 keys.
const { db, sql } = createDb();
const r = await runRetention(db);
console.log(JSON.stringify({ anonymised: r.anonymisedUserIds.length, s3KeysToDelete: r.s3KeysToDelete }));
await sql.end();
