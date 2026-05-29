# Contabo SSH Setup

## Server Details
- **Server:** vmi3308702
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

## Key Auth Setup (one-time, use rescue password if needed)

```bash
ssh-copy-id -i ~/.ssh/contabo_agentic.pub root@62.171.183.99
```

Note: `~/.ssh/contabo_agentic` is the same key as `~/.ssh/digital_ocean` — reused.
It appears in `authorized_keys` on the server as `digital_ocean`.

## One-Time Hardening (run immediately after any new server provision)

Ubuntu 24.04 ships with cloud-init override files in `/etc/ssh/sshd_config.d/` that
**re-enable PasswordAuthentication and disable PubkeyAuthentication on every reboot**.
This is the root cause of recurring SSH lockouts from brute-force bot floods.

```bash
ssh contabo-agentic

# 1. Wipe all conflicting cloud-init SSH override files
rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf \
      /etc/ssh/sshd_config.d/99-cloud-init.conf \
      /etc/ssh/sshd_config.d/99-fix.conf

# 2. Single authoritative file (99- prefix wins over everything)
echo "PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password" > /etc/ssh/sshd_config.d/99-hardening.conf

# 3. Verify — should only show 99-hardening.conf with 3 correct lines
ls /etc/ssh/sshd_config.d/
grep -r "" /etc/ssh/sshd_config.d/
sshd -t && echo "Config OK"

# 4. Install fail2ban (auto-bans IPs after repeated failed attempts)
apt-get update && apt-get install -y fail2ban
systemctl enable fail2ban && systemctl start fail2ban

# 5. Restart SSH to apply
systemctl restart ssh
```

## Post-Boot Verification

```bash
# All three must be correct
sshd -T | grep -E "passwordauthentication|pubkeyauthentication|permitrootlogin"
# Expected:
#   passwordauthentication no
#   pubkeyauthentication yes
#   permitrootlogin prohibit-password

ls /etc/ssh/sshd_config.d/
# Expected: only 99-hardening.conf

systemctl status fail2ban | grep "Active:"
# Expected: Active: active (running)
```

## Why PasswordAuthentication Must Stay Off

The server is continuously scanned by SSH bots (hundreds of attempts/min from IPs like
45.153.34.181, 110.35.80.116, 45.227.254.170, etc.). With password auth enabled, this
floods the SSH daemon and causes it to become unresponsive — appearing as
"Network is unreachable" from the client side.

With `PasswordAuthentication no`, bots are rejected at the crypto layer instantly,
no daemon load, no lockouts.
