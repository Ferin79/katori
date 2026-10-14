// Shared chart chrome: recessive hairline axes and grid, value-first tooltips with line keys,
// and legends that mirror the marks (rect for bars, line for lines, dot for points).
import type { ReactNode } from 'react';

export const C = {
  kcal: 'var(--s-kcal)',
  kcalTrack: 'var(--s-kcal-track)',
  protein: 'var(--s-protein)',
  proteinTrack: 'var(--s-protein-track)',
  carbs: 'var(--s-carbs)',
  fat: 'var(--s-fat)',
  fiber: 'var(--s-fiber)',
  weight: 'var(--s-weight)',
  waist: 'var(--s-waist)',
  bf: 'var(--s-bf)',
  neutral: 'var(--s-neutral)',
  ink2: 'var(--ink-2)',
  muted: 'var(--muted)',
  grid: 'var(--grid)',
  axis: 'var(--axis)',
  surface: 'var(--surface)',
};

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.muted, fontSize: 11 },
  tickLine: false,
} as const;

export const gridProps = { stroke: C.grid, strokeDasharray: undefined, vertical: false } as const;

export interface TipRow {
  label: string;
  value: string;
  colour: string;
}

export function Tip({ head, rows }: { head: ReactNode; rows: TipRow[] }) {
  return (
    <div className="tooltip">
      <div className="t-head">{head}</div>
      {rows.map((r) => (
        <div className="t-row" key={r.label}>
          <span className="line-key" style={{ background: r.colour }} />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; colour: string; kind: 'line' | 'rect' | 'dot' }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="k" key={i.label}>
          <span className={`${i.kind}-key`} style={{ background: i.colour }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Minimal shape of what Recharts passes to a custom tooltip. */
export interface TipProps<T> {
  active?: boolean;
  payload?: readonly { payload?: T }[];
}

/** The hovered datum, when the tooltip is active. */
export const first = <T,>(p: TipProps<T>): T | undefined => (p.active ? p.payload?.[0]?.payload : undefined);

/** Clean y-axis ticks from 0: steps of 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceTicks(max: number, count = 4): number[] {
  const raw = Math.max(1, max) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export const dayMs = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
};
export const msToDate = (ms: number) => {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
};
