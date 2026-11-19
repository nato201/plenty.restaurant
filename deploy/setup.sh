#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 Lightsail server for Plenty.
# Run it as the default "ubuntu" user:
#   curl -fsSL https://raw.githubusercontent.com/nato201/plenty.restaurant/main/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh
# Safe to run again: every step checks whether it's already done.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nato201/plenty.restaurant.git}"
APP_DIR=/opt/plenty
APP_USER=plenty
DB_NAME=plenty
DB_USER=plenty_app

[[ $EUID -eq 0 ]] || { echo "Please run with sudo: sudo bash setup.sh"; exit 1; }
step() { echo; echo "==> $*"; }

step "Updating the system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q ca-certificates curl gnupg git openssl unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https

step "Adding 2 GB of swap (keeps builds from running out of memory)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Installing Node.js 22"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

step "Installing PostgreSQL"
apt-get install -y -q postgresql postgresql-contrib
systemctl enable --now postgresql

step "Installing Caddy (web server with automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

step "Creating the app user and downloading the code"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
[[ -d "$APP_DIR/.git" ]] || git clone "$REPO_URL" "$APP_DIR"
mkdir -p "$APP_DIR/data/uploads" /var/backups/plenty
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 700 /var/backups/plenty

step "Creating the database"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
  NEW_DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
fi

step "Creating the settings file ($APP_DIR/.env)"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/deploy/env.production.example" "$APP_DIR/.env"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=\"$(openssl rand -hex 32)\"|" "$APP_DIR/.env"
  sed -i "s|^CHAPA_WEBHOOK_SECRET=.*|CHAPA_WEBHOOK_SECRET=\"$(openssl rand -hex 24)\"|" "$APP_DIR/.env"
  if [[ -n "${NEW_DB_URL:-}" ]]; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"$NEW_DB_URL\"|" "$APP_DIR/.env"
  fi
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    Created. Database URL, session secret and webhook secret are filled in for you."
else
  echo "    Already exists, left unchanged."
fi

step "Installing the app service, web server config and nightly backup"
cp "$APP_DIR/deploy/plenty.service" /etc/systemd/system/plenty.service
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
chmod +x "$APP_DIR/deploy/"*.sh
echo "30 2 * * * root $APP_DIR/deploy/backup.sh >> /var/log/plenty-backup.log 2>&1" > /etc/cron.d/plenty-backup
systemctl daemon-reload
systemctl enable plenty caddy

step "Turning on automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

cat <<EOF

============================================================
 Setup finished. Next:
   1. Fill in the rest of the settings:   sudo nano $APP_DIR/.env
      (Chapa keys, SMTP password, admin email/password, Teams link)
   2. Build and start the app:            sudo $APP_DIR/deploy/update.sh
   3. Check it:                           sudo systemctl status plenty
============================================================
EOF
