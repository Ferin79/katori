// Scored search over the reference tables, shared by the API and the search_food MCP tool.
// IFCT and INDB use English names with regional names in brackets ("Red gram, dal",
// "Arhar dal aur palak"), so common household words are expanded to their table spellings.

const SYNONYMS: string[][] = [
  ['toor', 'tur', 'tuvar', 'arhar', 'red gram'],
  ['moong', 'mung', 'green gram'],
  ['chana', 'chole', 'chhole', 'chickpea', 'bengal gram', 'kabuli'],
  ['urad', 'black gram'],
  ['masoor', 'masur', 'lentil'],
  ['rajma', 'rajmah', 'kidney bean'],
  ['dal', 'dhal', 'daal'],
  ['roti', 'chapati', 'chapatti', 'phulka'],
  ['paratha', 'parantha', 'parotta'],
  ['curd', 'dahi', 'yogurt', 'yoghurt'],
  ['paneer', 'cottage cheese'],
  ['bhindi', 'okra', 'ladies finger', "lady's finger"],
  ['aloo', 'potato'],
  ['gobi', 'gobhi', 'cauliflower'],
  ['palak', 'spinach'],
  ['baingan', 'brinjal', 'eggplant'],
  ['methi', 'fenugreek'],
  ['matar', 'mutter', 'peas', 'pea'],
  ['lauki', 'bottle gourd', 'doodhi'],
  ['karela', 'bitter gourd'],
  ['atta', 'wheat flour'],
  ['maida', 'refined flour'],
  ['sooji', 'suji', 'semolina', 'rava'],
  ['poha', 'rice flakes', 'chiwda', 'aval', 'flattened rice'],
  ['besan', 'gram flour'],
  ['khichdi', 'khichri', 'khitchdi'],
  ['rice', 'chawal', 'bhaat'],
  ['sabzi', 'sabji', 'subji', 'curry'],
  ['shake', 'milkshake', 'smoothie'],
  ['chai', 'tea'],
  ['ghee', 'clarified butter'],
];

const ALIASES = new Map<string, string[]>();
for (const group of SYNONYMS) for (const w of group) ALIASES.set(w, group);

export interface Searchable {
  name: string;
  searchText: string;
  source: string;
}

interface Term {
  word: string;
  alts: string[];
}

function terms(query: string): Term[] {
  let q = query.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim();
  const out: Term[] = [];
  // Two-word synonyms first ("red gram", "bottle gourd").
  for (const [key, group] of ALIASES) {
    if (key.includes(' ') && q.includes(key)) {
      out.push({ word: key, alts: group });
      q = q.replace(key, ' ');
    }
  }
  for (const w of q.split(/\s+/).filter((x) => x.length > 1)) out.push({ word: w, alts: ALIASES.get(w) ?? [w] });
  return out.slice(0, 6);
}

/** 3 = whole word, 2 = start of a word; mid-word hits ("oil" in "boiled") don't count. */
function wordScore(text: string, t: Term): { score: number; at: number; exact: boolean } {
  let best = { score: 0, at: -1, exact: false };
  for (const a of t.alts) {
    for (let i = text.indexOf(a); i >= 0; i = text.indexOf(a, i + 1)) {
      if (i > 0 && /[a-z]/.test(text[i - 1]!)) continue;
      const whole = i + a.length >= text.length || !/[a-z]/.test(text[i + a.length]!);
      const score = whole ? 3 : 2;
      if (score > best.score || (score === best.score && a === t.word && !best.exact)) best = { score, at: i, exact: a === t.word };
      break;
    }
  }
  return best;
}

/**
 * Most query words (or a synonym) must appear: all of them for one or two words, all but one
 * for longer dish names. Whole-word matches in the name rank highest; cooked INDB dishes and
 * short, plain names get a nudge.
 */
export function rankReference<T extends Searchable>(rows: T[], query: string, limit: number): T[] {
  const ts = terms(query);
  if (!ts.length) return [];
  const need = ts.length <= 2 ? ts.length : ts.length - 1;
  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    const name = row.name.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of ts) {
      const inName = wordScore(name, t);
      if (inName.score) {
        matched++;
        score += inName.score + (inName.exact ? 0.5 : 0) + (inName.at === 0 ? 0.75 : 0);
        continue;
      }
      const inText = wordScore(row.searchText, t);
      if (inText.score) {
        matched++;
        score += inText.score * 0.5;
      }
    }
    if (matched < need) continue;
    if (row.source === 'INDB') score += 0.25;
    score -= Math.min(name.length, 80) / 60;
    scored.push({ row, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.row);
}
