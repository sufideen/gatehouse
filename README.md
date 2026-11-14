# Gatehouse

UK static guarding & mobile patrol SaaS. Domain rules live in [`CLAUDE.md`](./CLAUDE.md) (mirrored to `.cursorrules`).

| Path | What |
|---|---|
| `packages/db` | Drizzle schema, PostGIS migrations, append-only triggers, seed |
| `packages/api` | Fastify + Zod: compliance engine, UK rate card, Guardhouse importer, offline sync batch endpoint |
| `apps/web` | Next.js control room + client portal (UI shell, demo data) |
| `apps/mobile` | Expo guard app: SQLite outbox + sync engine, active shift screen |

## Quick start
```bash
pnpm install
docker compose up -d
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm typecheck
TEST_DATABASE_URL=postgres://gatehouse:gatehouse@localhost:5432/gatehouse_test pnpm test   # DB tests skip without it
pnpm --filter @gatehouse/api dev     # API on :4000
pnpm --filter @gatehouse/web dev     # web on :3000
```
Create the test DB first: `createdb gatehouse_test`. Migrations are idempotent and enable PostGIS.

## Local browser PoC
One process, no separate API needed: the web app reads Postgres directly and runs the real compliance/sync code via server actions.
```bash
pnpm install
service postgresql start      # or: docker compose up -d   (needs PostGIS)
pnpm demo:setup               # migrate + synthetic seed
pnpm demo                     # http://localhost:3000
pnpm demo:reset               # wipe and re-seed (local DB only)
```
Try: **Roster** (assign an expired-SIA guard as Admin, then as Compliance Admin with a reason) -> **Guard simulator** (clock in away from site, then on site; scan a legacy tag; SOS) -> **Dashboard**, **Audit trail**, **Client portal** (view as each client).
Sign in at `/login`. Synthetic demo accounts (password `demo-password-1`, dev only): `admin@`, `compliance@`, `controlroom@thamesshield.example`, `fatima.khan@thamesshield.example` (guard), `client1@demo.example` (client viewer).

### Roles
| Role | Access |
|---|---|
| ADMIN | dashboard, roster (assign), audit trail, import, pilot invites |
| COMPLIANCE_ADMIN | as ADMIN, and the only role that can override a compliance block (written reason required) |
| CONTROL_ROOM | dashboard and roster, read-only |
| STATIC_GUARD / PATROL_DRIVER | own shift screen and "My data" only |
| CLIENT_VIEWER | client portal, locked to their own client's sites |

Auth: scrypt password hashes, HMAC-signed httpOnly cookie (8h), user re-loaded from the DB on every request, 5 login attempts / 15 min, logins audited by user id. Every server action re-checks the role and takes the actor from the session. Set `AUTH_SECRET` (32+ chars) in production; the app refuses to run without it.

### Password reset and MFA
- **Two-step verification (TOTP, RFC 6238):** works with any authenticator app. Mandatory for ADMIN, COMPLIANCE_ADMIN and CONTROL_ROOM (they are forced to `/security` until enrolled); optional for guards and client viewers. Secrets are AES-256-GCM encrypted at rest, codes cannot be replayed, and 10 one-time recovery codes are issued (stored hashed, shown once).
- **Login with MFA:** the password step only yields a 5-minute "pending" cookie signed with a different key; it is never a session.
- **Forgot password:** emails a one-hour single-use link (same reply whether or not the account exists, rate limited). Only the token hash is stored. Resetting the password does **not** bypass MFA.
- **Admin recovery** (`/admin/users`): issue a one-time reset link for someone without email access, or reset a locked-out person's MFA. Admins cannot reset their own. All audited by user id.
- **Session revocation:** password reset/change and MFA reset bump a per-user session epoch, signing out every other device immediately.
- **Mail:** set `SMTP_URL` + `MAIL_FROM` (any SMTP provider; AWS SES SMTP in `eu-west-2` works) and `APP_BASE_URL`. Without them, dev uses an in-memory inbox at `/dev/outbox`; **production refuses to start sending without SMTP**. Message bodies are never logged by the SMTP mailer, and a send failure never changes the on-screen reply. Reset links are never built from the Host header. You must verify the sending domain with your provider and add SPF/DKIM/DMARC.

