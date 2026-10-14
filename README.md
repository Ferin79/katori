# Katori

A private household calorie tracker. Snap your plate, add a short note like "2 rotis, 1 katori dal, little ghee", and Claude Code on the home server itemizes it into calories and macros; you review and confirm. Everyone in the house gets a profile with their own targets and a home page of charts.

The design notes (`PLAN.md`) and test reports (`TEST_REPORT.md`) are kept out of this public repo because they hold personal details; the browser checklist they describe lives here as `e2e/checklist.spec.ts`.

## Repo layout

```text
apps/web/            React + Vite UI (mobile-first), served by the server in production
apps/server/         Fastify API, SQLite (better-sqlite3 + Drizzle), job queue, claude runner, katori CLI
  drizzle/           SQL migrations
  src/mcp/           search_food MCP server over the reference tables
packages/shared/     Zod schemas, API types, and the target / body-metric formulas (unit-tested)
prompts/             food-estimator.md: the estimate rules
schemas/             meal-estimate.json: passed to claude --json-schema
deploy/              systemd units: the app and the nightly backup timer
scripts/             install.sh, deploy.sh, backup.sh, test-server.mjs, fixtures and icons
e2e/                 Playwright regression suite (the testing checklist)
```

npm workspaces; Node 22 or newer (developed on Node 24).

## Develop

```bash
npm install
npm run dev            # API on :3456 and the UI on :5173 (proxies /api), real Claude runner
```

On a development machine the server stores everything in `./data/`. To let your own profile use your existing Claude Code login while developing (instead of a credential file), start it with `KATORI_AMBIENT_AUTH_PROFILE=<your profile id>`. Other profiles never use it.

### Test mode

```bash
npm run test-server    # builds, then a fresh instance on :3100 with KATORI_DB=test.db,
                       # a seeded 60-day profile and KATORI_AI=fake (canned estimates, no plan usage)
```

The fake runner reads notes the way the prompt asks Claude to, and its failure modes can be switched for testing: `POST /api/_test/fake {"mode":"error"|"timeout"|"ok", "auth":{"profileId":"x","ok":false}}` (test mode only).

### Checks

```bash
npm run typecheck      # all workspaces
npm test               # unit and API tests (formulas, runner argv/env, queue, backups, MCP)
npm run e2e            # build, then the Playwright checklist at iPhone size against a fresh test instance
```

## Home server setup

The spare-device setup in commands, for Ubuntu on the home laptop:

1. Install Node LTS, git, sqlite3 and rsync. Reserve the laptop's IP in the router and name it `katori`.
2. Push this repo to a private GitHub repo, then on the laptop:
   ```bash
   sudo KATORI_SUBNET=192.168.1.0/24 bash scripts/install.sh git@github.com:<you>/katori.git
   ```
   This creates the `katori` user, `/var/lib/katori` (data), `/etc/katori/profiles` (credentials, mode 700), `/backup/katori`, installs Claude Code for the service user on the stable channel, builds, installs the systemd units, and opens SSH and port 3456 to your subnet only.
3. Load the reference tables (IFCT 2017 + INDB; downloaded at setup, never committed):
   ```bash
   katori import-reference
   ```
4. Open `http://katori.local:3456` on each phone, create each profile, and add it to the home screen.
5. AI access, per profile (a Claude plan sign-in is for one person's own use, so profiles never share one):
   - **Own Claude sign-in:** that person runs `claude setup-token` on their own computer with their own Pro or Max plan, then on the server: `katori set-credential <profile>` and paste the token.
   - **API key:** `katori set-credential <profile>` and paste a Claude Console key.
   - **Manual only:** nothing to do.

   Credentials are written to `/etc/katori/profiles/<profile>.env` (mode 600), never to SQLite or the UI. `katori auth-status` checks them. The tokens last a year; set a reminder for month 11.

### Day to day

| Task | Command |
| --- | --- |
| Deploy the latest main | `scripts/deploy.sh` (git pull, npm ci, build, migrate, restart) |
| Logs | `journalctl -u katori -f` |
| Check every profile's sign-in | `katori auth-status` |
| Back up now | `katori backup` (the timer runs `scripts/backup.sh` nightly at 02:30) |
| Restore | `sudo systemctl stop katori && katori restore /backup/katori/katori-YYYY-MM-DD.db && sudo systemctl start katori` |
| Monthly CSV copy | `katori export` (the backup script does this on the 1st) |

Backups keep 30 days of database snapshots plus the photos folder. For second copies, set `KATORI_BACKUP_USB=/media/<usb>` and/or `KATORI_RCLONE_REMOTE=<remote>:katori` in `/etc/katori/katori.env`. The app shows a banner if the last backup failed or is more than 36 hours old.

### Calibration (one evening)

Weigh about 10 typical meals, work out their true calories, then add each one under Settings → Household → Calibration with its photo and note. The page shows each meal's error and how many land within your pass mark (±15% by default). Tune `prompts/food-estimator.md`, deploy, and press "Re-run all".

## Not in this build

The optional Tailscale remote-access add-on is not implemented yet; the app is LAN-only.
