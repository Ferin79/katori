const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const kcal = (n: number | null | undefined) => (n == null ? '–' : nf0.format(Math.round(n)));
export const num1 = (n: number | null | undefined) => (n == null ? '–' : nf1.format(n));
export const grams = (n: number | null | undefined) => (n == null ? '–' : `${nf0.format(Math.round(n))} g`);
export const kg = (n: number | null | undefined) => (n == null ? '–' : `${nf1.format(n)} kg`);
export const pct = (n: number | null | undefined) => (n == null ? '–' : `${nf1.format(n)}%`);

export function signed(n: number | null | undefined, unit = ''): string {
  if (n == null) return '–';
  const s = nf1.format(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${s}${unit}`;
}

/** Compact axis ticks: 0 / 1K / 2K. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1000) return `${nf1.format(n / 1000)}K`;
  return nf0.format(n);
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export const dayShort = (date: string) => parseDate(date).toLocaleDateString('en-US', { weekday: 'short' });
export const dayMonth = (date: string) => parseDate(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
export const fullDate = (date: string) => parseDate(date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const longDate = (date: string) => parseDate(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
export const monthName = (month: string) => parseDate(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const monthShort = (month: string) => parseDate(`${month}-01`).toLocaleDateString('en-US', { month: 'short' });

/** "18:10" → "6:10 PM" */
export function clock(localDateTime: string): string {
  const [h, m] = localDateTime.slice(11, 16).split(':').map(Number) as [number, number];
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
