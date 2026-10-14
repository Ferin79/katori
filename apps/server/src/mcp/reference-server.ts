// A tiny stdio MCP server with one read-only tool, search_food, over the reference tables.
// The estimate job passes it with --mcp-config + --strict-mcp-config and allows only this tool,
// so Claude looks up per-100 g values instead of recalling them.
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { rankReference } from '../services/reference-search.js';

const dbPath = process.env.KATORI_DB;
if (!dbPath) {
  process.stderr.write('KATORI_DB is required\n');
  process.exit(1);
}

interface Row {
  id: string;
  source: string;
  name: string;
  searchText: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  serving_desc: string | null;
  serving_g: number | null;
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare('SELECT id, source, name, search_text AS searchText, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_desc, serving_g FROM reference_foods')
  .all() as Row[];
db.close();

const r1 = (n: number) => Math.round(n * 10) / 10;

const server = new McpServer({ name: 'katori-reference', version: '1.0.0' });

function lines(query: string, limit: number): string {
  const found = rankReference(rows, query, limit);
  if (!found.length) return `No matches for "${query}". Try a simpler or alternative name.`;
  return found
    .map((r) => {
      const serving = r.serving_g ? `; typical serving ${r.serving_desc ?? ''} ≈ ${Math.round(r.serving_g)} g` : '';
      return `${r.id} | ${r.name} (${r.source}) | per 100 g: ${Math.round(r.kcal)} kcal, protein ${r1(r.protein_g)} g, carbs ${r1(r.carbs_g)} g, fat ${r1(r.fat_g)} g, fiber ${r1(r.fiber_g)} g${serving}`;
    })
    .join('\n');
}

server.registerTool(
  'search_food',
  {
    title: 'Search Indian food composition tables',
    description:
      'Search IFCT 2017 (raw foods) and the Indian Nutrient Databank (INDB: cooked recipes, whose values already include their usual cooking oil, and raw foods). Returns values per 100 g, plus a typical serving where known. Pass every line of the plate at once in `queries` (short names, e.g. ["toor dal", "chapati", "bhindi sabzi"]) to save turns.',
    inputSchema: {
      queries: z.array(z.string().min(2)).min(1).max(12).optional().describe('Dish or ingredient names, one per plate line'),
      query: z.string().min(2).optional().describe('A single dish or ingredient name'),
      limit: z.number().int().min(1).max(10).optional().describe('Matches per name (default 5)'),
    },
  },
  async ({ queries, query, limit }) => {
    const names = [...(queries ?? []), ...(query ? [query] : [])];
    if (!names.length) return { content: [{ type: 'text', text: 'Pass `queries` (a list of names) or `query`.' }], isError: true };
    const text = names.map((q) => `## ${q}\n${lines(q, limit ?? 5)}`).join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

await server.connect(new StdioServerTransport());
