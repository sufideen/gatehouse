#!/usr/bin/env bash
# Nightly: pg_dump -> gzip -> AES-256 (passphrase from Key Vault) -> private blob container. Blobs auto-expire (lifecycle rule).
# Restore: az storage blob download ... ; openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:'<passphrase>' -in f.enc | gunzip | psql
set -euo pipefail
source /etc/gatehouse.conf
tok() { curl -sf -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=$1" | jq -r .access_token; }
KVT=$(tok https%3A%2F%2Fvault.azure.net)
PASS=$(curl -sf -H "Authorization: Bearer ${KVT}" "https://${KV_NAME}.vault.azure.net/secrets/backup-passphrase?api-version=7.4" | jq -r .value)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp); trap 'rm -f "${TMP}"' EXIT
cd /opt/gatehouse/app
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db pg_dump -U gatehouse gatehouse \
  | gzip | BACKUP_PASS="${PASS}" openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASS > "${TMP}"
STT=$(tok https%3A%2F%2Fstorage.azure.com%2F)
curl -sf -X PUT -H "Authorization: Bearer ${STT}" -H "x-ms-version: 2023-11-03" -H "x-ms-blob-type: BlockBlob" \
  --data-binary @"${TMP}" "https://${STORAGE_ACCOUNT}.blob.core.windows.net/backups/backups/gatehouse-${STAMP}.sql.gz.enc"
echo "backup ${STAMP} uploaded"
