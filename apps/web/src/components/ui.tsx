import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertIcon, InfoIcon, TableIcon, XIcon } from './Icons';

export function Card({ title, subtitle, actions, children, testId }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="card" data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A chart card with a table-view twin, so no value is only reachable by hover. */
export function ChartCard({
  title,
  subtitle,
  testId,
  table,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  testId: string;
  table: { head: string[]; rows: (string | number)[][] } | null;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      testId={testId}
      actions={
        table && (
          <button className="btn btn-ghost btn-sm" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)} data-testid={`${testId}-table-toggle`} aria-label={`${showTable ? 'Hide' : 'Show'} table for ${title}`}>
            <TableIcon />
          </button>
        )
      }
    >
      {children}
      {showTable && table && (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function Banner({ tone, title, children, testId, action }: { tone: 'warn' | 'error' | 'info'; title?: string; children?: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'info' ? 'status' : 'alert'} data-testid={testId}>
      {tone === 'info' ? <InfoIcon /> : <AlertIcon />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" data-testid="sheet-close">
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Number input that keeps a string while typing and reports a number (or null when blank). */
export function NumberInput({
  value,
  onChange,
  unit,
  label,
  testId,
  step = 'any',
  min,
  max,
  placeholder,
  hint,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string;
  label: string;
  testId: string;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    const parsed = text === '' ? null : Number(text);
    if (parsed !== value) setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="input-unit">
        <input
          id={id}
          className="input"
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          value={text}
          data-testid={testId}
          onChange={(e) => {
            setText(e.target.value);
            const n = e.target.value === '' ? null : Number(e.target.value);
            onChange(n != null && Number.isFinite(n) ? n : null);
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </Field>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testId: string }) {
  return (
    <div className="seg" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testId}-${o.value}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, step = 0.25, min = 0.25, max = 5, label, testId }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string; testId: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="stepper" role="group" aria-label={label} data-testid={testId}>
      <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(clamp(value - step))} data-testid={`${testId}-minus`}>
        −
      </button>
      <output aria-live="polite" data-testid={`${testId}-value`}>
        {value}×
      </output>
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(clamp(value + step))} data-testid={`${testId}-plus`}>
        +
      </button>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="progressbar" aria-label={label} />;
}

export function Loading() {
  return (
    <div className="empty">
      <Spinner />
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <Banner tone="error" title="Couldn't load this">{error instanceof Error ? error.message : String(error)}</Banner>;
}
