#!/usr/bin/env bash
# Daily: anonymise pilot users whose 30 days are up. Prints S3 keys to delete (media storage is not wired yet).
set -euo pipefail
cd /opt/gatehouse/app
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm web pnpm --filter @gatehouse/api retention
