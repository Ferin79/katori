// katori: small admin commands, run over SSH on the home server.
//   katori set-credential <profile>    store that person's own setup-token or API key (mode 600)
//   katori auth-status [profile]       run `claude auth status` per profile
//   katori backup [--dest DIR]         SQLite snapshot + photos, 30 days kept
//   katori restore <file>              restore a snapshot (stop the service first)
//   katori import-reference            load IFCT 2017 + INDB into SQLite for the lookup tool
//   katori export [--dest DIR]          monthly human-readable CSV copy
//   katori seed-test                   fixture data for test mode
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toDateStr } from '@katori/shared';
import { ClaudeRunner } from './ai/claude-runner.js';
import { FakeRunner } from './ai/fake-runner.js';
import type { Runner } from './ai/runner.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { profiles } from './db/schema.js';
import { runBackup, restoreBackup } from './services/backup.js';
import { bodyCsv, mealsCsv } from './services/export.js';
import { credentialPath, readCredential, removeCredential, writeCredential } from './services/credentials.js';
import { importReference } from './services/reference.js';
import { seedTestData } from './seed.js';

const HELP = `katori <command>

  set-credential <profile> [--type oauth|api-key]
      Store this profile's own Claude credential. Paste the token printed by
      \`claude setup-token\` (run on that person's own Pro/Max plan), or a Claude
      Console API key. Written to <credentials dir>/<profile>.env, mode 600.
  remove-credential <profile>
  auth-status [profile]          Check each profile's sign-in with \`claude auth status\`.
  list-profiles
  backup [--dest DIR]            Snapshot the database and sync photos (keeps 30 days).
  restore <file>                 Restore a snapshot. Stop the service first.
  import-reference [--ifct-tarball F] [--ifct-csv F] [--indb F] [--skip-indb]
                                 Load IFCT 2017 and INDB for the search_food lookup tool.
  export [--dest DIR]            Write each profile's meals and body CSVs (monthly copy).
  seed-test [--days N] [--fresh] Fixture data for test mode (use with KATORI_DB=test.db).
  migrate                        Apply database migrations.
`;

