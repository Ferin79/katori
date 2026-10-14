// CSV export: a human-readable copy of a profile's meals and body logs.
import type { ProfileRow } from '../ai/runner.js';
import type { DB } from '../db/client.js';
import { listBody } from './body.js';

function cell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function mealsCsv(db: DB, profile: ProfileRow, from = '0000-01-01', to = '9999-12-31'): string {
  const rows = db.$client
    .prepare(
      `SELECT m.eaten_date, substr(m.eaten_at, 12, 5) AS time, m.slot, m.id AS meal_id, m.status, m.note,
              i.name, i.portion, i.grams, i.kcal, i.protein_g, i.carbs_g, i.fat_g, i.fiber_g, i.source, i.confidence
         FROM meals m JOIN meal_items i ON i.meal_id = m.id
        WHERE m.profile_id = ? AND m.eaten_date BETWEEN ? AND ? AND m.calibration = 0
          AND m.status IN ('estimated', 'confirmed')
        ORDER BY m.eaten_at, m.id, i.position, i.id`,
    )
    .all(profile.id, from, to) as Record<string, unknown>[];
  const header = ['date', 'time', 'slot', 'meal_id', 'status', 'note', 'item', 'portion', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'source', 'confidence'];
  return toCsv(
    header,
    rows.map((r) => [r.eaten_date, r.time, r.slot, r.meal_id, r.status, r.note, r.name, r.portion, r.grams, r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.fiber_g, r.source, r.confidence]),
  );
}

export function bodyCsv(db: DB, profile: ProfileRow, today: string): string {
  const header = ['date', 'weight_kg', 'neck_cm', 'waist_cm', 'hip_cm', 'bmi', 'body_fat_pct', 'fat_mass_kg', 'lean_mass_kg', 'waist_to_height', 'waist_to_hip'];
  return toCsv(
    header,
    listBody(db, profile, today).map((b) => [b.date, b.weightKg, b.neckCm, b.waistCm, b.hipCm, b.bmi, b.bodyFatPct, b.fatMassKg, b.leanMassKg, b.waistToHeight, b.waistToHip]),
  );
}
