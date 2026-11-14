#!/usr/bin/env bash
# Run from your own machine (needs: az CLI logged in to the right subscription, openssl).
#   DNS_LABEL=gatehouse-yourco SSH_ALLOWED_CIDR=$(curl -s ifconfig.me)/32 \
#   SMTP_URL='smtps://USER:PASS@smtp.example:465' MAIL_FROM='Gatehouse <no-reply@yourco.co.uk>' \
#   ./deploy.sh [--what-if]
set -euo pipefail
cd "$(dirname "$0")"
: "${DNS_LABEL:?set DNS_LABEL}" "${SSH_ALLOWED_CIDR:?set SSH_ALLOWED_CIDR (your IP/32)}" "${SMTP_URL:?set SMTP_URL}" "${MAIL_FROM:?set MAIL_FROM}"
RG=${RG:-rg-gatehouse-pilot}; LOCATION=${LOCATION:-uksouth}
export SSH_PUBLIC_KEY=${SSH_PUBLIC_KEY:-$(cat ~/.ssh/id_ed25519.pub)}
export AUTH_SECRET=${AUTH_SECRET:-$(openssl rand -hex 32)} DB_PASSWORD=${DB_PASSWORD:-$(openssl rand -hex 24)} BACKUP_PASSPHRASE=${BACKUP_PASSPHRASE:-$(openssl rand -hex 32)}
export DNS_LABEL SSH_ALLOWED_CIDR SMTP_URL MAIL_FROM
az group create -n "$RG" -l "$LOCATION" >/dev/null
if [ "${1:-}" = "--what-if" ]; then
  az deployment group what-if -g "$RG" --parameters main.bicepparam
else
  az deployment group create -g "$RG" --parameters main.bicepparam --query properties.outputs
  echo "Secrets are in Key Vault (not printed). Keep a copy of the backup passphrase: it is the ONLY way to read backups."
fi
