import type { Sex } from '../schemas.js';

/** BMI = weight (kg) ÷ height² (m). */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function bmiCategory(value: number): string {
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Healthy';
  if (value < 30) return 'Overweight';
  return 'Obese';
}

/** Waist-to-height ratio; under 0.5 is a widely used healthy cut-off. */
export function waistToHeight(waistCm: number, heightCm: number): number {
  return waistCm / heightCm;
}

export function waistToHip(waistCm: number, hipCm: number): number {
  return waistCm / hipCm;
}

export interface NavyInput {
  sex: Sex;
  heightCm: number;
  neckCm: number | null | undefined;
  waistCm: number | null | undefined;
  hipCm?: number | null | undefined;
}

/**
 * US Navy body fat %, all measurements in cm.
 * Men:   495 / (1.0324 − 0.19077 log10(waist − neck) + 0.15456 log10(height)) − 450
 * Women: 495 / (1.29579 − 0.35004 log10(waist + hip − neck) + 0.22100 log10(height)) − 450
 * Returns null when the measurements needed are missing or impossible.
 */
export function navyBodyFat(p: NavyInput): number | null {
  const { neckCm: neck, waistCm: waist, heightCm: height } = p;
  if (!neck || !waist || !height) return null;
  let bf: number;
  if (p.sex === 'male') {
    if (waist - neck <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
  } else {
    const hip = p.hipCm;
    if (!hip || waist + hip - neck <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(height)) - 450;
  }
  if (!Number.isFinite(bf) || bf < 2 || bf > 70) return null;
  return bf;
}

export function fatMassKg(weightKg: number, bodyFatPct: number): number {
  return (weightKg * bodyFatPct) / 100;
}

export function leanMassKg(weightKg: number, bodyFatPct: number): number {
  return weightKg - fatMassKg(weightKg, bodyFatPct);
}