### Pilot onboarding (real people, with consent)
Run with `ALLOW_PILOT_DATA=true pnpm demo` only on the dedicated pilot deployment. An admin creates a one-time invite link (no personal data stored); the guard opens it, reads the notice, ticks what to share, sets their own password. Their data self-deletes after 30 days; "My data" lets them withdraw, download or delete everything.

## Mobile app: sign-in, pilot join and "My data"
The Expo app now has real accounts (`apps/mobile`): **Login** (with MFA code if enabled), **Join the pilot** (invite code or `gatehouse://join/<token>` deep link, privacy notice, per-scope consent switches), and **My data** (withdraw consent, export a copy, delete account and data, sign out). Token is kept in the OS keychain (`expo-secure-store`); erasure also wipes the local SQLite queue and queued photos.
It talks to a bearer-token API in the web app (`/api/mobile/*`: `login`, `join`, `notice`, `invite/:token`, `me`, `consent/withdraw`, `export`, `erase`, `sync`). Offline sync now goes through the authenticated `/api/mobile/sync`; the guard identity comes from the token, never the request body. Mobile tokens last 14 days and are revoked by password/MFA resets or erasure. Only guard roles can sign in on mobile. Set `EXPO_PUBLIC_API_URL`.
The shift screen still uses a demo shift (assignment fetching is not built), so its sync will be rejected until real shift data is wired in.

## Decisions worth knowing
- **Override role**: `COMPLIANCE_ADMIN` only (CLAUDE.md), not plain `ADMIN` as the phase prompt said.
- **SIA check** compares licence expiry (valid to end of that day) against shift **end**, stricter than shift start.
- **`expo-nfc` does not exist**; the mobile app uses `react-native-nfc-manager` (needs a dev build, not Expo Go).
- Mobile queue adds a `REJECTED` sync status so server refusals (e.g. outside geofence) are kept, not dropped.
- `drizzle-kit generate` quotes the custom PostGIS types; strip the quotes (`"geography(Point, 4326)"` -> `geography(Point, 4326)`) in new migrations.

## Pilot & GDPR
- Default data is **synthetic** (`users.data_origin = SYNTHETIC`, reserved email domains, Ofcom drama-range phone numbers). A test fails if seed/fixtures contain anything real-looking.
- Real people are `PILOT_CONSENTED`: a `consents` row (scopes `IDENTITY` / `CONTACT` / `SIA_DETAILS`, policy version) is required, only consented fields are stored, and `retention_expires_at` is set to **30 days** after consent.
- The importer refuses non-reserved emails in synthetic mode, and refuses pilot mode unless `ALLOW_PILOT_DATA=true` (set it only on the dedicated pilot database, region `eu-west-2`).
- `/privacy/*` endpoints: record/withdraw consent, subject export, erasure. `pnpm --filter @gatehouse/api retention` (run daily via cron) anonymises expired pilot users and prints S3 keys to delete.
- Anonymisation keeps the `users` row and the append-only logs (IDs only, no personal data) so audit integrity holds. BS 7858 vetting files, home addresses and emergency contacts are out of scope for the pilot.
- You still need a privacy notice, a pilot agreement with the employer (you as processor) and a DPIA.

## Not built yet
Auth on the standalone Fastify API (it refuses to start without `ALLOW_INSECURE_DEV_AUTH=true`; the web app does not use it), WebAuthn/passkeys, SMS/email codes, XLSX import, import upload UI, drag-and-drop roster, live data wiring in web, audit-log read endpoint, S3 presign endpoint, silent SOS SMS (uses the device SMS composer), custom-role UI.
