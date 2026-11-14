using './main.bicep'

// Values come from environment variables so no secret ever lands in a file or in git. deploy.sh sets them.
param dnsLabel = readEnvironmentVariable('DNS_LABEL')
param sshPublicKey = readEnvironmentVariable('SSH_PUBLIC_KEY')
param sshAllowedCidr = readEnvironmentVariable('SSH_ALLOWED_CIDR')
param authSecret = readEnvironmentVariable('AUTH_SECRET')
param dbPassword = readEnvironmentVariable('DB_PASSWORD')
param backupPassphrase = readEnvironmentVariable('BACKUP_PASSPHRASE')
param smtpUrl = readEnvironmentVariable('SMTP_URL')
param mailFrom = readEnvironmentVariable('MAIL_FROM')
param allowPilotData = bool(readEnvironmentVariable('ALLOW_PILOT_DATA', 'false'))