async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]!.trim();
  }
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          return resolve(s.trim());
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
        else s += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      type: { type: 'string' },
      dest: { type: 'string' },
      days: { type: 'string' },
      fresh: { type: 'boolean' },
      'ifct-tarball': { type: 'string' },
      'ifct-csv': { type: 'string' },
      indb: { type: 'string' },
      'skip-indb': { type: 'boolean' },
    },
  });
  const cfg = loadConfig();

  switch (command) {
    case 'set-credential': {
      const id = positionals[0];
      if (!id) throw new Error('Usage: katori set-credential <profile>');
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const profile = db.select().from(profiles).all().find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
      if (!profile) throw new Error(`No profile "${id}". Profiles: ${db.select().from(profiles).all().map((p) => p.id).join(', ') || '(none)'}`);
      if (profile.aiAccess === 'manual') throw new Error(`${profile.name} is set to manual logging. Change AI access in Settings first.`);
      const type = values.type === 'api-key' ? 'api_key' : values.type === 'oauth' ? 'oauth' : profile.aiAccess === 'api_key' ? 'api_key' : 'oauth';
      const secret = await readSecret(type === 'oauth' ? `Paste ${profile.name}'s token from \`claude setup-token\`: ` : `Paste ${profile.name}'s Claude Console API key: `);
      if (!secret) throw new Error('Nothing entered');
      const looksOauth = secret.startsWith('sk-ant-oat');
      const looksKey = secret.startsWith('sk-ant-api');
      if ((type === 'oauth' && looksKey) || (type === 'api_key' && looksOauth)) {
        throw new Error(`That looks like ${looksKey ? 'an API key' : 'a setup-token'}, but ${profile.name} is set to ${type === 'oauth' ? 'Claude sign-in' : 'API key'}.`);
      }
      const file = writeCredential(cfg, profile.id, type === 'oauth' ? { type, token: secret } : { type, key: secret });
      console.log(`Saved ${type === 'oauth' ? 'sign-in token' : 'API key'} for ${profile.name} to ${file} (mode 600).`);
      if (cfg.aiMode === 'claude') {
        const r = await new ClaudeRunner(cfg).authStatus(profile);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        process.exitCode = r.ok ? 0 : 1;
      }
      return;
    }

    case 'remove-credential': {
      const id = positionals[0];
      if (!id) throw new Error('Usage: katori remove-credential <profile>');
      console.log(removeCredential(cfg, id) ? `Removed ${credentialPath(cfg, id)}` : 'No credential file for that profile.');
      return;
    }

    case 'auth-status': {
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const runner: Runner = cfg.aiMode === 'fake' ? new FakeRunner(0) : new ClaudeRunner(cfg);
      const list = db.select().from(profiles).all().filter((p) => !positionals[0] || p.id === positionals[0]);
      let failed = 0;
      for (const p of list) {
        if (p.aiAccess === 'manual') {
          console.log(`- ${p.name} (${p.id}): manual logging, no AI`);
          continue;
        }
        const cred = readCredential(cfg, p.id);
        const r = await runner.authStatus(p);
        if (!r.ok) failed++;
        console.log(`${r.ok ? '✓' : '✗'} ${p.name} (${p.id}, ${p.aiAccess}${cred ? `, ${cred.type}` : ''}): ${r.message}`);
      }
      if (!list.length) console.log('No profiles yet.');
      process.exitCode = failed ? 1 : 0;
      return;
    }

    case 'list-profiles': {
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      for (const p of db.select().from(profiles).all()) console.log(`${p.id}\t${p.name}\t${p.aiAccess}${readCredential(cfg, p.id) ? '\tcredential set' : ''}`);
      return;
    }

    case 'backup': {
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const s = await runBackup(db, cfg, values.dest ?? cfg.backupDir);
      if (!s.ok) throw new Error(`Backup failed: ${s.error}`);
      console.log(`Backed up to ${s.file} (${s.photos} new or changed photos).`);
      return;
    }

    case 'restore': {
      const file = positionals[0];
      if (!file) throw new Error('Usage: katori restore <backup file>');
      const r = restoreBackup(cfg, file);
      console.log(`Restored ${cfg.dbPath} from ${r.restoredFrom}.${r.previous ? ` Previous database kept at ${r.previous}.` : ''}`);
      return;
    }

    case 'import-reference': {
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const r = await importReference(db, {
        ifctTarball: values['ifct-tarball'],
        ifctCsv: values['ifct-csv'],
        indbXlsx: values.indb,
        skipIndb: values['skip-indb'],
        log: (m) => console.log(m),
      });
      console.log(`Reference foods ready: ${r.ifct + r.indb}. Estimates will use the search_food lookup tool.`);
      return;
    }

    case 'seed-test': {
      if (values.fresh) for (const s of ['', '-wal', '-shm']) if (existsSync(cfg.dbPath + s)) rmSync(cfg.dbPath + s);
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const r = seedTestData(db, toDateStr(new Date()), Number(values.days ?? 60));
      console.log(`Seeded profile "${r.profileId}" with ${r.days} days and ${r.meals} meals into ${cfg.dbPath}`);
      return;
    }

    case 'export': {
      // Human-readable monthly copy: one meals CSV and one body CSV per profile.
      const db = openDb(cfg.dbPath, cfg.migrationsDir);
      const today = toDateStr(new Date());
      const dir = path.join(values.dest ?? path.join(cfg.backupDir, 'csv'), today.slice(0, 7));
      mkdirSync(dir, { recursive: true });
      for (const p of db.select().from(profiles).all()) {
        writeFileSync(path.join(dir, `${p.id}-meals.csv`), mealsCsv(db, p));
        writeFileSync(path.join(dir, `${p.id}-body.csv`), bodyCsv(db, p, today));
      }
      console.log(`Exported CSVs to ${dir}`);
      return;
    }

    case 'migrate': {
      openDb(cfg.dbPath, cfg.migrationsDir);
      console.log(`Migrated ${cfg.dbPath}`);
      return;
    }

    default:
      console.log(HELP);
      if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(`katori: ${e.message}`);
  process.exit(1);
});

