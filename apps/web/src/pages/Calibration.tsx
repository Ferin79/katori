import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ImageIcon } from '../components/Icons';
import { Banner, Card, ErrorNote, Field, Loading, NumberInput } from '../components/ui';
import { kcal, signed } from '../lib/format';
import { resizePhoto } from '../lib/image';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

export function Calibration() {
  const pid = usePid();
  const { current } = useProfiles();
  const qc = useQueryClient();
  const toast = useToast();
  const noteId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: v, error, isLoading } = useQuery({
    queryKey: ['calibration'],
    queryFn: api.calibration,
    refetchInterval: (q) => (q.state.data?.rows.some((r) => r.status === 'pending') ? 2000 : false),
  });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [note, setNote] = useState('');
  const [trueKcal, setTrueKcal] = useState<number | null>(null);
  const [trueProtein, setTrueProtein] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: () => api.addCalibration(pid, { note, trueKcal: trueKcal!, trueProteinG: trueProtein }, photo),
    onSuccess: () => {
      toast('Calibration meal queued');
      setPhoto(null);
      setNote('');
      setTrueKcal(null);
      setTrueProtein(null);
      void qc.invalidateQueries({ queryKey: ['calibration'] });
    },
  });
  const rerun = useMutation({
    mutationFn: api.rerunCalibration,
    onSuccess: (r) => {
      toast(`Re-running ${r.queued} meals`);
      void qc.invalidateQueries({ queryKey: ['calibration'] });
    },
  });

  if (isLoading) return <Loading />;
  if (error || !v) return <ErrorNote error={error} />;
  const s = v.summary;

  return (
    <>
      <div className="page-head">
        <h1>Calibration</h1>
      </div>
      <p className="small muted">
        Weigh about 10 typical meals, work out their true calories from labels and the tables, then run the same photos and notes here. Tune the prompt until most land within ±{v.tolerancePct}%. Calibration meals never count toward
        anyone's totals.
      </p>

      <Card title="Result" testId="calibration-summary">
        <div className="stats">
          <div className="stat">
            <div className="label">Within ±{v.tolerancePct}%</div>
            <div className="value" data-testid="calibration-within">
              {s.within} of {s.scored}
            </div>
          </div>
          <div className="stat">
            <div className="label">Mean abs. error</div>
            <div className="value">{s.meanAbsErrorPct != null ? `${s.meanAbsErrorPct}%` : '–'}</div>
          </div>
          <div className="stat">
            <div className="label">Bias</div>
            <div className="value">{s.meanErrorPct != null ? signed(s.meanErrorPct, '%') : '–'}</div>
            <div className="note">{s.meanErrorPct != null ? (s.meanErrorPct > 0 ? 'estimates run high' : 'estimates run low') : ''}</div>
          </div>
        </div>
        {s.meals > 0 && (
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => rerun.mutate()} disabled={rerun.isPending} data-testid="calibration-rerun">
            Re-run all after tuning the prompt
          </button>
        )}
      </Card>

      <Card title="Add a weighed meal" subtitle={`Runs with ${current?.name}'s AI access`} testId="calibration-form">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (trueKcal) add.mutate();
          }}
        >
          <div className="row">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} data-testid="calibration-photo">
              <ImageIcon /> {photo ? 'Photo ready ✓' : 'Add photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="calibration-photo-input"
              aria-label="Calibration photo"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await resizePhoto(f));
              }}
            />
          </div>
          <Field label="Note" htmlFor={noteId}>
            <input id={noteId} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 rotis, 1 katori dal, 1 tsp ghee" data-testid="calibration-note" />
          </Field>
          <div className="grid-2">
            <NumberInput label="True calories" unit="kcal" value={trueKcal} onChange={setTrueKcal} testId="calibration-true-kcal" />
            <NumberInput label="True protein (optional)" unit="g" value={trueProtein} onChange={setTrueProtein} testId="calibration-true-protein" />
          </div>
          {add.error && <Banner tone="error">{add.error instanceof Error ? add.error.message : String(add.error)}</Banner>}
          <button className="btn btn-primary" disabled={!trueKcal || (!photo && !note.trim()) || add.isPending} data-testid="calibration-add">
            Run estimate
          </button>
        </form>
      </Card>

      <Card title="Meals" testId="calibration-rows">
        {v.rows.length === 0 ? (
          <p className="muted">No calibration meals yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Meal</th>
                <th>True</th>
                <th>AI</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.mealId} data-testid={`calibration-row-${r.mealId}`}>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note}>
                    {r.note || `Meal ${r.mealId}`}
                    <span className="muted small" style={{ display: 'block' }}>
                      {r.profileName}
                    </span>
                  </td>
                  <td>{kcal(r.trueKcal)}</td>
                  <td>{r.status === 'pending' ? '…' : kcal(r.estimatedKcal)}</td>
                  <td className={r.withinTolerance == null ? '' : r.withinTolerance ? 'delta-good' : 'delta-bad'}>{r.errorPct != null ? `${signed(r.errorPct, '%')} ${r.withinTolerance ? '✓' : '✗'}` : r.status === 'failed' ? 'failed' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
