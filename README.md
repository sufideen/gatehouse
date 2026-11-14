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
Auth (API currently reads `x-actor-id`), XLSX import, import upload UI, drag-and-drop roster, live data wiring in web, audit-log read endpoint, S3 presign endpoint, silent SOS SMS (uses the device SMS composer), custom-role UI.
