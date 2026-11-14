import { and, eq } from "drizzle-orm";
import { immutableAuditLogs, shifts, siteInductions, users, writeAudit, type Db } from "@gatehouse/db";

export type ViolationCode = "SIA_MISSING" | "SIA_EXPIRED" | "VETTING_NOT_VERIFIED" | "SITE_INDUCTION_MISSING";
export type Violation = { code: ViolationCode; message: string };

export type GuardFacts = {
  siaLicenceExpiry: Date | null;
  bs7858VettingStatus: string;
  siteInductionCompleted: boolean;
};

const END_OF_DAY_MS = 86_400_000 - 1;

/**
 * Pure compliance evaluation (CLAUDE.md rule 1).
 * SIA expiry is a calendar date valid through the end of that day (UTC). We compare against the
 * shift END (stricter than shift start) so a licence lapsing mid-shift is also blocked.
 */
export function evaluateCompliance(guard: GuardFacts, shift: { startUtc: Date; endUtc: Date }): Violation[] {
  const v: Violation[] = [];
  if (!guard.siaLicenceExpiry) {
    v.push({ code: "SIA_MISSING", message: "No SIA licence on record" });
  } else if (guard.siaLicenceExpiry.getTime() + END_OF_DAY_MS < shift.endUtc.getTime()) {
    v.push({ code: "SIA_EXPIRED", message: `SIA licence expires ${guard.siaLicenceExpiry.toISOString().slice(0, 10)}, before shift ends` });
  }
  if (guard.bs7858VettingStatus !== "VERIFIED") {
    v.push({ code: "VETTING_NOT_VERIFIED", message: `BS 7858 vetting is ${guard.bs7858VettingStatus}` });
  }
  if (!guard.siteInductionCompleted) {
    v.push({ code: "SITE_INDUCTION_MISSING", message: "Site induction not completed" });
  }
  return v;
}

/** Badge colour for the roster UI. */
export function complianceBadge(guard: GuardFacts, shiftStart: Date, now = new Date()): "GREEN" | "AMBER" | "RED" {
  if (evaluateCompliance(guard, { startUtc: shiftStart, endUtc: shiftStart }).length) return "RED";
  const days = guard.siaLicenceExpiry ? (guard.siaLicenceExpiry.getTime() - now.getTime()) / 86_400_000 : 0;
  return days <= 30 ? "AMBER" : "GREEN";
}

export class ComplianceError extends Error {
  constructor(public violations: Violation[], public code: "BLOCKED" | "OVERRIDE_FORBIDDEN" | "OVERRIDE_REASON_REQUIRED" = "BLOCKED") {
    super(`Assignment blocked: ${violations.map((x) => x.code).join(", ")}`);
  }
}

export type AssignInput = {
  shiftId: string; guardId: string; actorId: string; overrideReason?: string; ipAddress?: string | null;
};

/**
 * Hard-blocks non-compliant assignments. Override requires COMPLIANCE_ADMIN + non-empty written
 * reason; every assignment, override and blocked attempt lands in immutable_audit_logs.
 */
export async function assignGuardToShift(db: Db, input: AssignInput) {
  const { shiftId, guardId, actorId, ipAddress = null } = input;
  const reason = input.overrideReason?.trim() ?? "";

  const outcome = await db.transaction(async (tx) => {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for("update");
    if (!shift) throw new Error("Shift not found");
    const [guard] = await tx.select().from(users).where(eq(users.id, guardId));
    const [actor] = await tx.select().from(users).where(eq(users.id, actorId));
    if (!guard || !actor) throw new Error("Guard or actor not found");
    const [site] = await tx.query.sites.findMany({ where: (s, { eq: e }) => e(s.id, shift.siteId), limit: 1 });
    if (!site || site.organisationId !== guard.organisationId || guard.organisationId !== actor.organisationId) {
      throw new Error("Tenant mismatch");
    }
    const [induction] = await tx.select().from(siteInductions)
      .where(and(eq(siteInductions.siteId, shift.siteId), eq(siteInductions.guardId, guardId)));

    const violations = evaluateCompliance({
      siaLicenceExpiry: guard.siaLicenceExpiry,
      bs7858VettingStatus: guard.bs7858VettingStatus,
      siteInductionCompleted: !!induction,
    }, shift);

    if (violations.length) {
      if (actor.role !== "COMPLIANCE_ADMIN") return { blocked: new ComplianceError(violations, reason ? "OVERRIDE_FORBIDDEN" : "BLOCKED") };
      if (!reason) return { blocked: new ComplianceError(violations, "OVERRIDE_REASON_REQUIRED") };
    }

    const [updated] = await tx.update(shifts).set({ guardId, status: "ASSIGNED" }).where(eq(shifts.id, shiftId)).returning();
    await writeAudit(tx, {
      actorId, ipAddress,
      action: violations.length ? "COMPLIANCE_OVERRIDE_ASSIGN" : "ASSIGN_GUARD",
      entityType: "shift", entityId: shiftId,
      oldValues: { guardId: shift.guardId, status: shift.status },
      newValues: { guardId, status: "ASSIGNED", ...(violations.length ? { overrideReason: reason, violations } : {}) },
    });
    return { shift: updated!, overridden: violations.length > 0 };
  });

  const blocked = "blocked" in outcome ? outcome.blocked : undefined;
  if (blocked) {
    // Written outside the rolled-back path so the refused attempt is still evidenced.
    await db.insert(immutableAuditLogs).values({
      actorId, action: "ASSIGN_BLOCKED", entityType: "shift", entityId: shiftId, ipAddress,
      newValuesJson: { guardId, violations: blocked.violations, code: blocked.code },
    });
    throw blocked;
  }
  return outcome as { shift: typeof shifts.$inferSelect; overridden: boolean };
}
