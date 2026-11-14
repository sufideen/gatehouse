"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createInvite, joinWithInvite } from "@gatehouse/api/pilot";
import { anonymiseUser, SCOPES, withdrawConsent, type Scope } from "@gatehouse/api/privacy";
import { ADMINS, GUARDS, actionSession, clientIp, endSession, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { POLICY_VERSION } from "@/lib/policy";
import type { ActionState } from "@/app/actions";

const scopesFrom = (f: FormData) => SCOPES.filter((s) => f.get(`scope_${s}`) === "on") as Scope[];

export async function createInviteAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const me = await actionSession(ADMINS);
    const role = String(f.get("role"));
    if (role !== "STATIC_GUARD" && role !== "PATROL_DRIVER") return { ok: false, message: "Invalid role" };
    const { token } = await createInvite(db, { organisationId: me.organisationId, role, label: String(f.get("label") || "Pilot guard"), createdBy: me.id });
    revalidatePath("/admin/invites");
    // The raw token is shown exactly once; only its hash is stored.
    return { ok: true, message: "Invite created. Copy this one-time link now (valid 7 days):", lines: [`/join/${token}`] };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Error" }; }
}

export async function joinAction(_: ActionState, f: FormData): Promise<ActionState> {
  const scopes = scopesFrom(f);
  let userId: string;
  try {
    const siaExpiry = String(f.get("siaLicenceExpiry") ?? "");
    ({ userId } = await joinWithInvite(db, {
      token: String(f.get("token")), firstName: String(f.get("firstName") ?? ""), lastName: String(f.get("lastName") ?? ""),
      email: String(f.get("email") ?? ""), password: String(f.get("password") ?? ""), scopes, policyVersion: POLICY_VERSION,
      mobile: String(f.get("mobile") ?? ""), siaBadgeNumber: String(f.get("siaBadgeNumber") ?? ""),
      siaLicenceExpiry: /^\d{4}-\d{2}-\d{2}$/.test(siaExpiry) ? new Date(siaExpiry) : null,
    }));
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Could not join" }; }
  await startSession(userId);
  redirect("/privacy");
}

export async function withdrawAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const me = await actionSession(GUARDS);
    const scopes = scopesFrom(f);
    if (!scopes.length) return { ok: false, message: "Tick what you want to withdraw" };
    const r = await withdrawConsent(db, { userId: me.id, scopes, actorId: me.id, ipAddress: await clientIp() });
    if (r.anonymised) { await endSession(); redirect("/login"); }
    revalidatePath("/privacy");
    return { ok: true, message: "Consent withdrawn. Those details have been removed." };
  } catch (e) { if (isRedirect(e)) throw e; return { ok: false, message: e instanceof Error ? e.message : "Error" }; }
}

export async function eraseAction(): Promise<void> {
  const me = await actionSession(GUARDS);
  await anonymiseUser(db, { userId: me.id, actorId: me.id, reason: "ERASURE_REQUEST", ipAddress: await clientIp() });
  await endSession();
  redirect("/login");
}

const isRedirect = (e: unknown) => typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
