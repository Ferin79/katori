import { useEffect, useState, type ReactNode } from 'react';

/** 0 on first paint, then the real value, so meters sweep in once instead of popping. */
function useSweep(frac: number) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(frac));
    return () => cancelAnimationFrame(id);
  }, [frac]);
  return shown;
}

// A 240° arc open at the bottom: from 150° round the top to 30° (SVG angles run clockwise).
const CX = 100;
const CY = 100;
const R = 84;
const at = (deg: number) => [CX + R * Math.cos((deg * Math.PI) / 180), CY + R * Math.sin((deg * Math.PI) / 180)] as const;
const [SX, SY] = at(150);
const [EX, EY] = at(30);
const ARC = `M ${SX.toFixed(2)} ${SY.toFixed(2)} A ${R} ${R} 0 1 1 ${EX.toFixed(2)} ${EY.toFixed(2)}`;

/** The daily goal: an ink arc that fills towards the calorie target, red once over it. */
export function ArcGauge({ value, target, label, children, testId }: { value: number; target: number | null; label: string; children: ReactNode; testId?: string }) {
  const over = target != null && value > target;
  const frac = target ? Math.min(1, value / target) : 0;
  const shown = useSweep(frac);
  return (
    <div className="gauge" data-testid={testId}>
      <svg viewBox="0 4 200 156" role="img" aria-label={label}>
        <path d={ARC} fill="none" stroke="var(--s-kcal-track)" strokeWidth="16" strokeLinecap="round" />
        <path
          className="arc-fill"
          d={ARC}
          fill="none"
          stroke={over ? 'var(--critical)' : 'var(--s-kcal)'}
          strokeWidth="16"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${shown * 100} 100`}
          opacity={shown > 0 ? 1 : 0}
        />
      </svg>
      <div className="gauge-center">{children}</div>
    </div>
  );
}

/** A small ring in a macro's colour on its lighter track. */
export function MiniRing({ frac, colour, track, over }: { frac: number; colour: string; track: string; over?: boolean }) {
  const shown = useSweep(Math.min(1, Math.max(0, frac)));
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg className="mini-ring" viewBox="0 0 42 42" aria-hidden>
      <circle cx="21" cy="21" r={r} fill="none" stroke={track} strokeWidth="5" />
      <circle
        className="fill"
        cx="21"
        cy="21"
        r={r}
        fill="none"
        stroke={over ? 'var(--critical)' : colour}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${shown * c} ${c}`}
        transform="rotate(-90 21 21)"
        opacity={shown > 0 ? 1 : 0}
      />
    </svg>
  );
}
