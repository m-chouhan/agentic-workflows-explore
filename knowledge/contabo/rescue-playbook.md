# Contabo Rescue Playbook

Use when SSH is broken and you can't get into the server.

## Symptoms
- `ssh: connect to host X.X.X.X port 22: Network is unreachable`
- `ssh: connect to host X.X.X.X port 22: Connection refused`
- `Permission denied (publickey)`
- Host key changed warning after rescue boot

## Root Cause (Contabo-specific)

Ubuntu 24.04 cloud images ship override files in `/etc/ssh/sshd_config.d/` that
re-enable `PasswordAuthentication yes` and disable `PubkeyAuthentication` on reboot.
SSH bots then flood port 22, overwhelming the daemon → lockout.

The fix is `knowledge/contabo/ssh-setup.md` → One-Time Hardening section.

---

## Step 1 — Clear Old Host Key (local Mac)

```bash
ssh-keygen -R 62.171.183.99
```

Required whenever rescue system boots — it has different host keys.

## Step 2 — Start Rescue System

1. Go to [Contabo panel](https://new.contabo.com/servers/instance/203308702)
2. Click **⋮** → **Rescue System** → set a temporary password → **Start**
3. Wait ~3–5 minutes

## Step 3 — SSH into Rescue

```bash
ssh root@62.171.183.99   # use the temporary rescue password
# Prompt: root@rescue:~#
```

## Step 4 — Find Disk and Chroot

```bash
lsblk
# Look for the large partition — usually sda1 (~199G)

mount /dev/sda1 /mnt
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
chroot /mnt
# Prompt still shows root@rescue:/# — that's expected
```

## Step 5 — Diagnose

```bash
# Check auth log for brute force / SSH failures
tail -50 /var/log/auth.log

# Check SSH override files — these are the usual culprit
ls /etc/ssh/sshd_config.d/
grep -r "PasswordAuthentication\|PubkeyAuthentication" /etc/ssh/sshd_config.d/

# Check authorized_keys is intact
cat /root/.ssh/authorized_keys
```

## Step 6 — Fix SSH Config

```bash
# Wipe all conflicting cloud-init override files
rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf \
      /etc/ssh/sshd_config.d/99-cloud-init.conf \
      /etc/ssh/sshd_config.d/99-fix.conf

# Single authoritative hardening file
echo "PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password" > /etc/ssh/sshd_config.d/99-hardening.conf

# Verify
ls /etc/ssh/sshd_config.d/          # only 99-hardening.conf
grep -r "" /etc/ssh/sshd_config.d/  # 3 correct lines
# Note: sshd -T will show "Missing privilege separation directory" inside chroot — harmless
```

## Step 7 — Exit Chroot

```bash
exit
```

## Step 8 — Disable Rescue Mode (CRITICAL — do this before rebooting)

Go to Contabo panel → instance → stop/disable rescue mode.
If you skip this, the server boots back into rescue instead of normal OS.

## Step 9 — Reboot

```bash
reboot
```

## Step 10 — Reconnect and Install fail2ban

```bash
ssh-keygen -R 62.171.183.99   # fingerprint changes again after normal boot
ssh contabo-agentic

apt-get update && apt-get install -y fail2ban
systemctl enable fail2ban && systemctl start fail2ban

# Confirm everything is correct on live system
sshd -T | grep -E "passwordauthentication|pubkeyauthentication|permitrootlogin"
```

## ⚠️ DO NOT DO THIS (common mistakes that caused past lockouts)

```bash
# WRONG — re-enables password auth, bots will flood SSH again
echo "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/99-fix.conf

# WRONG — disables key auth, will lock you out completely
echo "PubkeyAuthentication no" > /etc/ssh/sshd_config.d/99-fix.conf
```
