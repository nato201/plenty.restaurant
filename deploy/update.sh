#!/usr/bin/env bash
# Build and (re)start Plenty from the latest code on GitHub.
#   sudo /opt/plenty/deploy/update.sh
# It also runs automatically when GitHub has new commits (see plenty-autoupdate.timer).
#
# Safe by design:
#  - the new website is built in a separate folder and swapped in only when complete,
#    so visitors never see a half-built site;
#  - if installing, building or the health check after restart fails, it goes back to
#    the previous version automatically.
set -Eeuo pipefail
APP_DIR=/opt/plenty
APP_USER=plenty
HEALTH_URL=http://127.0.0.1:3000/api/health

[[ $EUID -eq 0 ]] || { echo "Please run with sudo"; exit 1; }
cd "$APP_DIR"
as_app() { sudo -u "$APP_USER" env -u NODE_ENV "$@"; } # build tools are dev dependencies

PREV=$(as_app git rev-parse HEAD)

healthy() {
  for _ in $(seq 1 40); do
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

install_units() {
  cp deploy/plenty.service deploy/plenty-autoupdate.service deploy/plenty-autoupdate.timer /etc/systemd/system/
  cp deploy/Caddyfile /etc/caddy/Caddyfile
  systemctl daemon-reload
  systemctl enable --now plenty-autoupdate.timer >/dev/null 2>&1 || true
  caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload-or-restart caddy
}

INSTALLED=0
SWAPPED=0
# Put the previous version back: code, packages, website and service
rollback() {
  trap - ERR # never roll back the rollback
  set +e
  echo "!! Update failed. Going back to ${PREV:0:7}."
  as_app git reset --hard -q "$PREV"
  if [[ $INSTALLED == 1 ]]; then
    as_app npm ci --no-audit --no-fund
  fi
  rm -rf dist-next
  if [[ $SWAPPED == 1 && -d dist-prev ]]; then rm -rf dist && mv dist-prev dist; fi
  install_units
  systemctl restart plenty
  if healthy; then echo "==> Back on ${PREV:0:7}; the site is running."; else echo "!! The previous version didn't start either. Check: sudo journalctl -u plenty -n 50"; fi
  exit 1
}

echo "==> Getting the latest code"
as_app git pull --ff-only -q
NEW=$(as_app git rev-parse HEAD)
if [[ "$NEW" == "$PREV" ]]; then
  echo "    Already on the latest version (${NEW:0:7}). Rebuilding anyway."
else
  echo "    ${PREV:0:7} -> ${NEW:0:7}: $(as_app git log -1 --format=%s)"
fi

trap rollback ERR

if [[ "$NEW" == "$PREV" ]] || ! as_app git diff --quiet "$PREV" "$NEW" -- package.json package-lock.json || [[ ! -d node_modules ]]; then
  echo "==> Installing packages"
  INSTALLED=1
  as_app npm ci --no-audit --no-fund
else
  echo "==> Packages unchanged, skipping install"
fi

echo "==> Building the website (in a separate folder)"
rm -rf dist-next
as_app npx vite build --outDir dist-next --emptyOutDir
rm -rf dist-prev
[[ -d dist ]] && mv dist dist-prev
mv dist-next dist
SWAPPED=1

echo "==> Updating service and web server config"
install_units

echo "==> Restarting the app (database updates run automatically on start)"
systemctl restart plenty
healthy || false # a failed health check triggers the rollback

trap - ERR
echo "==> Plenty is up on ${NEW:0:7}."
