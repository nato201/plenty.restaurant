#!/usr/bin/env bash
# Runs every few minutes from plenty-autoupdate.timer. If GitHub's main branch has new
# commits, it runs update.sh (which rolls back by itself if the new version fails).
# See what it did:   sudo journalctl -u plenty-autoupdate -n 50 --no-pager
set -euo pipefail
APP_DIR=/opt/plenty
APP_USER=plenty
cd "$APP_DIR"

# Never run two updates at once
exec 9>/run/plenty-update.lock
flock -n 9 || { echo "An update is already running."; exit 0; }

sudo -u "$APP_USER" git fetch -q origin main
LOCAL=$(sudo -u "$APP_USER" git rev-parse HEAD)
REMOTE=$(sudo -u "$APP_USER" git rev-parse origin/main)
[[ "$LOCAL" == "$REMOTE" ]] && exit 0 # nothing new: stay quiet

# Don't retry a version that already failed; wait for the next push
FAILED_FILE=/var/lib/plenty-last-failed
if [[ -f $FAILED_FILE && "$(cat $FAILED_FILE)" == "$REMOTE" ]]; then
  exit 0
fi

echo "New version on GitHub: ${REMOTE:0:7}. Updating."
if "$APP_DIR/deploy/update.sh"; then
  rm -f "$FAILED_FILE"
else
  echo "$REMOTE" > "$FAILED_FILE"
  echo "Update to ${REMOTE:0:7} failed and was rolled back. It won't be retried until there's a newer push."
  exit 1
fi
