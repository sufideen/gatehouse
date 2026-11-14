// Gatehouse private-pilot stack on ONE Azure VM (UK South by default).
//   VM (Ubuntu 24.04, SSH key only, Trusted Launch) + static public IP with a free DNS name
//   NSG: SSH only from your IP; 80/443 open (Caddy needs them for HTTPS certificates)
//   Key Vault (RBAC) holding the app secrets; the VM's managed identity reads them
//   Storage account for ENCRYPTED nightly database backups, auto-deleted after N days
// NOT compiled/validated in the authoring environment: run `az deployment group what-if` first (see DEPLOY.md).
targetScope = 'resourceGroup'

@description('Azure region. uksouth = London.')
param location string = 'uksouth'

@minLength(3)
@maxLength(12)
@description('Lowercase letters/digits used in resource names.')
param namePrefix string = 'gatehouse'

@description('Public DNS label -> <label>.<region>.cloudapp.azure.com. Must be unique in the region.')
param dnsLabel string

param adminUsername string = 'azureuser'

@description('Contents of your SSH public key (e.g. ~/.ssh/id_ed25519.pub).')
param sshPublicKey string

@description('Your public IP as a CIDR, e.g. 203.0.113.10/32. SSH is allowed from here only.')
param sshAllowedCidr string

param vmSize string = 'Standard_B2s'

@description('Days to keep encrypted backups. Pilot data is deleted after 30 days, so keep this at 30 or less.')
@minValue(1)
@maxValue(30)
param backupRetentionDays int = 14

@description('Keep false until the privacy paperwork is done (synthetic/internal use only).')
param allowPilotData bool = false

@secure()
param authSecret string
@secure()
param dbPassword string
@secure()
param backupPassphrase string
@secure()
param smtpUrl string
@secure()
param mailFrom string

var kvName = take('kv${namePrefix}${uniqueString(resourceGroup().id)}', 24)
var storageName = take('st${namePrefix}${uniqueString(resourceGroup().id)}', 24)
var fqdn = '${dnsLabel}.${location}.cloudapp.azure.com'

var ci1 = replace(loadTextContent('cloud-init.yaml'), '__KV_NAME__', kvName)
var ci2 = replace(ci1, '__STORAGE__', storageName)
var ci3 = replace(ci2, '__DOMAIN__', fqdn)
var ci4 = replace(ci3, '__ALLOW_PILOT__', string(allowPilotData))
var ci5 = replace(ci4, '__FETCH_B64__', loadFileAsBase64('scripts/fetch-env.sh'))
var ci6 = replace(ci5, '__BACKUP_B64__', loadFileAsBase64('scripts/backup.sh'))
var ci7 = replace(ci6, '__RETENTION_B64__', loadFileAsBase64('scripts/retention.sh'))
var cloudInit = replace(ci7, '__DEPLOY_B64__', loadFileAsBase64('scripts/deploy.sh'))

// ---------------------------------------------------------------- network
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: '${namePrefix}-nsg'
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowSshFromAdmin'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshAllowedCidr
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        // Let's Encrypt must reach 80/443 to issue the certificate. Restrict WHO can use the app in deploy/Caddyfile (IP allow-list).
        name: 'AllowWeb'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: [ '80', '443' ]
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: '${namePrefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: [ '10.20.0.0/16' ] }
    subnets: [
      {
        name: 'app'
        properties: {
          addressPrefix: '10.20.1.0/24'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-01-01' = {
  name: '${namePrefix}-ip'
  location: location
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-01-01' = {
  name: '${namePrefix}-nic'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: vnet.properties.subnets[0].id }
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

// ---------------------------------------------------------------- VM
resource vm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: '${namePrefix}-vm'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: '${namePrefix}-vm'
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: 64
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
    networkProfile: { networkInterfaces: [ { id: nic.id } ] }
  }
}

// ---------------------------------------------------------------- secrets
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource secAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'auth-secret'
  properties: { value: authSecret }
}
resource secDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'db-password'
  properties: { value: dbPassword }
}
resource secBackup 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'backup-passphrase'
  properties: { value: backupPassphrase }
}
resource secSmtp 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'smtp-url'
  properties: { value: smtpUrl }
}
resource secMail 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'mail-from'
  properties: { value: mailFrom }
}

// Built-in role: Key Vault Secrets User
resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, vm.id, 'kv-secrets-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0f2d3a6f8b2d')
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------- backups
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // Entra/managed-identity access only
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    // No soft-delete: deleted backups really are gone, so the retention promise to pilot users holds.
    deleteRetentionPolicy: { enabled: false }
    containerDeleteRetentionPolicy: { enabled: false }
  }
}

resource backups 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'backups'
  properties: { publicAccess: 'None' }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'expire-backups'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [ 'blockBlob' ]
              prefixMatch: [ 'backups/' ]
            }
            actions: {
              baseBlob: { delete: { daysAfterModificationGreaterThan: backupRetentionDays } }
            }
          }
        }
      ]
    }
  }
}

// Built-in role: Storage Blob Data Contributor (VM uploads backups with its managed identity)
resource stRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, vm.id, 'blob-contributor')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output fqdn string = fqdn
output publicIp string = pip.properties.ipAddress
output keyVault string = kvName
output sshCommand string = 'ssh ${adminUsername}@${fqdn}'
