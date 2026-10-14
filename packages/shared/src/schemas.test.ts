import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MealEstimate, MealEstimateItem, EstimateQuestion, ProfileInput } from './schemas.js';

const jsonSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../schemas/meal-estimate.json', import.meta.url)), 'utf8'),
);

describe('schemas/meal-estimate.json stays in step with the Zod MealEstimate', () => {
  it('declares no $schema draft (claude --json-schema rejects the 2020-12 URI)', () => {
    expect(jsonSchema.$schema).toBeUndefined();
  });

  it('has the same item fields, all required', () => {
    const item = jsonSchema.properties.items.items;
    expect(Object.keys(item.properties).sort()).toEqual(Object.keys(MealEstimateItem.shape).sort());
    expect([...item.required].sort()).toEqual(Object.keys(MealEstimateItem.shape).sort());
  });

  it('has the same question fields and limits', () => {
    const q = jsonSchema.properties.questions;
    expect(q.maxItems).toBe(2);
    expect(Object.keys(q.items.properties).sort()).toEqual(Object.keys(EstimateQuestion.shape).sort());
  });

  it('accepts a typical thali and rejects junk', () => {
    const ok = MealEstimate.safeParse({
      items: [
        { name: 'Phulka roti', portion: '2 medium', grams: 70, kcal: 210, protein_g: 7, carbs_g: 42, fat_g: 1.5, fiber_g: 6, confidence: 'high', myFoodId: null, referenceId: null },
        { name: 'Ghee in tadka', portion: '1 tsp', grams: 5, kcal: 45, protein_g: 0, carbs_g: 0, fat_g: 5, fiber_g: 0, confidence: 'low', myFoodId: null, referenceId: null },
      ],
      questions: [{ text: 'Ghee or oil in the tadka?', options: ['Ghee', 'Oil', 'None'] }],
    });
    expect(ok.success).toBe(true);
    expect(MealEstimate.safeParse({ items: [{ name: 'x' }], questions: [] }).success).toBe(false);
    expect(MealEstimate.safeParse({ items: [], questions: [{ text: 'a', options: [] }, { text: 'b', options: [] }, { text: 'c', options: [] }] }).success).toBe(false);
  });
});

describe('ProfileInput', () => {
  it('validates onboarding answers', () => {
    const r = ProfileInput.safeParse({
      name: 'Arjun',
      colour: '#e07a2f',
      sex: 'male',
      birthDate: '2000-01-15',
      heightCm: 177.8,
      weightKg: 70,
      goal: 'lose',
      goalWeightKg: 66,
      paceKgWeek: 0.25,
      jobType: 'desk',
      workoutsPerWeek: 3,
      activity: 'light',
      neckCm: 38,
      waistCm: 84,
      hipCm: null,
      diet: { vegetarian: true, eggs: false },
      mealSlots: [{ name: 'Brunch', time: '11:00' }],
      specialStatus: 'none',
      aiAccess: 'sign_in',
      startWeightKg: 78,
      startDate: '2026-07-01',
    });
    expect(r.success).toBe(true);
  });
});
