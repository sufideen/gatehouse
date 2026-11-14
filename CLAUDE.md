# Project Architecture & Strict Domain Rules: UK Static Guarding & Mobile Patrol SaaS

## Core Business & UK Compliance Rules (Never Violate)
1. **UK Compliance Hard-Blocks:** Never allow assigning a guard to a shift if `sia_licence_expiry < shift_start`, `bs7858_vetting_status !== 'VERIFIED'`, or `site_induction_completed === false`. Any emergency override requires a `ROLE_COMPLIANCE_ADMIN` user, a mandatory written reason, and an entry in `immutable_audit_logs`.
2. **Immutable Audit Trail (SIA ACS / BS 7499 Ready):** All mutations to shifts, timesheets, SIA records, patrol logs, and incident reports MUST insert an append-only record into `immutable_audit_logs` (actor_id, action, entity_type, entity_id, old_values_json, new_values_json, ip_address, utc_timestamp). Never allow `UPDATE` or `DELETE` on `immutable_audit_logs` or `patrol_logs`.
3. **Offline-First Field Operations:** Every mobile action (clock-in, NFC/QR scan, welfare check, incident report) must persist to a local SQLite queue with client-generated UUIDv7 and device UTC timestamp first, then sync idempotently via batch endpoint when online.
4. **Anti-Buddy Punching:** Static clock-ins require both a PostGIS geofence verification (`ST_DWithin` <= site radius) AND a live front-camera selfie attachment ID.
5. **Preserve Incumbent Hardware:** Checkpoint identifiers must support arbitrary external strings (`external_tag_uid`) so clients migrating from Guardhouse can keep existing physical QR codes and NFC stickers on client walls without reprinting.

## Tech Stack & Monorepo Structure
- Package Manager: `pnpm`
- `apps/web`: Next.js (App Router), TypeScript, Tailwind CSS, Shadcn UI (Control Room & Client Portal)
- `apps/mobile`: Expo (React Native) with `expo-sqlite`, `expo-location`, `expo-camera`, `expo-nfc`
- `packages/db`: Drizzle ORM + PostgreSQL 16 with PostGIS extension (UK London `eu-west-2` target)
- `packages/api`: tRPC or Fastify REST API with Zod validation
- Testing: Vitest (`pnpm test`) + TypeScript (`pnpm typecheck`)
