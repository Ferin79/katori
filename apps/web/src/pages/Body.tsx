import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, bmiCategory, diffDays, toDateStr, type BodyLog } from '@katori/shared';
import { api } from '../api';
import { Banner, Card, ErrorNote, Field, Loading, SectionHead, ValueStepper } from '../components/ui';
import { dayMonth, dayShort, fullDate, kg, num1, pct, signed } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';
import { BodyCompCard, WaistCard, WeightCard } from './home/cards';
import { MeasureTips } from './profile-form';

/** "2026-07-01 76.0" or "2026-07-01, 76" per line. */
export function parseBackfill(text: string): { entries: { date: string; weightKg: number }[]; bad: number } {
  const entries: { date: string; weightKg: number }[] = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})[\s,;\t]+(\d+(?:\.\d+)?)/);
    if (m && Number(m[2]) >= 20 && Number(m[2]) <= 300) entries.push({ date: m[1]!, weightKg: Number(m[2]) });
    else bad++;
  }
  return { entries, bad };
}

// Same bounds as BodyLogInput on the server.
const LIMITS = { weight: [20, 300], neck: [15, 80], waist: [30, 250], hip: [30, 250] } as const;
const outOf = (v: number | null, [lo, hi]: readonly [number, number]) => v != null && (v < lo || v > hi);

/** "today", "yesterday" or "Mon, Oct 13". */
function dayLabel(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return `${dayShort(date)}, ${dayMonth(date)}`;
}

function useBodySaved(pid: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ['body', 'dashboard', 'journey', 'targets', 'profile']) void qc.invalidateQueries({ queryKey: [key, pid] });
  };
}

