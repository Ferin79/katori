// Reference tables: IFCT 2017 (528 raw foods) and INDB (1,014 recipes + raw foods), per 100 g.
// They're loaded into SQLite at setup time and never committed to the repo, since INDB's data
// licence is unsettled (PLAN.md, Accuracy section 3).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import type { ReferenceFood } from '@katori/shared';
import type { DB } from '../db/client.js';
import { referenceFoods } from '../db/schema.js';
import { rankReference } from './reference-search.js';

export const IFCT_TARBALL = 'https://registry.npmjs.org/ifct2017/-/ifct2017-2.1.2.tgz';
export const INDB_XLSX = 'https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/raw/main/INDB.xlsx';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function referenceCount(db: DB): number {
  return (db.$client.prepare('SELECT COUNT(*) AS n FROM reference_foods').get() as { n: number }).n;
}

export function referenceSources(db: DB): string[] {
  return (db.$client.prepare('SELECT DISTINCT source FROM reference_foods ORDER BY source').all() as { source: string }[]).map((r) => r.source);
}

type RefRow = typeof referenceFoods.$inferSelect;

const toRef = (r: RefRow): ReferenceFood => ({
  id: r.id,
  source: r.source,
  name: r.name,
  kcal: Math.round(r.kcal),
  protein_g: r1(r.proteinG),
  carbs_g: r1(r.carbsG),
  fat_g: r1(r.fatG),
  fiber_g: r1(r.fiberG),
  servingDesc: r.servingDesc,
  servingG: r.servingG == null ? null : Math.round(r.servingG),
});

let cache: { db: DB; rows: RefRow[] } | null = null;

function allRows(db: DB): RefRow[] {
  if (cache?.db !== db) cache = { db, rows: db.select().from(referenceFoods).all() };
  return cache.rows;
}

/** Synonym-aware, scored search (see reference-search.ts). */
export function searchReference(db: DB, query: string, limit = 10): ReferenceFood[] {
  return rankReference(allRows(db), query, limit).map(toRef);
}

// ---------- Import ----------

