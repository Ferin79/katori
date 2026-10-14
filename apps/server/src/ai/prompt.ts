import type { EstimateRequest, MyFoodRow } from './runner.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

function foodLine(f: MyFoodRow): string {
  const aliases = f.aliases.length ? ` (also: ${f.aliases.join(', ')})` : '';
  return `- id ${f.id}: ${f.name}${aliases}. Per ${f.servingDesc} (${r1(f.servingG)} g): ${Math.round(f.kcal)} kcal, protein ${r1(f.proteinG)} g, carbs ${r1(f.carbsG)} g, fat ${r1(f.fatG)} g, fiber ${r1(f.fiberG)} g.`;
}

/**
 * The per-run system prompt: prompts/food-estimator.md plus this household's measures,
 * this person's diet and the saved food names, so "my usual dal" maps to real numbers.
 */
export function buildSystemPrompt(base: string, req: Pick<EstimateRequest, 'settings' | 'profile' | 'savedFoods' | 'referenceLookup'>): string {
  const s = req.settings;
  const diet = req.profile.dietFlags;
  const lines = [
    base.trim(),
    '',
    '## Household measures',
    '',
    `- 1 katori (bowl) = ${s.katoriMl} ml`,
    `- 1 typical roti = ${s.rotiG} g`,
    `- 1 ladle = ${s.ladleMl} ml`,
    `- Usual cooking oil or ghee per sabzi or dal serving = ${s.oilPerServingMl} ml (about ${r1(s.oilPerServingMl * 0.9)} g, ${Math.round(s.oilPerServingMl * 0.9 * 9)} kcal)`,
    '',
    '## This person',
    '',
    `- Diet: ${diet.vegetarian ? 'vegetarian' : 'not vegetarian'}${diet.vegetarian ? (diet.eggs ? ', eats eggs' : ', no eggs') : ''}.`,
    `- Usual meals: ${req.profile.mealSlots.map((m) => `${m.name} ~${m.time}`).join(', ')}.`,
    '',
    '## Saved foods',
    '',
    req.savedFoods.length
      ? req.savedFoods.map(foodLine).join('\n')
      : '- None yet.',
  ];
  if (req.referenceLookup) {
    lines.push(
      '',
      '## Reference lookup',
      '',
      'A `search_food` tool searches IFCT 2017 and the Indian Nutrient Databank (values per 100 g). Call it once with every line that is not a saved food in `queries`, scale the per-100 g values to your grams, and put the returned id in `referenceId`. Prefer INDB recipe entries for cooked dishes and IFCT for raw ingredients.',
      '',
      'INDB recipe values already include that recipe\'s usual cooking oil. When you use one, keep the fat visible without counting it twice: name the line with "(incl. oil)", e.g. "Bhindi sabzi (incl. oil)", and add a separate fat line only for ghee or oil beyond that (ghee on the roti, a heavy tadka, the note says extra). For IFCT raw ingredients or your own values, cooking fat stays its own line as above.',
    );
  }
  return lines.join('\n') + '\n';
}

export const PHOTO_NAME = 'meal.jpg';

export function buildUserPrompt(p: { hasPhoto: boolean; note: string; answers: { question: string; answer: string }[] }): string {
  const note = p.note.trim() || '(none)';
  const parts = [p.hasPhoto ? `Estimate this meal. Photo: ./${PHOTO_NAME}. Note: ${note}` : `Estimate this meal from the note only; there is no photo. Note: ${note}`];
  if (p.answers.length) {
    parts.push('Answers to your earlier questions:');
    for (const a of p.answers) parts.push(`- ${a.question} → ${a.answer}`);
  }
  return parts.join('\n');
}
