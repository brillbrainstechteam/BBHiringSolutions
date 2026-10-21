#!/usr/bin/env bash
# One-command setup of BBHS on a fresh Ubuntu 22.04/24.04 server (run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/brillbrainstechteam/BBHiringSolutions/main/deploy/install.sh -o install.sh
#   sudo bash install.sh hire.brillbrainsconsultants.com
#
# Optional:  BRANCH=feat/ui-refresh   which branch to run (default: main)
#            REPO=https://<token>@github.com/brillbrainstechteam/BBHiringSolutions.git   for a private repo
#            TEST_DOMAIN=test-hire.brillbrainsconsultants.com   also set up the test copy
#
# Before running: point the domain's DNS (an A record) at this server's IP, and open ports 80 and 443.
# Safe to run again: it updates the code and keeps .env and data.
set -euo pipefail

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Usage: sudo bash install.sh <domain> (for example hire.brillbrainsconsultants.com)"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Please run as root (sudo)."; exit 1; }
REPO="${REPO:-https://github.com/brillbrainstechteam/BBHiringSolutions.git}"
BRANCH="${BRANCH:-main}"
TEST_DOMAIN="${TEST_DOMAIN:-}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "Installing Node 22, Caddy (HTTPS), ClamAV (virus scan) and git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
apt-get install -y clamav-daemon
# Let BBHS reach clamd on 127.0.0.1:3310.
grep -q '^TCPSocket 3310' /etc/clamav/clamd.conf || printf 'TCPSocket 3310\nTCPAddr 127.0.0.1\n' >> /etc/clamav/clamd.conf
systemctl enable clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
systemctl restart clamav-daemon || echo "ClamAV starts once its virus list has downloaded (a few minutes)."

id bbhs >/dev/null 2>&1 || useradd --system --home /opt/bbhs --shell /usr/sbin/nologin bbhs

setup_copy() { # $1 = live|test  $2 = port  $3 = domain
  local copy="$1" port="$2" domain="$3" dir="/opt/bbhs-$1" data="/var/lib/bbhs-$1"
  say "Setting up the $copy copy at https://$domain"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --quiet origin && git -C "$dir" checkout --quiet "$BRANCH" && git -C "$dir" reset --quiet --hard "origin/$BRANCH"
  else
    git clone --quiet --branch "$BRANCH" "$REPO" "$dir"
  fi
  mkdir -p "$data"
  if [ ! -f "$dir/.env" ]; then
    cp "$dir/.env.example" "$dir/.env"
    sed -i "s#^BBHS_ENV=.*#BBHS_ENV=$copy#; s#^PORT=.*#PORT=$port#; s#^BASE_URL=.*#BASE_URL=https://$domain#; s#^CLAMD_HOST=.*#CLAMD_HOST=127.0.0.1#" "$dir/.env"
    sed -i "s#^\# BBHS_DATA=.*#BBHS_DATA=$data#" "$dir/.env"
    sed -i "s#^TRUST_PROXY=.*#TRUST_PROXY=true#" "$dir/.env"
    echo "Created $dir/.env — add the WhatsApp, email and alert settings there later."
  fi
  chown -R bbhs: "$dir" "$data"
  chmod 600 "$dir/.env"
}

setup_copy live 4600 "$DOMAIN"
[ -n "$TEST_DOMAIN" ] && setup_copy test 4601 "$TEST_DOMAIN"

say "Starting the services"
cp /opt/bbhs-live/deploy/bbhs@.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bbhs@live
systemctl restart bbhs@live
if [ -n "$TEST_DOMAIN" ]; then systemctl enable --now bbhs@test; systemctl restart bbhs@test; fi

say "HTTPS with Caddy"
{
  printf '%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:4600\n\theader Strict-Transport-Security "max-age=31536000"\n}\n' "$DOMAIN"
  [ -n "$TEST_DOMAIN" ] && printf '\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:4601\n\theader X-Robots-Tag "noindex, nofollow"\n}\n' "$TEST_DOMAIN"
} > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

sleep 3
if curl -fsS "http://127.0.0.1:4600/api/bootstrap" >/dev/null; then
  say "Done. BBHS is running."
  echo "  Candidate form:  https://$DOMAIN/apply"
  echo "  Hiring form:     https://$DOMAIN/hire"
  echo "  Team portal:     https://$DOMAIN/team"
  echo
  echo "Next: make the first super admin (the password is shown once):"
  echo "  cd /opt/bbhs-live && sudo -u bbhs npm run make-admin -- \"Your Name\" yourusername 98XXXXXXXX"
  echo "Logs:  journalctl -u bbhs@live -f"
else
  echo "BBHS did not answer on port 4600. Check: journalctl -u bbhs@live -n 50"; exit 1
fi
