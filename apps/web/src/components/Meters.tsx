import { grams, kcal } from '../lib/format';

/** A ring meter: the fill is the series colour, the track a lighter step of the same ramp. */
export function Ring({ value, target, colour, track, label, sub, testId }: { value: number; target: number | null; colour: string; track: string; label: string; sub: string; testId: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = target ? Math.min(1, value / target) : 0;
  const over = target != null && value > target;
  return (
    <div className="ring-wrap" data-testid={testId} role="img" aria-label={`${label}: ${sub}`}>
      <svg viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} fill="none" stroke={track} strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke={over ? 'var(--critical)' : colour}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${frac * c} ${c}`}
        />
      </svg>
      <div className="ring-center">
        <div className="v">{label}</div>
        <div className="l">{sub}</div>
      </div>
    </div>
  );
}

export interface MacroRow {
  key: string;
  name: string;
  value: number;
  target: number | null;
  colour: string;
  unit?: 'g' | 'kcal';
}

/** Horizontal bars against targets, every bar labelled with its value (relief for light hues). */
export function MacroBars({ rows, testId }: { rows: MacroRow[]; testId: string }) {
  return (
    <div className="bar-rows" data-testid={testId}>
      {rows.map((r) => {
        const frac = r.target ? Math.min(1, r.value / r.target) : 0;
        const fmt = r.unit === 'kcal' ? kcal : grams;
        return (
          <div className="bar-row" key={r.key} data-testid={`${testId}-${r.key}`}>
            <div className="top">
              <span className="key">
                <span className="swatch" style={{ background: r.colour }} />
                {r.name}
              </span>
              <span className="val">
                {fmt(r.value)}
                {r.target != null && <span className="muted"> / {fmt(r.target)}</span>}
              </span>
            </div>
            <div className="bar-track" role="meter" aria-label={r.name} aria-valuemin={0} aria-valuemax={r.target ?? undefined} aria-valuenow={Math.round(r.value)}>
              <div className="bar-fill" style={{ width: `${frac * 100}%`, background: r.colour }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
