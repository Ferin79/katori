#!/usr/bin/env node
// Starts a separate test instance (PLAN.md, Testing before delivery):
//   KATORI_DB=test.db, seeded fixture data, KATORI_AI=fake (canned estimates, no plan usage).
// Usage: node scripts/test-server.mjs [--port 3100] [--no-seed]
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '3100';

const env = {
  ...process.env,
  KATORI_DATA_DIR: process.env.KATORI_DATA_DIR ?? path.join(root, 'data', 'test'),
  KATORI_DB: 'test.db',
  KATORI_AI: 'fake',
  KATORI_FAKE_DELAY_MS: process.env.KATORI_FAKE_DELAY_MS ?? '1500',
  KATORI_RETRY_BASE_MS: process.env.KATORI_RETRY_BASE_MS ?? '400',
  PORT: port,
};

const cli = path.join(root, 'apps', 'server', 'dist', 'cli.js');
if (!args.includes('--no-seed')) {
  const r = spawnSync(process.execPath, [cli, 'seed-test', '--fresh'], { env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const server = spawn(process.execPath, [path.join(root, 'apps', 'server', 'dist', 'index.js')], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
