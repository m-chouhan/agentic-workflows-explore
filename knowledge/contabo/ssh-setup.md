# Contabo SSH Setup

## Server Details
- **Server:** vmi3308702 (`codenscious-staging`)
- **IP:** `62.171.183.99`
- **OS:** Ubuntu 24.04.4 LTS
- **Default user:** `root`

## SSH Config (`~/.ssh/config`)

```
Host contabo-agentic
    HostName 62.171.183.99
    User root
    IdentityFile ~/.ssh/contabo_agentic
    IdentitiesOnly yes
    ServerAliveInterval 60
    StrictHostKeyChecking no
```

Connect with:
```bash
ssh contabo-agentic
```

## Key Auth Setup (one-time)

```bash
# Copy existing key to server (enter password once)
ssh-copy-id -i ~/.ssh/contabo_agentic.pub root@62.171.183.99
```

## SSH Config Files on Server

SSH config is loaded in layers — later files override earlier ones:

```
/etc/ssh/sshd_config                        # base config
/etc/ssh/sshd_config.d/60-cloudimg-settings.conf  # Contabo cloud-init override
/etc/ssh/sshd_config.d/99-fix.conf          # our override (highest priority)
```

**Important:** Contabo sets `PasswordAuthentication no` by default in `60-cloudimg-settings.conf`. This is intentional (security) but locks you out if you have no SSH key.

## Disable Password Auth (after key auth confirmed working)

```bash
echo "PasswordAuthentication no" > /etc/ssh/sshd_config.d/60-cloudimg-settings.conf
systemctl restart ssh
```