/** The daily weigh-in: starts at the last reading, so most days it's a tap or two and Save. */
function WeightLog({ pid, date, today, logs, goalKg }: { pid: string; date: string; today: string; logs: BodyLog[]; goalKg: number | null }) {
  const toast = useToast();
  const saved = useBodySaved(pid);
  const onDay = logs.find((l) => l.date === date)?.weightKg ?? null;
  const latest = logs.find((l) => l.weightKg != null);
  const [w, setW] = useState<number | null>(onDay ?? latest?.weightKg ?? null);
  const prev = logs.find((l) => l.weightKg != null && l.date < date);
  const bad = outOf(w, LIMITS.weight);
  const unchanged = onDay != null && w === onDay;
  const save = useMutation({
    mutationFn: () => api.saveBody(pid, date, { weightKg: w }),
    onSuccess: () => {
      toast(`Weight saved: ${kg(w)}`);
      saved();
    },
  });
  // "0 kg since last time" is only news once there's a reading for this day (saved or being typed).
  const change = w != null && !bad && prev?.weightKg != null && (onDay != null || w !== latest?.weightKg) ? w - prev.weightKg : null;
  const toGoal = w != null && !bad && goalKg != null ? w - goalKg : null;
  return (
    <section className="card log-card" data-testid="body-weight-card" aria-label="Weight">
      <div className="log-head">
        <h2>Weight</h2>
        {onDay != null ? (
          <span className="badge badge-good" data-testid="weight-saved">
            Saved {dayLabel(date, today)}
          </span>
        ) : (
          latest && (
            <span className="small muted">
              Last {kg(latest.weightKg)}, {dayLabel(latest.date, today)}
            </span>
          )
        )}
      </div>
      <ValueStepper big label="Weight" unit="kg" step={0.1} min={LIMITS.weight[0]} max={LIMITS.weight[1]} value={w} onChange={setW} testId="body-weight" />
      {(change != null || toGoal != null) && (
        <dl className="log-facts">
          {change != null && prev && (
            <div>
              <dt>Since {dayMonth(prev.date)}</dt>
              <dd className={change < 0 ? 'delta-good' : undefined}>{signed(change, ' kg')}</dd>
            </div>
          )}
          {toGoal != null && goalKg != null && (
            <div>
              <dt>
                To <Link to="/settings/profile">goal {kg(goalKg)}</Link>
              </dt>
              <dd>{Math.abs(toGoal) < 0.05 ? 'Reached' : kg(Math.abs(toGoal))}</dd>
            </div>
          )}
        </dl>
      )}
      {bad && <p className="small delta-bad">Weight should be between 20 and 300 kg.</p>}
      {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
      <button className="btn btn-primary btn-block" disabled={w == null || bad || unchanged || save.isPending} onClick={() => save.mutate()} data-testid="body-save-weight">
        {unchanged ? 'Saved' : onDay != null ? 'Update weight' : 'Save weight'}
      </button>
      <p className="small muted log-hint">Same time each morning, after the bathroom, before breakfast.</p>
    </section>
  );
}

/** Neck, waist and hips: start at the last tape reading; every two weeks is enough. */
function MeasureLog({ pid, date, today, logs, female }: { pid: string; date: string; today: string; logs: BodyLog[]; female: boolean }) {
  const toast = useToast();
  const saved = useBodySaved(pid);
  const day = logs.find((l) => l.date === date);
  const last = <K extends 'neckCm' | 'waistCm' | 'hipCm'>(k: K) => day?.[k] ?? logs.find((l) => l[k] != null)?.[k] ?? null;
  const [neck, setNeck] = useState<number | null>(last('neckCm'));
  const [waist, setWaist] = useState<number | null>(last('waistCm'));
  const [hip, setHip] = useState<number | null>(last('hipCm'));
  const [showHips, setShowHips] = useState(female || last('hipCm') != null);
  const lastTape = logs.find((l) => l.neckCm != null || l.waistCm != null);
  const daysSince = lastTape ? diffDays(lastTape.date, today) : null;
  const savedOnDay = day != null && (day.neckCm != null || day.waistCm != null || day.hipCm != null);
  const unchanged = savedOnDay && neck === day.neckCm && waist === day.waistCm && (!showHips || hip === day.hipCm);
  const bad = outOf(neck, LIMITS.neck) || outOf(waist, LIMITS.waist) || (showHips && outOf(hip, LIMITS.hip));
  const nothing = neck == null && waist == null && (!showHips || hip == null);
  const save = useMutation({
    mutationFn: () =>
      api.saveBody(pid, date, {
        ...(neck != null ? { neckCm: neck } : {}),
        ...(waist != null ? { waistCm: waist } : {}),
        ...(showHips && hip != null ? { hipCm: hip } : {}),
      }),
    onSuccess: (r) => {
      toast(r.log?.bodyFatPct != null ? `Saved, body fat ${pct(r.log.bodyFatPct)}` : 'Measurements saved');
      saved();
    },
  });
  return (
    <section className="card log-card" data-testid="body-measure-card" aria-label="Measurements">
      <div className="log-head">
        <h2>Measurements</h2>
        {savedOnDay ? (
          <span className="badge badge-good">Saved {dayLabel(date, today)}</span>
        ) : daysSince != null && daysSince > 14 ? (
          <span className="badge badge-warn" data-testid="measure-due">
            Due: last {daysSince} days ago
          </span>
        ) : (
          <span className="small muted">{lastTape ? `Last ${dayLabel(lastTape.date, today)}` : 'Every 2 weeks'}</span>
        )}
      </div>
      <div className="vstep-list">
        <ValueStepper label="Neck" unit="cm" step={0.5} min={LIMITS.neck[0]} max={LIMITS.neck[1]} value={neck} onChange={setNeck} testId="body-neck" />
        <ValueStepper label="Waist" unit="cm" step={0.5} min={LIMITS.waist[0]} max={LIMITS.waist[1]} value={waist} onChange={setWaist} testId="body-waist" />
        {showHips && <ValueStepper label="Hips" unit="cm" step={0.5} min={LIMITS.hip[0]} max={LIMITS.hip[1]} value={hip} onChange={setHip} testId="body-hips" />}
      </div>
      {!showHips && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowHips(true)} data-testid="body-add-hips">
          + Hips (for waist-to-hip)
        </button>
      )}
      {bad && <p className="small delta-bad">Check the numbers: neck 15–80 cm, waist and hips 30–250 cm.</p>}
      {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
      <button className="btn btn-primary btn-block" disabled={nothing || bad || unchanged || save.isPending} onClick={() => save.mutate()} data-testid="body-save-measures">
        {unchanged ? 'Saved' : savedOnDay ? 'Update measurements' : 'Save measurements'}
      </button>
      <MeasureTips />
    </section>
  );
}

