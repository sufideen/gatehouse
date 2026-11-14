# Private pilot deployment

**Status: the Docker build and compose stack are written but NOT yet tested** (the build environment had no Docker daemon). The app itself, migrations, bootstrap command and production build were all tested. Expect to fix small things on the first `docker compose up`.

## Before you start (not code)
1. A UK/EU host. Any of: AWS `eu-west-2` (London) EC2/Lightsail, a UK VPS. Keep the database in the UK/EU.
2. A DNS name pointing at it (e.g. `gatehouse.yourcompany.co.uk`).
3. An SMTP account for password-reset email. AWS SES SMTP in `eu-west-2` works: verify your sending domain, add SPF/DKIM/DMARC, request production access.
4. Privacy paperwork from the GDPR checklist (notice text in `apps/web/lib/policy.ts`, pilot agreement, DPIA) **before** `ALLOW_PILOT_DATA=true`.

## Option A: one VM (simplest, ~30 min)
```bash
# on a fresh Ubuntu VM with Docker installed
git clone <repo> && cd gatehouse && git checkout claude/beautiful-lamport-scbrcd
cp .env.example .env.production      # then edit:
#   DOMAIN=gatehouse.yourcompany.co.uk
#   DB_PASSWORD=$(openssl rand -hex 24)
#   AUTH_SECRET=$(openssl rand -hex 32)
#   SMTP_URL=smtps://USER:PASS@email-smtp.eu-west-2.amazonaws.com:465
#   MAIL_FROM="Gatehouse <no-reply@yourcompany.co.uk>"
#   ALLOW_PILOT_DATA=false   # keep false until the paperwork is done (synthetic only)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
Create the first administrator (there is no public sign-up; **never run the demo seed in production**):
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e ORG_NAME="Your Company Ltd" -e ADMIN_EMAIL=you@yourcompany.co.uk -e ADMIN_FIRST=Ada -e ADMIN_LAST=Lovelace \
  -e ADMIN_PASSWORD='a-long-unique-passphrase' migrate pnpm --filter @gatehouse/db create-admin
```
Sign in, set up your authenticator (forced), then use **Pilot invites** to onboard guards.

Restrict access to your office/VPN IPs by uncommenting the block in `deploy/Caddyfile`. Open only ports 80/443 in the firewall.

## Option B: AWS managed
ECS Fargate or App Runner running this image, RDS PostgreSQL 16 (supports PostGIS: `CREATE EXTENSION postgis` is in migration 0000, so the DB user needs rds_superuser for the first migration), SES, ALB with ACM certificate, secrets in Secrets Manager. Same env vars as above. Run `pnpm --filter @gatehouse/db migrate` as a one-off task on each release.

## Operations checklist
- **Daily retention job** (pilot data deletes 30 days after consent): `docker compose ... run --rm web pnpm --filter @gatehouse/api retention`, via host cron. Delete the S3 keys it prints once S3 storage is wired.
- **Backups**: nightly `pg_dump` to UK/EU storage. Backups contain personal data: encrypt them and expire them within your retention promise (so no longer than ~30 days for pilot data, or document otherwise).
- **Updates**: `git pull && docker compose ... up -d --build` (migrations run automatically via the `migrate` service).
- **Mobile**: build the Expo app with `EXPO_PUBLIC_API_URL=https://<your domain>`.
- Known gaps: rate limiting is in memory (fine for one instance), no S3 media storage yet, no SMS/WebAuthn.
