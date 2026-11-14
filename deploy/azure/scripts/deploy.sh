#!/usr/bin/env bash
# Run on the VM after the repo is in /opt/gatehouse/app:  /opt/gatehouse/bin/deploy.sh
set -euo pipefail
cd /opt/gatehouse/app
/opt/gatehouse/bin/fetch-env.sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