// Adult BMI bands, drawn on a 15–35 scale. Colour is never the only cue: every band is named.
const BMI_MIN = 15;
const BMI_MAX = 35;
const BMI_BANDS = [
  { name: 'Underweight', range: 'under 18.5', colour: 'var(--bmi-under)' },
  { name: 'Healthy', range: '18.5–24.9', colour: 'var(--bmi-healthy)' },
  { name: 'Overweight', range: '25–29.9', colour: 'var(--bmi-over)' },
  { name: 'Obese', range: '30 and over', colour: 'var(--bmi-obese)' },
];
const BMI_TONE: Record<string, string> = { Underweight: 'badge-accent', Healthy: 'badge-good', Overweight: 'badge-warn', Obese: 'badge-bad' };

/** Where things stand: BMI on its scale, body fat and the waist ratios. */
function ResultsCard({ logs, minor }: { logs: BodyLog[]; minor: boolean }) {
  const bmi = logs.find((l) => l.bmi != null)?.bmi ?? null;
  const tape = logs.find((l) => l.waistCm != null);
  const bf = logs.find((l) => l.bodyFatPct != null);
  if (bmi == null && !tape) return null;
  const category = bmi != null ? bmiCategory(bmi) : null;
  const at = bmi != null ? ((Math.min(BMI_MAX, Math.max(BMI_MIN, bmi)) - BMI_MIN) / (BMI_MAX - BMI_MIN)) * 100 : 0;
  return (
    <Card title="Your numbers" testId="body-latest">
      {bmi != null && !minor && category && (
        <div className="bmi" data-testid="body-bmi">
          <div className="bmi-head">
            <span className="v" data-testid="latest-bmi">
              {num1(bmi)}
            </span>
            <span className="says">
              BMI: your weight is
              <span className={`badge ${BMI_TONE[category] ?? ''}`} data-testid="bmi-category">
                {category}
              </span>
            </span>
          </div>
          <div className="bmi-scale" role="img" aria-label={`BMI ${num1(bmi)} on a scale from ${BMI_MIN} to ${BMI_MAX}: ${category}`}>
            <div className="bmi-bar" />
            <span className="bmi-marker" style={{ left: `${at}%` }} />
          </div>
          <div className="bmi-legend">
            {BMI_BANDS.map((b) => (
              <span className="k" key={b.name}>
                <i style={{ background: b.colour }} />
                {b.name} <span className="muted">{b.range}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="stats" style={{ marginTop: bmi != null && !minor ? 18 : 0 }}>
        {minor && (
          <div className="stat">
            <div className="label">BMI</div>
            <div className="value" data-testid="latest-bmi">
              {num1(bmi)}
            </div>
          </div>
        )}
        {!minor && (
          <div className="stat">
            <div className="label">Body fat (Navy)</div>
            <div className="value" data-testid="latest-bf">
              {pct(bf?.bodyFatPct)}
            </div>
            {bf && <div className="note">{dayMonth(bf.date)}</div>}
          </div>
        )}
        <div className="stat">
          <div className="label">Waist ÷ height</div>
          <div className="value" data-testid="latest-whtr">
            {tape?.waistToHeight != null ? tape.waistToHeight.toFixed(2) : '–'}
          </div>
          {tape?.waistToHeight != null && <div className="note">{tape.waistToHeight < 0.5 ? 'under 0.5' : 'aim for under 0.5'}</div>}
        </div>
        {tape?.waistToHip != null && (
          <div className="stat">
            <div className="label">Waist ÷ hip</div>
            <div className="value" data-testid="latest-whr">
              {tape.waistToHip.toFixed(2)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Backfill({ pid }: { pid: string }) {
  const toast = useToast();
  const saved = useBodySaved(pid);
  const id = useId();
  const [text, setText] = useState('');
  const parsed = parseBackfill(text);
  const save = useMutation({
    mutationFn: () => api.backfill(pid, parsed.entries),
    onSuccess: (r) => {
      toast(`Backfilled ${r.saved} weigh-ins`);
      setText('');
      saved();
    },
  });
  return (
    <details className="card disclosure" data-testid="body-backfill">
      <summary data-testid="body-backfill-toggle">Add past weigh-ins</summary>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.entries.length) save.mutate();
        }}
      >
        <Field label="One per line: date and weight" htmlFor={id} hint={text.trim() ? `${parsed.entries.length} ready${parsed.bad ? `, ${parsed.bad} line(s) not understood` : ''}` : 'Paste from a notes app or spreadsheet, e.g. 2026-07-01 76.0'}>
          <textarea id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={'2026-07-01 76.0\n2026-07-08 75.4'} data-testid="backfill-text" />
        </Field>
        <button className="btn" disabled={!parsed.entries.length || save.isPending} data-testid="backfill-save">
          Add {parsed.entries.length || ''} weigh-ins
        </button>
      </form>
    </details>
  );
}

function History({ pid, logs }: { pid: string; logs: BodyLog[] }) {
  const saved = useBodySaved(pid);
  const remove = useMutation({ mutationFn: (d: string) => api.deleteBody(pid, d), onSuccess: saved });
  return (
    <details className="card disclosure" data-testid="body-history">
      <summary>
        History <span className="muted">{logs.length ? `${logs.length} days` : 'empty'}</span>
      </summary>
      {logs.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <div className="table-scroll" style={{ maxHeight: 360 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Weight</th>
                <th>Waist</th>
                <th>Body fat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 120).map((l) => (
                <tr key={l.date} data-testid={`body-row-${l.date}`}>
                  <td title={fullDate(l.date)}>{dayMonth(l.date)}</td>
                  <td>{l.weightKg != null ? num1(l.weightKg) : '–'}</td>
                  <td>{l.waistCm != null ? num1(l.waistCm) : '–'}</td>
                  <td>{l.bodyFatPct != null ? pct(l.bodyFatPct) : '–'}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" aria-label={`Delete ${l.date}`} onClick={() => window.confirm(`Delete the entry for ${l.date}?`) && remove.mutate(l.date)} data-testid={`body-delete-${l.date}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export function Body() {
  const pid = usePid();
  const { current } = useProfiles();
  const dateId = useId();
  const today = toDateStr(new Date());
  const [date, setDate] = useState(today);
  const [picking, setPicking] = useState(false);
  const { data: logs, error, isLoading } = useQuery({ queryKey: ['body', pid], queryFn: () => api.body(pid) });
  const { data: profile } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  const { data: d } = useQuery({ queryKey: ['dashboard', pid], queryFn: () => api.dashboard(pid) });

  if (isLoading) return <Loading />;
  if (error || !logs) return <ErrorNote error={error} />;
  const minor = current?.minor ?? false;
  const day = logs.find((l) => l.date === date);
  // Remount each log card when its own saved values for the day change, so it starts from the right
  // numbers without wiping what you're typing in the other card.
  const weightKey = `${pid}:${date}:${day?.weightKg ?? ''}`;
  const tapeKey = `${pid}:${date}:${day?.neckCm ?? ''}:${day?.waistCm ?? ''}:${day?.hipCm ?? ''}`;

  return (
    <>
      <div className="page-head">
        <h1>Body</h1>
        <button type="button" className={`date-pill${date !== today ? ' set' : ''}`} aria-expanded={picking} onClick={() => setPicking((v) => !v)} data-testid="body-date-toggle">
          {date === today ? 'Today' : `${dayShort(date)}, ${dayMonth(date)}`}
          <span aria-hidden>▾</span>
        </button>
      </div>
      {picking && (
        <div className="card date-card">
          <Field label="Log for" htmlFor={dateId}>
            <input id={dateId} className="input" type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="body-date" />
          </Field>
          {date !== today && (
            <button type="button" className="btn btn-sm" onClick={() => setDate(today)} data-testid="body-date-today">
              Back to today
            </button>
          )}
        </div>
      )}

      <WeightLog key={weightKey} pid={pid} date={date} today={today} logs={logs} goalKg={minor ? null : (profile?.goalWeightKg ?? null)} />
      <MeasureLog key={tapeKey} pid={pid} date={date} today={today} logs={logs} female={profile?.sex === 'female'} />
      <ResultsCard logs={logs} minor={minor} />

      {d && (
        <>
          <SectionHead title="Trends" />
          <div className="group">
            <WeightCard d={d} />
            <BodyCompCard d={d} />
            <WaistCard d={d} />
          </div>
        </>
      )}

      <History pid={pid} logs={logs} />
      <Backfill pid={pid} />
    </>
  );
}
