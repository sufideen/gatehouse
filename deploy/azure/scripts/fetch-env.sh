#!/usr/bin/env bash
# Builds /opt/gatehouse/app/.env.production from Key Vault using the VM's managed identity (no secrets on disk until now, mode 600).
set -euo pipefail
source /etc/gatehouse.conf
TOKEN=$(curl -sf -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net" | jq -r .access_token)
get() { curl -sf -H "Authorization: Bearer ${TOKEN}" "https://${KV_NAME}.vault.azure.net/secrets/$1?api-version=7.4" | jq -r .value; }
umask 077
OUT=/opt/gatehouse/app/.env.production
{
  echo "DOMAIN=${DOMAIN}"
  echo "DB_PASSWORD=$(get db-password)"
  echo "AUTH_SECRET=$(get auth-secret)"
  echo "SMTP_URL=$(get smtp-url)"
  echo "MAIL_FROM=\"$(get mail-from)\""
  echo "ALLOW_PILOT_DATA=${ALLOW_PILOT_DATA}"
} > "${OUT}"
echo "wrote ${OUT}"
