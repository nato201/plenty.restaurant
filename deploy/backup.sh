#!/usr/bin/env bash
# Nightly backup of the database and uploaded dish photos (runs at 02:30 from /etc/cron.d/plenty-backup).
# Keeps 14 days. These copies live on the same server, so also turn on Lightsail automatic snapshots.
# Restore the database:  sudo -u postgres pg_restore --clean --if-exists -d plenty /var/backups/plenty/plenty-<date>.dump
set -euo pipefail
DEST=/var/backups/plenty
STAMP=$(date +%F-%H%M)

sudo -u postgres pg_dump -Fc plenty > "$DEST/plenty-$STAMP.dump"
tar -czf "$DEST/uploads-$STAMP.tgz" -C /opt/plenty/data uploads
find "$DEST" -type f -mtime +14 -delete
echo "$(date -Is) backup ok: plenty-$STAMP.dump"
