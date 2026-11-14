import { PILOT_RETENTION_DAYS } from "@gatehouse/api/privacy";
import { NOTICE, POLICY_VERSION, SCOPE_INFO } from "@/lib/policy";
import { json } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
export const GET = () => json({ policyVersion: POLICY_VERSION, retentionDays: PILOT_RETENTION_DAYS, notice: NOTICE, scopes: SCOPE_INFO });
