// Fixture data for test mode (KATORI_DB=test.db, KATORI_AI=fake): one profile with 60 days of
// meals, weigh-ins and tape measurements, so every Home card has something to draw.
import { addDays, dateRange, type MealSlot } from '@katori/shared';
import type { DB } from './db/client.js';
import { bodyLogs, mealItems, meals, myFoods, profiles } from './db/schema.js';
import { recalcFormula } from './services/targets.js';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Line = [name: string, portion: string, grams: number, kcal: number, p: number, c: number, f: number, fib: number];

const MENU: Record<string, Line[][]> = {
  Breakfast: [
    [['Poha', '1 katori', 150, 195, 3.8, 37.5, 3.8, 1.5], ['Chai', '1 cup', 150, 60, 2, 8.4, 2.1, 0]],
    [['Idli', '3 pieces', 120, 168, 5.4, 34.8, 0.5, 1.8], ['Sambar', '1 katori', 150, 98, 4.5, 14, 2.5, 3.5], ['Coconut chutney', '2 tbsp', 30, 75, 1, 3, 6.5, 1.5]],
    [['Upma', '1 katori', 150, 180, 4.5, 27, 6, 2.2], ['Chai', '1 cup', 150, 60, 2, 8.4, 2.1, 0]],
    [['Boiled egg', '2 large', 100, 143, 12.6, 0.7, 9.5, 0], ['Toast', '2 slices', 60, 160, 5.4, 30, 2, 1.6]],
  ],
  Lunch: [
    [['Phulka roti', '2 medium', 70, 185, 6, 35.4, 1.8, 4.9], ['Toor dal', '1 katori', 150, 158, 9.8, 23.3, 1.8, 5.3], ['Bhindi sabzi', '1 katori', 150, 72, 3, 12, 0.9, 4.5], ['Oil in tadka', '1 tsp', 5, 45, 0, 0, 5, 0], ['Salad', '1 katori', 100, 20, 1, 4, 0.2, 1.8]],
    [['Steamed rice', '1 katori', 120, 156, 3.2, 33.6, 0.4, 0.5], ['Rajma', '1 katori', 150, 188, 11.3, 27, 2.3, 8.3], ['Curd', '1 katori', 150, 90, 4.7, 6.8, 5, 0], ['Ghee in tadka', '1 tsp', 5, 45, 0, 0, 5, 0]],
    [['Phulka roti', '3 medium', 105, 277, 9, 53.1, 2.7, 7.4], ['Paneer sabzi', '1 katori', 150, 270, 14.3, 9, 19.5, 1.8], ['Oil in sabzi', '1 tsp', 5, 45, 0, 0, 5, 0]],
  ],
  Snack: [
    [['Protein shake', '1 glass', 300, 210, 24, 18, 4.5, 1.5]],
    [['Banana', '1 medium', 118, 105, 1.3, 27, 0.4, 3.1], ['Roasted chana', '1 handful', 30, 110, 6.5, 17, 1.6, 5]],
    [['Chai', '1 cup', 150, 60, 2, 8.4, 2.1, 0], ['Marie biscuits', '4 pieces', 28, 125, 2, 21, 3.5, 0.6]],
  ],
  Dinner: [
    [['Phulka roti', '2 medium', 70, 185, 6, 35.4, 1.8, 4.9], ['Chole', '1 katori', 150, 210, 10.5, 30, 3.8, 9], ['Onion salad', '1 small katori', 60, 24, 0.7, 5.4, 0.1, 1], ['Oil in tadka', '1 tsp', 5, 45, 0, 0, 5, 0]],
    [['Moong dal khichdi', '1.5 katori', 225, 270, 10, 45, 5, 6], ['Curd', '1 katori', 150, 90, 4.7, 6.8, 5, 0], ['Papad', '1 roasted', 12, 45, 3.1, 7.2, 0.4, 1.2]],
    [['Plain dosa', '2 pieces', 200, 336, 7.8, 58, 7.4, 2], ['Sambar', '1 katori', 150, 98, 4.5, 14, 2.5, 3.5]],
  ],
};

export interface SeedResult {
  profileId: string;
  days: number;
  meals: number;
}