/** RFC 4180-ish CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]);
}

/** Pull one file out of an npm tarball (.tgz). */
export function extractFromTarball(tgz: Buffer, wanted: string): Buffer | null {
  const tar = gunzipSync(tgz);
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const full = prefix ? `${prefix}/${name}` : name;
    if (full === wanted) return Buffer.from(tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** First worksheet of an .xlsx as rows of strings. */
export function readXlsx(data: Uint8Array): string[][] {
  const files = unzipSync(data, { filter: (f) => f.name === 'xl/sharedStrings.xml' || f.name === 'xl/worksheets/sheet1.xml' });
  const shared = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '';
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const strings = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
  const colIndex = (ref: string) => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] ?? '').match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (c[3] ?? '').match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      row[colIndex(c[1]!)] = /t="s"/.test(c[2]!) ? (strings[Number(v)] ?? '') : decode(v);
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** IFCT leaves energy blank for oils and ghee: fall back to Atwater factors from the macros. */
const energyOr = (kcal: number, p: number, c: number, f: number, fib: number) => (kcal > 0 ? kcal : 4 * p + 4 * c + 9 * f + 2 * fib);

export function ifctRows(csv: string): (typeof referenceFoods.$inferInsert)[] {
  const [header, ...rows] = parseCsv(csv);
  const ix = (k: string) => header!.indexOf(k);
  const [code, name, lang, enerc, prot, fat, cho, fib] = ['code', 'name', 'lang', 'enerc', 'protcnt', 'fatce', 'choavldf', 'fibtg'].map(ix);
  return rows
    .filter((r) => r[code!] && r[name!])
    .map((r) => ({
      id: `IFCT:${r[code!]}`,
      source: 'IFCT2017' as const,
      name: r[name!]!,
      // Local names (Hindi, Gujarati, …) make "atta" or "jowar" findable.
      searchText: `${r[name!]} ${r[lang!] ?? ''}`.toLowerCase(),
      kcal: energyOr(num(r[enerc!]) / 4.184, num(r[prot!]), num(r[cho!]), num(r[fat!]), num(r[fib!])), // IFCT energy is kJ per 100 g
      proteinG: num(r[prot!]),
      carbsG: num(r[cho!]),
      fatG: num(r[fat!]),
      fiberG: num(r[fib!]),
      servingDesc: null,
      servingG: null,
    }));
}

export function indbRows(sheet: string[][]): (typeof referenceFoods.$inferInsert)[] {
  const [header, ...rows] = sheet;
  const ix = (k: string) => header!.indexOf(k);
  const [code, name, kcal, carb, prot, fat, fib, unit, unitKcal] = ['food_code', 'food_name', 'energy_kcal', 'carb_g', 'protein_g', 'fat_g', 'fibre_g', 'servings_unit', 'unit_serving_energy_kcal'].map(ix);
  return rows
    .filter((r) => r[code!] && r[name!])
    .map((r) => {
      const per100 = num(r[kcal!]);
      const servingKcal = num(r[unitKcal!]);
      return {
        id: `INDB:${r[code!]}`,
        source: 'INDB' as const,
        name: r[name!]!,
        searchText: r[name!]!.toLowerCase(),
        kcal: energyOr(per100, num(r[prot!]), num(r[carb!]), num(r[fat!]), num(r[fib!])),
        proteinG: num(r[prot!]),
        carbsG: num(r[carb!]),
        fatG: num(r[fat!]),
        fiberG: num(r[fib!]),
        servingDesc: r[unit!] || null,
        servingG: per100 > 0 && servingKcal > 0 ? (servingKcal / per100) * 100 : null,
      };
    });
}

export interface ImportOptions {
  /** Local copies; otherwise both are downloaded. */
  ifctTarball?: string;
  ifctCsv?: string;
  indbXlsx?: string;
  skipIndb?: boolean;
  log?: (msg: string) => void;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function importReference(db: DB, opts: ImportOptions = {}): Promise<{ ifct: number; indb: number }> {
  const log = opts.log ?? (() => {});
  let csv: string;
  if (opts.ifctCsv) csv = readFileSync(opts.ifctCsv, 'utf8');
  else {
    log(opts.ifctTarball ? `Reading ${opts.ifctTarball}` : `Downloading IFCT 2017 from ${IFCT_TARBALL}`);
    const tgz = opts.ifctTarball ? readFileSync(opts.ifctTarball) : await fetchBuffer(IFCT_TARBALL);
    const file = extractFromTarball(tgz, 'package/compositions/index.csv');
    if (!file) throw new Error('compositions/index.csv not found in the ifct2017 tarball');
    csv = file.toString('utf8');
  }
  const ifct = ifctRows(csv);

  let indb: (typeof referenceFoods.$inferInsert)[] = [];
  if (!opts.skipIndb) {
    log(opts.indbXlsx ? `Reading ${opts.indbXlsx}` : `Downloading INDB from ${INDB_XLSX}`);
    const xlsx = opts.indbXlsx ? readFileSync(opts.indbXlsx) : await fetchBuffer(INDB_XLSX);
    indb = indbRows(readXlsx(xlsx));
  }

  cache = null;
  db.transaction((tx) => {
    tx.delete(referenceFoods).where(sql`source = 'IFCT2017'`).run();
    if (!opts.skipIndb) tx.delete(referenceFoods).where(sql`source = 'INDB'`).run();
    for (const batch of chunk([...ifct, ...indb], 200)) tx.insert(referenceFoods).values(batch).onConflictDoNothing().run();
  });
  log(`Loaded ${ifct.length} IFCT 2017 foods and ${indb.length} INDB foods`);
  return { ifct: ifct.length, indb: indb.length };
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
