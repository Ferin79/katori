import { describe, expect, it } from 'vitest';
import {
  activityFromLifestyle,
  bmr,
  calorieFloor,
  computeTargets,
  dailyEnergyDelta,
  maintenanceKcal,
  maxPaceKgWeek,
  type TargetInput,
} from './energy.js';

// PLAN.md worked example: 26, male, 177.8 cm, 70 kg, lightly active, 0.25 kg/week.
const arjun: TargetInput = {
  sex: 'male',
  weightKg: 70,
  heightCm: 177.8,
  age: 26,
  activity: 'light',
  goal: 'lose',
  paceKgWeek: 0.25,
  specialStatus: 'none',
};

describe('Mifflin-St Jeor BMR', () => {
  it('matches the worked example (≈1,686 kcal)', () => {
    expect(bmr(arjun)).toBeCloseTo(1686.25, 2);
  });

  it('uses −161 for women', () => {
    expect(bmr({ sex: 'female', weightKg: 60, heightCm: 165, age: 30 })).toBeCloseTo(600 + 1031.25 - 150 - 161, 2);
  });
});

describe('activity', () => {
  it('desk job + 3 workouts a week is lightly active', () => {
    expect(activityFromLifestyle('desk', 3)).toBe('light');
  });

  it('maps the extremes', () => {
    expect(activityFromLifestyle('desk', 0)).toBe('sedentary');
    expect(activityFromLifestyle('manual', 7)).toBe('very_active');
    expect(activityFromLifestyle('standing', 5)).toBe('active');
  });

  it('maintenance = BMR × factor (≈2,319 kcal)', () => {
    expect(maintenanceKcal(bmr(arjun), 'light')).toBeCloseTo(2318.6, 1);
  });
});

describe('pace and guardrails', () => {
  it('0.25 kg a week ≈ 275 kcal a day; 0.5 kg ≈ 550', () => {
    expect(dailyEnergyDelta(0.25)).toBeCloseTo(275, 5);
    expect(dailyEnergyDelta(0.5)).toBeCloseTo(550, 5);
  });

  it('caps pace at 1% of body weight per week', () => {
    expect(maxPaceKgWeek(70)).toBeCloseTo(0.7, 5);
    const t = computeTargets({ ...arjun, paceKgWeek: 1.2 });
    expect(t.paceCapped).toBe(true);
    expect(t.appliedPaceKgWeek).toBeCloseTo(0.7, 5);
  });

  it('never goes below the 1,500 kcal (men) / 1,200 kcal (women) floors', () => {
    expect(calorieFloor('male')).toBe(1500);
    expect(calorieFloor('female')).toBe(1200);
    const woman = computeTargets({
      sex: 'female',
      weightKg: 55,
      heightCm: 152,
      age: 45,
      activity: 'sedentary',
      goal: 'lose',
      paceKgWeek: 0.5,
      specialStatus: 'none',
    });
    expect(woman.kcal).toBe(1200);
    expect(woman.floorApplied).toBe(true);
  });

  it('pregnant, breastfeeding and under-18 profiles get maintenance only', () => {
    for (const t of [
      computeTargets({ ...arjun, sex: 'female', specialStatus: 'pregnant' }),
      computeTargets({ ...arjun, sex: 'female', specialStatus: 'breastfeeding' }),
      computeTargets({ ...arjun, age: 16 }),
    ]) {
      expect(t.maintenanceOnly).toBe(true);
      expect(t.appliedPaceKgWeek).toBe(0);
      expect(t.kcal).toBe(Math.round(t.maintenance));
    }
  });

  it('adds a surplus when gaining', () => {
    const t = computeTargets({ ...arjun, goal: 'gain' });
    expect(t.kcal).toBe(Math.round(maintenanceKcal(bmr(arjun), 'light') + 275));
  });
});

describe('worked example targets', () => {
  const t = computeTargets(arjun);
  it('calorie target ≈ 2,044 kcal', () => expect(t.kcal).toBe(2044));
  it('protein 112 g, up to 154 g', () => {
    expect(t.protein_g).toBe(112);
    expect(t.proteinHigh_g).toBe(154);
  });
  it('fat ≈ 57 g (25%)', () => expect(t.fat_g).toBe(57));
  it('carbs ≈ 271 g (the remainder)', () => expect(t.carbs_g).toBe(271));
  it('fiber ≈ 29 g', () => expect(t.fiber_g).toBe(29));
});
