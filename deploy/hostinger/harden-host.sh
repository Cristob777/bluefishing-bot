#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root on the Hostinger VPS." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades || true

echo
echo "Host hardening applied."
echo "Allowed inbound services:"
ufw status numbered
echo
echo "Important: verify SSH access in a second terminal before closing this session."
