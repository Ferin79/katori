import { describe, expect, it } from 'vitest';
import { bmi, bmiCategory, fatMassKg, leanMassKg, navyBodyFat, waistToHeight, waistToHip } from './body.js';

describe('BMI and ratios', () => {
  it('BMI = kg / m²', () => {
    expect(bmi(70, 177.8)).toBeCloseTo(22.14, 2);
    expect(bmiCategory(22.1)).toBe('Healthy');
    expect(bmiCategory(27)).toBe('Overweight');
  });

  it('waist-to-height and waist-to-hip', () => {
    expect(waistToHeight(85, 177.8)).toBeCloseTo(0.478, 3);
    expect(waistToHip(75, 98)).toBeCloseTo(0.765, 3);
  });
});

describe('US Navy body fat', () => {
  it('men: 177.8 cm, neck 38, waist 85 → ≈16.5%', () => {
    expect(navyBodyFat({ sex: 'male', heightCm: 177.8, neckCm: 38, waistCm: 85 })).toBeCloseTo(16.47, 1);
  });

  it('women: 165 cm, neck 32, waist 75, hip 98 → ≈28.9%', () => {
    expect(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 75, hipCm: 98 })).toBeCloseTo(28.94, 1);
  });

  it('returns null when measurements are missing or impossible', () => {
    expect(navyBodyFat({ sex: 'male', heightCm: 177.8, neckCm: null, waistCm: 85 })).toBeNull();
    expect(navyBodyFat({ sex: 'male', heightCm: 177.8, neckCm: 90, waistCm: 85 })).toBeNull();
    expect(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 75 })).toBeNull();
  });

  it('fat mass + lean mass = weight', () => {
    expect(fatMassKg(70, 20)).toBeCloseTo(14, 5);
    expect(leanMassKg(70, 20)).toBeCloseTo(56, 5);
  });
});
