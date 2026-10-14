#!/usr/bin/env bash
# Nightly backup: a consistent SQLite snapshot (safe while the app runs) plus the photos folder,
# 30 days kept, then optional copies to a USB drive and a cloud folder. On the 1st of the month
# it also writes a human-readable CSV copy. The app shows an alert if this hasn't run in 36 hours.
set -euo pipefail

APP=${KATORI_APP_DIR:-/opt/katori}
DEST=${KATORI_BACKUP_DIR:-/backup/katori}
CLI=(node "$APP/apps/server/dist/cli.js")

"${CLI[@]}" backup --dest "$DEST"

if [[ "$(date +%d)" == "01" ]]; then
  "${CLI[@]}" export --dest "$DEST/csv"
fi

if [[ -n "${KATORI_BACKUP_USB:-}" ]]; then
  if [[ -d "$KATORI_BACKUP_USB" ]]; then
    rsync -a --delete "$DEST/" "$KATORI_BACKUP_USB/katori/"
  else
    echo "USB backup folder $KATORI_BACKUP_USB is not mounted; skipped" >&2
  fi
fi

if [[ -n "${KATORI_RCLONE_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone sync "$DEST" "$KATORI_RCLONE_REMOTE"
  else
    echo "rclone is not installed; cloud copy skipped" >&2
  fi
fi
