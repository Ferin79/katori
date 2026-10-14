#!/usr/bin/env bash
# Deploy the latest main on the home server: git pull, install, build, migrate, restart.
# Run as the katori user from /opt/katori (sudo is needed only for the restart).
set -euo pipefail

cd "${KATORI_APP_DIR:-/opt/katori}"
git pull --ff-only
npm ci
npm run build
KATORI_DATA_DIR=${KATORI_DATA_DIR:-/var/lib/katori} node apps/server/dist/cli.js migrate
sudo systemctl restart katori
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" && echo " katori is up"
