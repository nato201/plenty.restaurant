#!/usr/bin/env bash
# Build and (re)start Plenty. Run after setup, and every time you push new code:
#   sudo /opt/plenty/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/plenty
APP_USER=plenty

[[ $EUID -eq 0 ]] || { echo "Please run with sudo"; exit 1; }
cd "$APP_DIR"

echo "==> Getting the latest code"
sudo -u "$APP_USER" git pull --ff-only

echo "==> Installing packages and building the website"
# Build tools (vite, tsx) are dev dependencies, so don't set NODE_ENV=production here
sudo -u "$APP_USER" env -u NODE_ENV npm ci --no-audit --no-fund
sudo -u "$APP_USER" env -u NODE_ENV npm run build

echo "==> Updating service and web server config (in case they changed)"
cp deploy/plenty.service /etc/systemd/system/plenty.service
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload-or-restart caddy

echo "==> Restarting the app (database updates run automatically on start)"
systemctl restart plenty

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "==> Plenty is up."
    exit 0
  fi
  sleep 1
done
echo "!! The app didn't answer within 30 seconds. See what went wrong with:"
echo "   sudo journalctl -u plenty -n 50 --no-pager"
exit 1
