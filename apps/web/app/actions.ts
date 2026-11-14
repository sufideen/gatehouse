"use server";
import { revalidatePath } from "next/cache";
import { uuidv7 } from "uuidv7";
import { ComplianceError, assignGuardToShift } from "@gatehouse/api/compliance";
import { applySyncBatch, syncBatch } from "@gatehouse/api/sync";
import { commitGuardhouseImport, previewGuardsCsv, previewSitesCsv } from "@gatehouse/api/import";
import { db } from "@/lib/db";
import { ADMINS, GUARDS, actionSession, clientIp } from "@/lib/auth";

export type ActionState = { ok?: boolean; message?: string; lines?: string[] } | null;

export async function assignAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const me = await actionSession(ADMINS); // actor comes from the session, never from the form
    const r = await assignGuardToShift(db, {
      shiftId: String(f.get("shiftId")), guardId: String(f.get("guardId")), actorId: me.id, ipAddress: await clientIp(),
      overrideReason: String(f.get("overrideReason") ?? ""),
    });
    revalidatePath("/roster"); revalidatePath("/compliance/audit-logs");
    return { ok: true, message: r.overridden ? "Assigned via COMPLIANCE OVERRIDE (audited)" : "Assigned" };
  } catch (e) {
    revalidatePath("/compliance/audit-logs");
    if (e instanceof ComplianceError) return { ok: false, message: `Blocked (${e.code})`, lines: e.violations.map((v) => v.message) };
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
}

const POS = { inside: { lat: 51.5049, lng: -0.0196 }, outside: { lat: 51.5049, lng: -0.0296 } };

/** Guard simulator: builds the same batch payload the mobile app sends and applies it through the real sync code. */
export async function guardAction(_: ActionState, f: FormData): Promise<ActionState> {
  let guardId: string;
  try { guardId = (await actionSession(GUARDS)).id; } catch { return { ok: false, message: "Forbidden" }; } // a guard can only act as themselves
  const kind = String(f.get("kind")), shiftId = String(f.get("shiftId"));
  const siteLat = Number(f.get("siteLat")), siteLng = Number(f.get("siteLng"));
  const where = String(f.get("where") ?? "inside");
  const gps = where === "outside" ? { lat: siteLat, lng: siteLng - 0.01 } : where === "inside" ? { lat: siteLat, lng: siteLng } : POS.inside;
  const base = { syncUuid: uuidv7(), deviceUtc: new Date() };
  const record =
    kind === "CLOCK_IN" ? { ...base, type: "CLOCK_IN", shiftId, gps, selfieKey: f.get("selfie") === "on" ? `selfies/browser-${Date.now()}.jpg` : "" }
    : kind === "CLOCK_OUT" ? { ...base, type: "CLOCK_OUT", attendanceSyncUuid: String(f.get("attendanceSyncUuid")), gps }
    : kind === "PATROL_SCAN" ? { ...base, type: "PATROL_SCAN", shiftId, tagUid: String(f.get("tagUid")), gps }
    : kind === "SOS" ? { ...base, type: "WELFARE_CHECK", shiftId, dueUtc: new Date(), status: "SOS_TRIGGERED" }
    : kind === "SAFE" ? { ...base, type: "WELFARE_CHECK", shiftId, dueUtc: new Date(), status: "OK" }
    : { ...base, type: "INCIDENT", siteId: String(f.get("siteId")), severity: "MEDIUM", category: String(f.get("category") ?? "Other"), transcript: String(f.get("transcript") ?? "") };
  const parsed = syncBatch.safeParse({ deviceId: "browser-sim", guardId, records: [record] });
  if (!parsed.success) return { ok: false, message: "Rejected by validation", lines: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const [res] = await applySyncBatch(db, parsed.data, await clientIp());
  revalidatePath("/dashboard"); revalidatePath("/guard");
  return { ok: res!.status === "APPLIED", message: `${kind}: ${res!.status}${res!.reason ? ` (${res!.reason})` : ""}`, lines: [`syncUuid ${res!.syncUuid}`] };
}

export async function importAction(_: ActionState, f: FormData): Promise<ActionState> {
  let me;
  try { me = await actionSession(ADMINS); } catch { return { ok: false, message: "Forbidden" }; }
  const guardsCsv = String(f.get("guardsCsv") ?? ""), sitesCsv = String(f.get("sitesCsv") ?? "");
  const guards = guardsCsv.trim() ? previewGuardsCsv(guardsCsv) : [], sites = sitesCsv.trim() ? previewSitesCsv(sitesCsv) : [];
  const lines = [
    ...guards.map((g) => `Guard row ${g.row}: ${g.firstName} ${g.lastName} <${g.email}> ${g.issues.map((i) => `[${i.level}] ${i.message}`).join(" ")}`),
    ...sites.map((s) => `Site row ${s.row}: ${s.name}, ${s.checkpoints.length} checkpoints ${s.issues.map((i) => `[${i.level}] ${i.message}`).join(" ")}`),
  ];
  if (f.get("intent") !== "commit") return { ok: true, message: "Preview", lines };
  const [org] = await db.query.organisations.findMany({ where: (o, { eq }) => eq(o.isSecurityProvider, true), limit: 1 });
  // PoC import is SYNTHETIC-only: real-looking emails are refused by the importer.
  const r = await commitGuardhouseImport(db, { organisationId: org!.id, actorId: me.id, ipAddress: await clientIp(), guards, sites, mode: { dataOrigin: "SYNTHETIC" } });
  revalidatePath("/roster");
  return { ok: true, message: "Imported (synthetic mode)", lines: [JSON.stringify(r)] };
}
