import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toDateStr, type BodyLog } from '@katori/shared';
import { api } from '../api';
import { Banner, Card, ErrorNote, Field, Loading, NumberInput } from '../components/ui';
import { dayMonth, fullDate, kg, num1, pct } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';
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

function LatestCard({ logs, minor }: { logs: BodyLog[]; minor: boolean }) {
  const latestW = logs.find((l) => l.weightKg != null);
  const latestTape = logs.find((l) => l.waistCm != null);
  const latestBf = logs.find((l) => l.bodyFatPct != null);
  return (
    <Card title="Latest" testId="body-latest">
      <div className="stats">
        <div className="stat">
          <div className="label">Weight</div>
          <div className="value" data-testid="latest-weight">
            {kg(latestW?.weightKg)}
          </div>
          {latestW && <div className="note">{dayMonth(latestW.date)}</div>}
        </div>
        <div className="stat">
          <div className="label">BMI</div>
          <div className="value" data-testid="latest-bmi">
            {num1(latestW?.bmi)}
          </div>
        </div>
        {!minor && (
          <div className="stat">
            <div className="label">Body fat (Navy)</div>
            <div className="value" data-testid="latest-bf">
              {pct(latestBf?.bodyFatPct)}
            </div>
            {latestBf && <div className="note">{dayMonth(latestBf.date)}</div>}
          </div>
        )}
        <div className="stat">
          <div className="label">Waist ÷ height</div>
          <div className="value" data-testid="latest-whtr">
            {latestTape?.waistToHeight != null ? latestTape.waistToHeight.toFixed(2) : '–'}
          </div>
        </div>
        {latestTape?.waistToHip != null && (
          <div className="stat">
            <div className="label">Waist ÷ hip</div>
            <div className="value" data-testid="latest-whr">
              {latestTape.waistToHip.toFixed(2)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function Body() {
  const pid = usePid();
  const { current } = useProfiles();
  const qc = useQueryClient();
  const toast = useToast();
  const dateId = useId();
  const backfillId = useId();
  const { data: logs, error, isLoading } = useQuery({ queryKey: ['body', pid], queryFn: () => api.body(pid) });
  const { data: profile } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [weight, setWeight] = useState<number | null>(null);
  const [neck, setNeck] = useState<number | null>(null);
  const [waist, setWaist] = useState<number | null>(null);
  const [hip, setHip] = useState<number | null>(null);
  const [showHips, setShowHips] = useState(false);
  const [backfill, setBackfill] = useState('');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['body', pid] });
    void qc.invalidateQueries({ queryKey: ['dashboard', pid] });
    void qc.invalidateQueries({ queryKey: ['journey', pid] });
    void qc.invalidateQueries({ queryKey: ['targets', pid] });
    void qc.invalidateQueries({ queryKey: ['profile', pid] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveBody(pid, date, {
        ...(weight != null ? { weightKg: weight } : {}),
        ...(neck != null ? { neckCm: neck } : {}),
        ...(waist != null ? { waistCm: waist } : {}),
        ...(hip != null ? { hipCm: hip } : {}),
      }),
    onSuccess: (r) => {
      toast(r.log?.bodyFatPct != null ? `Saved · body fat ${pct(r.log.bodyFatPct)}` : 'Saved');
      setWeight(null);
      setNeck(null);
      setWaist(null);
      setHip(null);
      invalidate();
    },
  });

  const parsed = parseBackfill(backfill);
  const doBackfill = useMutation({
    mutationFn: () => api.backfill(pid, parsed.entries),
    onSuccess: (r) => {
      toast(`Backfilled ${r.saved} weigh-ins`);
      setBackfill('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (d: string) => api.deleteBody(pid, d),
    onSuccess: invalidate,
  });

  if (isLoading) return <Loading />;
  if (error || !logs) return <ErrorNote error={error} />;
  const female = profile?.sex === 'female';
  const nothing = weight == null && neck == null && waist == null && hip == null;

  return (
    <>
      <div className="page-head">
        <h1>Body</h1>
        <span className="sub">{current?.name}</span>
      </div>

      <LatestCard logs={logs} minor={current?.minor ?? false} />

      <Card title="Log" subtitle="Weight every morning; tape every 2 weeks" testId="body-form">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nothing) save.mutate();
          }}
        >
          <Field label="Date" htmlFor={dateId}>
            <input id={dateId} className="input" type="date" max={toDateStr(new Date())} value={date} onChange={(e) => setDate(e.target.value)} data-testid="body-date" />
          </Field>
          <NumberInput label="Weight" unit="kg" value={weight} onChange={setWeight} testId="body-weight" hint="Same time each morning, after the bathroom, before breakfast." />
          <div className="grid-2">
            <NumberInput label="Neck" unit="cm" value={neck} onChange={setNeck} testId="body-neck" />
            <NumberInput label="Waist" unit="cm" value={waist} onChange={setWaist} testId="body-waist" />
          </div>
          {(female || showHips) && <NumberInput label="Hips" unit="cm" value={hip} onChange={setHip} testId="body-hips" />}
          {!female && !showHips && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowHips(true)} data-testid="body-add-hips">
              + Hips (for waist-to-hip)
            </button>
          )}
          <MeasureTips />
          {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
          <button className="btn btn-primary" disabled={nothing || save.isPending} data-testid="body-save">
            Save
          </button>
        </form>
      </Card>

      <Card title="Backfill past weigh-ins" subtitle="One per line: date and weight, e.g. 2026-07-01 76.0" testId="body-backfill">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.entries.length) doBackfill.mutate();
          }}
        >
          <Field label="Weigh-ins" htmlFor={backfillId} hint={backfill.trim() ? `${parsed.entries.length} ready${parsed.bad ? `, ${parsed.bad} line(s) not understood` : ''}` : 'Paste from a notes app or spreadsheet.'}>
            <textarea id={backfillId} className="input" value={backfill} onChange={(e) => setBackfill(e.target.value)} placeholder={'2026-07-01 76.0\n2026-07-08 75.4'} data-testid="backfill-text" />
          </Field>
          <button className="btn" disabled={!parsed.entries.length || doBackfill.isPending} data-testid="backfill-save">
            Add {parsed.entries.length || ''} weigh-ins
          </button>
        </form>
      </Card>

      <Card title="History" testId="body-history">
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
      </Card>
    </>
  );
}
