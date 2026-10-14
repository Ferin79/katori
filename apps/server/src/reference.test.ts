import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { referenceFoods } from './db/schema.js';
import { ifctRows, parseCsv, searchReference } from './services/reference.js';
import { rankReference } from './services/reference-search.js';
import { makeTestApp, type TestApp } from './test/helpers.js';

const rows = [
  { name: 'Red gram, dal', searchText: 'red gram, dal h. arhar dal; toor', source: 'IFCT2017' },
  { name: 'Chapati/Roti', searchText: 'chapati/roti', source: 'INDB' },
  { name: 'Soya roti', searchText: 'soya roti', source: 'INDB' },
  { name: 'Egg, poultry, whole, boiled', searchText: 'egg, poultry, whole, boiled', source: 'IFCT2017' },
  { name: 'Coconut oil', searchText: 'coconut oil', source: 'IFCT2017' },
  { name: 'Paneer in butter sauce', searchText: 'paneer in butter sauce', source: 'INDB' },
];

describe('reference search', () => {
  it('expands household words to table spellings', () => {
    expect(rankReference(rows, 'toor dal', 3)[0]!.name).toBe('Red gram, dal');
    expect(rankReference(rows, 'chapati', 3)[0]!.name).toBe('Chapati/Roti');
  });

  it('ignores mid-word hits and tolerates one unmatched word in long dish names', () => {
    expect(rankReference(rows, 'oil', 5).map((r) => r.name)).toEqual(['Coconut oil']);
    expect(rankReference(rows, 'paneer butter masala', 3)[0]!.name).toBe('Paneer in butter sauce');
  });

  it('parses IFCT CSV, converting kJ to kcal and filling blank energy for fats', () => {
    const csv = 'code,name,lang,enerc,protcnt,fatce,choavldf,fibtg\r\n"A003","Bajra","H. Bajra",1456,10.96,5.43,61.78,11.49\r\n"T013","Ghee","Mar. Tup",0,0,100,0,0\r\n';
    expect(parseCsv(csv)).toHaveLength(3);
    const [bajra, ghee] = ifctRows(csv);
    expect(bajra!.kcal).toBeCloseTo(348, 0);
    expect(bajra!.searchText).toContain('h. bajra');
    expect(ghee!.kcal).toBe(900);
  });
});

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe('search_food MCP server', () => {
  it('answers a tool call over stdio', async () => {
    t = await makeTestApp();
    t.ctx.db
      .insert(referenceFoods)
      .values([
        { id: 'INDB:ASC096', source: 'INDB', name: 'Chapati/Roti', searchText: 'chapati/roti', kcal: 202, proteinG: 5.9, carbsG: 34, fatG: 4, fiberG: 5, servingDesc: 'chapati', servingG: 36 },
        { id: 'IFCT:T013', source: 'IFCT2017', name: 'Ghee', searchText: 'ghee', kcal: 900, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0, servingDesc: null, servingG: null },
      ])
      .run();
    expect(searchReference(t.ctx.db, 'roti', 5)[0]!.id).toBe('INDB:ASC096');

    const server = fileURLToPath(new URL('./mcp/reference-server.ts', import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', server],
      env: { ...process.env, KATORI_DB: t.cfg.dbPath } as Record<string, string>,
      cwd: path.dirname(server),
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((x) => x.name)).toEqual(['search_food']);
      const res = await client.callTool({ name: 'search_food', arguments: { query: 'phulka' } });
      const text = (res.content as { type: string; text: string }[])[0]!.text;
      expect(text).toContain('INDB:ASC096 | Chapati/Roti (INDB) | per 100 g: 202 kcal');
      expect(text).toContain('typical serving chapati ≈ 36 g');
      // One call can look up every line of the plate.
      const batch = await client.callTool({ name: 'search_food', arguments: { queries: ['roti', 'ghee'] } });
      const batchText = (batch.content as { type: string; text: string }[])[0]!.text;
      expect(batchText).toMatch(/## roti\nINDB:ASC096[\s\S]*## ghee\nIFCT:T013/);
    } finally {
      await client.close();
    }
  });
});
