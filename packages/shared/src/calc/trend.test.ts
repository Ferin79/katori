import { describe, expect, it } from 'vitest';
import { addDays, ageOn, dateRange, diffDays, isMinor, lastOfMonth, startOfWeek } from './dates.js';
import { rescaleToGrams, slotForTime, sumNutrients } from './meal.js';
import { blendMaintenance, observedMaintenance, projectGoalDate, trendWeights } from './trend.js';
import { cmToFtIn, ftInToCm } from './units.js';

describe('dates', () => {
  it('adds and diffs days across month ends', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(diffDays('2026-07-01', '2026-10-14')).toBe(105);
    expect(dateRange('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(lastOfMonth('2028-02')).toBe('2028-02-29');
    expect(startOfWeek('2026-10-14')).toBe('2026-10-12');
  });

  it('computes age and minors', () => {
    expect(ageOn('2000-01-15', '2026-10-14')).toBe(26);
    expect(ageOn('2000-10-15', '2026-10-14')).toBe(25);
    expect(isMinor('2010-05-01', '2026-10-14')).toBe(true);
  });
});

describe('units', () => {
  it("5'10\" = 177.8 cm", () => {
    expect(ftInToCm(5, 10)).toBe(177.8);
    expect(cmToFtIn(177.8)).toEqual({ ft: 5, in: 10 });
  });
});

describe('meal lines', () => {
  const dal = { name: 'Dal', grams: 150, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fiber_g: 6 };

  it('rescales macros when grams change', () => {
    const half = rescaleToGrams(dal, 75);
    expect(half).toMatchObject({ grams: 75, kcal: 90, protein_g: 4.5, carbs_g: 12, fat_g: 2.5, fiber_g: 3 });
  });

  it('sums nutrients', () => {
    expect(sumNutrients([dal, dal])).toEqual({ kcal: 360, protein_g: 18, carbs_g: 48, fat_g: 10, fiber_g: 12 });
  });

  it('picks the nearest slot', () => {
    const slots = [
      { name: 'Brunch', time: '11:00' },
      { name: 'Shake', time: '15:00' },
      { name: 'Dinner', time: '18:00' },
    ];
    expect(slotForTime(slots, '10:20')).toBe('Brunch');
    expect(slotForTime(slots, '15:40')).toBe('Shake');
    expect(slotForTime(slots, '23:10')).toBe('Dinner');
  });
});

describe('trend weight', () => {
  it('smooths daily swings', () => {
    const pts = dateRange('2026-09-01', '2026-09-10').map((date, i) => ({ date, weightKg: i % 2 ? 71 : 70 }));
    const t = trendWeights(pts);
    expect(t.at(-1)!.trendKg).toBeGreaterThan(70);
    expect(t.at(-1)!.trendKg).toBeLessThan(71);
  });

  it('projects a goal date when heading toward the goal', () => {
    const pts = dateRange('2026-08-01', '2026-09-30').map((date, i) => ({ date, weightKg: 76 - i * 0.05 }));
    const t = trendWeights(pts);
    const eta = projectGoalDate(t, 70, '2026-09-30');
    expect(eta).not.toBeNull();
    expect(eta! > '2026-09-30').toBe(true);
    expect(projectGoalDate(t, 80, '2026-09-30')).toBeNull();
  });

  it('learns maintenance from intake and trend change', () => {
    // Ate 2,000 kcal/day for 28 days and lost 1 kg of trend weight → ≈2,275 kcal maintenance.
    expect(observedMaintenance({ avgIntakeKcal: 2000, deltaTrendKg: -1, days: 28 })).toBeCloseTo(2275, 0);
    expect(blendMaintenance(2300, 2275, 10)).toBeNull();
    expect(blendMaintenance(2300, 2200, 21)).toBeCloseTo(2250, 5);
    expect(blendMaintenance(2300, 2200, 100)).toBeCloseTo(2220, 5);
  });
});
