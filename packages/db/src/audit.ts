import { immutableAuditLogs } from "./schema";
import type { Db } from "./client";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
};

type Tx = Pick<Db, "insert">;

/** Append-only insert. Call inside the same transaction as the mutation it records. */
export async function writeAudit(tx: Tx, e: AuditEntry) {
  await tx.insert(immutableAuditLogs).values({
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    oldValuesJson: e.oldValues ?? null,
    newValuesJson: e.newValues ?? null,
    ipAddress: e.ipAddress ?? null,
  });
}
