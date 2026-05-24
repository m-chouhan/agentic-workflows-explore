# Contabo Rescue Playbook

Use this when SSH is broken and you can't get into the server.

## When to Use
- `ssh: connect to host X.X.X.X port 22: Connection refused`
- `Permission denied (publickey,password)`
- Server rebooted and SSH stopped working

## Step 1 — Start Rescue System

1. Log into [Contabo Customer Panel](https://my.contabo.com)
2. Go to your server → click **⋮** → **Rescue System**
3. Enter a temporary password (e.g. `rescue123`) → **Start Rescue System** → **Confirm**
4. Wait ~3-7 minutes for rescue to boot

## Step 2 — SSH into Rescue

```bash
ssh-keygen -R <server-ip>   # clear old known_hosts entry
ssh root@<server-ip>         # use the password you set above
```

Prompt will show `root@rescue:~#` — you're in the temporary rescue Debian, NOT your real server.

## Step 3 — Mount Your Real Disk

```bash
lsblk   # find your disk — usually sda1 (the large ~200GB partition)

mount /dev/sda1 /mnt
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys

chroot /mnt   # now you're operating inside your real Ubuntu
```

## Step 4 — Fix SSH Config

```bash
# Check what's broken
grep -r "PasswordAuthentication\|PermitRootLogin" /etc/ssh/

# Fix the Contabo cloud-init override (main culprit)
echo "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/60-cloudimg-settings.conf

# Create a high-priority override file
echo "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/99-fix.conf
echo "PermitRootLogin yes" >> /etc/ssh/sshd_config.d/99-fix.conf

# Ensure SSH starts on boot
systemctl enable ssh
```

## Step 5 — Reset Root Password (if needed)

```bash
passwd root
```

Verify password is set (not locked):
```bash
grep root /etc/shadow | cut -d: -f1-2
# Should show root:$y$... or root:$6$... (NOT root:* or root:!)
```

## Step 6 — Verify Before Rebooting

```bash
# All these should show "yes", no "no"
grep -r "PasswordAuthentication\|PermitRootLogin" /etc/ssh/

# Validate SSH config syntax
sshd -t -f /etc/ssh/sshd_config
# "Missing privilege separation directory" warning is harmless

# SSH symlink should exist
ls /etc/systemd/system/multi-user.target.wants/ssh.service
```

## Step 7 — Exit and Reboot

```bash
exit   # exit chroot
```

Contabo panel → **🔄 restart** to exit rescue mode and boot real Ubuntu.

## Step 8 — Reconnect

```bash
ssh-keygen -R <server-ip>   # clear known_hosts (fingerprint changes after rescue)
ssh root@<server-ip>         # or use your SSH alias
```

## Root Cause (Contabo-specific)

Contabo provisions servers with `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/60-cloudimg-settings.conf`. If you restart without SSH keys set up, you get locked out. Always set up SSH key auth after first login.