export function seedTestData(db: DB, today: string, days = 60): SeedResult {
  const rand = rng(42);
  const id = 'meera';
  const start = addDays(today, -(days - 1));
  const slots: MealSlot[] = [
    { name: 'Breakfast', time: '08:30' },
    { name: 'Lunch', time: '13:00' },
    { name: 'Snack', time: '16:30' },
    { name: 'Dinner', time: '20:00' },
  ];
  let mealCount = 0;

  db.transaction((tx) => {
    tx.insert(profiles)
      .values({
        id,
        name: 'Meera',
        colour: '#7c5cbf',
        sex: 'female',
        birthDate: '1991-03-10',
        heightCm: 162,
        activity: 'light',
        jobType: 'desk',
        workoutsPerWeek: 2,
        goal: 'lose',
        goalWeightKg: 62,
        paceKgWeek: 0.25,
        dietFlags: { vegetarian: true, eggs: true },
        mealSlots: slots,
        specialStatus: 'none',
        aiAccess: 'sign_in',
        createdAt: `${start}T08:00:00.000Z`,
      })
      .run();

    tx.insert(myFoods)
      .values([
        { profileId: null, name: 'Jeera rice', aliases: ['jeera rice'], servingDesc: '1 katori', servingG: 120, kcal: 190, proteinG: 3.4, carbsG: 34, fatG: 4.5, fiberG: 0.8 },
        { profileId: id, name: 'Morning chai', aliases: ['my chai'], servingDesc: '1 cup', servingG: 150, kcal: 70, proteinG: 2.2, carbsG: 9.5, fatG: 2.4, fiberG: 0 },
      ])
      .run();

    // Weight drifts from 68.4 to ~66 kg with daily water swings; tape every 14 days.
    for (const [i, date] of dateRange(start, today).entries()) {
      const skipWeigh = rand() < 0.12;
      const weight = Math.round((68.4 - i * 0.04 + (rand() - 0.5) * 0.9) * 10) / 10;
      const tape = i % 14 === 0;
      if (!skipWeigh || tape) {
        tx.insert(bodyLogs)
          .values({
            profileId: id,
            date,
            weightKg: weight,
            neckCm: tape ? 32.5 : null,
            waistCm: tape ? Math.round((81 - i * 0.05) * 10) / 10 : null,
            hipCm: tape ? Math.round((101 - i * 0.03) * 10) / 10 : null,
          })
          .run();
      }

      if (rand() < 0.08 && date !== today) continue; // a few unlogged days
      for (const slot of slots) {
        if (date === today && slot.name !== 'Breakfast') continue; // today is still young
        if (slot.name === 'Snack' && rand() < 0.3) continue;
        const options = MENU[slot.name]!;
        const lines = options[Math.floor(rand() * options.length)]!;
        const scale = 0.85 + rand() * 0.35;
        const meal = tx
          .insert(meals)
          .values({
            profileId: id,
            eatenAt: `${date}T${slot.time}`,
            eatenDate: date,
            slot: slot.name,
            note: lines.map((l) => `${l[1]} ${l[0].toLowerCase()}`).join(', '),
            status: 'confirmed',
            confirmedAt: `${date}T${slot.time}:00.000Z`,
            createdAt: `${date}T${slot.time}:00.000Z`,
          })
          .returning({ id: meals.id })
          .get();
        tx.insert(mealItems)
          .values(
            lines.map(([name, portion, grams, kcal, p, c, f, fib], position) => ({
              mealId: meal.id,
              position,
              name,
              portion,
              grams: Math.round(grams * scale),
              kcal: Math.round(kcal * scale),
              proteinG: Math.round(p * scale * 10) / 10,
              carbsG: Math.round(c * scale * 10) / 10,
              fatG: Math.round(f * scale * 10) / 10,
              fiberG: Math.round(fib * scale * 10) / 10,
              confidence: 'high' as const,
              source: 'ai' as const,
              myFoodId: null,
            })),
          )
          .run();
        mealCount++;
      }
    }
  });

  const profile = db.select().from(profiles).all().find((p) => p.id === id)!;
  recalcFormula(db, profile, start, 68.4);
  recalcFormula(db, profile, addDays(start, 30));
  return { profileId: id, days, meals: mealCount };
}
