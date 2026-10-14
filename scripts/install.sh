#!/usr/bin/env bash
# One-time setup on the home server (Ubuntu). Run as root:  sudo bash scripts/install.sh <git-url>
# Assumes Node LTS, git, sqlite3 and rsync are installed (PLAN.md, Spare device setup).
set -euo pipefail

REPO=${1:?usage: install.sh <git-url-of-your-private-katori-repo>}
APP=/opt/katori

id katori >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash katori

install -d -o katori -g katori -m 750 /var/lib/katori /backup/katori
install -d -o root -g root -m 755 /etc/katori
install -d -o katori -g katori -m 700 /etc/katori/profiles

if [[ ! -d "$APP/.git" ]]; then
  git clone "$REPO" "$APP"
  chown -R katori:katori "$APP"
fi

# Claude Code for the service user, on the stable channel.
sudo -u katori bash -lc 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash'
sudo -u katori bash -lc 'mkdir -p ~/.claude && [ -f ~/.claude/settings.json ] || echo "{\"autoUpdatesChannel\": \"stable\"}" > ~/.claude/settings.json'

sudo -u katori bash -lc "cd $APP && npm ci && npm run build && KATORI_DATA_DIR=/var/lib/katori node apps/server/dist/cli.js migrate"

# The katori command, run as the service user so files keep the right owner and modes.
cat > /usr/local/bin/katori <<'EOF'
#!/usr/bin/env bash
set -a
[ -f /etc/katori/katori.env ] && . /etc/katori/katori.env
set +a
export KATORI_DATA_DIR=${KATORI_DATA_DIR:-/var/lib/katori}
export KATORI_CREDENTIALS_DIR=${KATORI_CREDENTIALS_DIR:-/etc/katori/profiles}
export KATORI_BACKUP_DIR=${KATORI_BACKUP_DIR:-/backup/katori}
export KATORI_CLAUDE_BIN=${KATORI_CLAUDE_BIN:-/home/katori/.local/bin/claude}
if [ "$(id -un)" = katori ]; then exec node /opt/katori/apps/server/dist/cli.js "$@"; fi
exec sudo --preserve-env=KATORI_DATA_DIR,KATORI_CREDENTIALS_DIR,KATORI_BACKUP_DIR,KATORI_CLAUDE_BIN -u katori node /opt/katori/apps/server/dist/cli.js "$@"
EOF
chmod 755 /usr/local/bin/katori
chmod 755 "$APP/scripts/"*.sh

cp "$APP/deploy/katori.service" "$APP/deploy/katori-backup.service" "$APP/deploy/katori-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now katori katori-backup.timer

# Allow SSH and the app from the home subnet only (edit to match your router).
if command -v ufw >/dev/null 2>&1; then
  SUBNET=${KATORI_SUBNET:-192.168.1.0/24}
  ufw allow from "$SUBNET" to any port 22 proto tcp
  ufw allow from "$SUBNET" to any port 3000 proto tcp
  ufw --force enable
fi

echo
echo "Katori is running: http://$(hostname).local:3000"
echo "Next: on each person's own computer run 'claude setup-token', then here: katori set-credential <profile>"
