#!/bin/bash
# Backs up the repair log database, first to ./backups/ locally, then to
# a NAS share if NAS_BACKUP_DIR is set below (or in a sibling .env.backup
# file — see README). Run manually, or schedule nightly with cron:
#   0 2 * * * /path/to/repair-log/backup.sh
#
# Every nightly backup is kept indefinitely — nothing is ever deleted
# automatically, locally or on the NAS.

set -e
cd "$(dirname "$0")"

# Point this at your NAS mount, e.g. a share mounted via /etc/fstab:
#   //192.168.1.50/backups   /mnt/nas-backups   cifs   credentials=/root/.smbcredentials,uid=root,gid=root  0  0
# Leave empty to skip the NAS copy (local backups only).
NAS_BACKUP_DIR="${NAS_BACKUP_DIR:-/mnt/nas-backups/repair-log}"

mkdir -p backups
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="repair-log_$TIMESTAMP.db"

sqlite3 data/repair-log.db ".backup 'backups/$FILENAME'"
echo "Local backup saved: backups/$FILENAME"
echo "Local backups kept: $(ls backups/*.db | wc -l)"

# Copy to the NAS if it's reachable (mounted). This won't fail the whole
# script if the NAS is briefly offline — it just skips that night's copy
# and logs a warning, so check on it periodically.
if [ -n "$NAS_BACKUP_DIR" ]; then
  if [ -d "$(dirname "$NAS_BACKUP_DIR")" ] || mountpoint -q "$(dirname "$NAS_BACKUP_DIR")" 2>/dev/null; then
    mkdir -p "$NAS_BACKUP_DIR"
    cp "backups/$FILENAME" "$NAS_BACKUP_DIR/$FILENAME"
    echo "Copied to NAS: $NAS_BACKUP_DIR/$FILENAME"
  else
    echo "WARNING: NAS path $NAS_BACKUP_DIR not reachable — skipped NAS copy for this run." >&2
  fi
fi
