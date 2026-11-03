#!/bin/bash
# Backs up the databases, first to backups/ locally, then to a NAS share if
# NAS_BACKUP_DIR is set below (or in the environment). Run manually, or
# schedule nightly with cron:
#   0 2 * * * /path/to/repair-log/backup.sh
#
# Each run backs up, with the same time stamp (the names backup.js uses, so
# restore.js can put any of them back):
#   repair-log_<time>.db   the first shop
#   system_<time>.db       accounts, shops, shared settings
#   shop-<id>_<time>.db    every other shop
#
# Every nightly backup is kept indefinitely — nothing is ever deleted
# automatically, locally or on the NAS. (Unlike backup.js, runs aren't
# recorded for Справки.)

set -e
cd "$(dirname "$0")"

# Same rule as the app: data/ and backups/ in DATA_ROOT if set, else here.
BASE_DIR="${DATA_ROOT:-.}"

# Point this at your NAS mount, e.g. a share mounted via /etc/fstab:
#   //192.168.1.50/backups   /mnt/nas-backups   cifs   credentials=/root/.smbcredentials,uid=root,gid=root  0  0
# Leave empty to skip the NAS copy (local backups only).
NAS_BACKUP_DIR="${NAS_BACKUP_DIR:-/mnt/nas-backups/repair-log}"

mkdir -p "$BASE_DIR/backups"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
FILES=()

for DB in "$BASE_DIR"/data/repair-log.db "$BASE_DIR"/data/system.db "$BASE_DIR"/data/shop-*.db; do
  [ -f "$DB" ] || continue
  FILENAME="$(basename "$DB" .db)_$TIMESTAMP.db"
  sqlite3 "$DB" ".backup '$BASE_DIR/backups/$FILENAME'"
  echo "Local backup saved: $BASE_DIR/backups/$FILENAME"
  FILES+=("$FILENAME")
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: no database found in $BASE_DIR/data" >&2
  exit 1
fi
echo "Local backups kept: $(ls "$BASE_DIR"/backups/*.db | wc -l)"

# Copy to the NAS if it's reachable (mounted). This won't fail the whole
# script if the NAS is briefly offline — it just skips that night's copy
# and logs a warning, so check on it periodically.
if [ -n "$NAS_BACKUP_DIR" ]; then
  if [ -d "$(dirname "$NAS_BACKUP_DIR")" ] || mountpoint -q "$(dirname "$NAS_BACKUP_DIR")" 2>/dev/null; then
    mkdir -p "$NAS_BACKUP_DIR"
    for FILENAME in "${FILES[@]}"; do
      cp "$BASE_DIR/backups/$FILENAME" "$NAS_BACKUP_DIR/$FILENAME"
      echo "Copied to NAS: $NAS_BACKUP_DIR/$FILENAME"
    done
  else
    echo "WARNING: NAS path $NAS_BACKUP_DIR not reachable — skipped NAS copy for this run." >&2
  fi
fi
