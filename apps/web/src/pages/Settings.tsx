import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_LABELS, type AuthState, type HouseholdSettings, type ManualTargetInput } from '@katori/shared';
import { api, setUnlockToken } from '../api';
import { AppCard } from '../components/Install';
import { Banner, Card, ErrorNote, Field, Loading, NumberInput, Segmented } from '../components/ui';
import { dayMonth, kcal } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

const AUTH_TEXT: Record<AuthState['status'], string> = {
  ok: 'Signed in',
  signed_out: 'Signed out',
  missing_credential: 'No credential yet',
  manual: 'Manual logging (no AI)',
  unknown: 'Not checked yet',
};

function TargetsSection({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: t } = useQuery({ queryKey: ['targets', pid], queryFn: () => api.targets(pid) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ManualTargetInput | null>(null);
  useEffect(() => {
    if (t?.current && !editing) setForm({ kcal: t.current.kcal, protein_g: t.current.protein_g, carbs_g: t.current.carbs_g, fat_g: t.current.fat_g, fiber_g: t.current.fiber_g });
  }, [t, editing]);
  const done = (msg: string) => {
    toast(msg);
    setEditing(false);
    void qc.invalidateQueries({ queryKey: ['targets', pid] });
    void qc.invalidateQueries({ queryKey: ['dashboard', pid] });
  };
  const save = useMutation({ mutationFn: () => api.setTargets(pid, form!), onSuccess: () => done('Targets saved') });
  const reset = useMutation({ mutationFn: () => api.recalcTargets(pid), onSuccess: () => done('Back to the calculated targets') });
  if (!t) return <Card title="Targets">…</Card>;
  const c = t.current;
  const f = t.formula;
  return (
    <Card
      title="Targets"
      subtitle={c ? `${c.source === 'formula' ? 'Calculated' : c.source === 'learned' ? 'Learned from your trend' : 'Set by hand'} · since ${dayMonth(c.effectiveFrom)}` : undefined}
      testId="settings-targets"
      actions={
        !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)} data-testid="targets-edit">
            Override
          </button>
        )
      }
    >
      {c && !editing && (
        <dl className="kv">
          <dt>Calories</dt>
          <dd data-testid="target-kcal">{kcal(c.kcal)} kcal</dd>
          <dt>Protein</dt>
          <dd data-testid="target-protein">{c.protein_g} g</dd>
          <dt>Carbs</dt>
          <dd>{c.carbs_g} g</dd>
          <dt>Fat</dt>
          <dd>{c.fat_g} g</dd>
          <dt>Fiber</dt>
          <dd>{c.fiber_g} g</dd>
        </dl>
      )}
      {editing && form && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid-2">
            <NumberInput label="Calories" unit="kcal" value={form.kcal} onChange={(v) => setForm({ ...form, kcal: Math.round(v ?? 0) })} testId="override-kcal" />
            <NumberInput label="Protein" unit="g" value={form.protein_g} onChange={(v) => setForm({ ...form, protein_g: v ?? 0 })} testId="override-protein" />
            <NumberInput label="Carbs" unit="g" value={form.carbs_g} onChange={(v) => setForm({ ...form, carbs_g: v ?? 0 })} testId="override-carbs" />
            <NumberInput label="Fat" unit="g" value={form.fat_g} onChange={(v) => setForm({ ...form, fat_g: v ?? 0 })} testId="override-fat" />
            <NumberInput label="Fiber" unit="g" value={form.fiber_g} onChange={(v) => setForm({ ...form, fiber_g: v ?? 0 })} testId="override-fiber" />
          </div>
          {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={save.isPending} data-testid="override-save">
              Save override
            </button>
          </div>
        </form>
      )}
      {f && (
        <details className="tips" style={{ marginTop: 12 }}>
          <summary>How the formula gets there</summary>
          <p className="small" style={{ marginTop: 8 }} data-testid="formula-breakdown">
            Mifflin-St Jeor resting energy {kcal(f.bmr)} kcal × activity {f.activityFactor} = maintenance {kcal(f.maintenance)} kcal.
            {f.appliedPaceKgWeek > 0 && ` Adjusted by ${kcal(f.dailyDelta)} kcal a day for ${f.appliedPaceKgWeek} kg a week (≈7,700 kcal per kg).`} Protein 1.6 g/kg (up to {f.proteinHigh_g} g if you lift), fat 25% of
            calories, carbs the rest, fiber 14 g per 1,000 kcal. Formula result: {kcal(f.kcal)} kcal. It recalculates when your weight moves 1 kg, or monthly.
          </p>
          {f.notes.map((n) => (
            <p key={n} className="small muted">
              {n}
            </p>
          ))}
        </details>
      )}
      {c && c.source !== 'formula' && (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => reset.mutate()} disabled={reset.isPending} data-testid="targets-reset">
          Use the calculated targets
        </button>
      )}
      {t.history.length > 1 && (
        <details className="tips" style={{ marginTop: 12 }}>
          <summary>History</summary>
          <table className="data">
            <tbody>
              {t.history.map((h) => (
                <tr key={h.id}>
                  <td>{dayMonth(h.effectiveFrom)}</td>
                  <td>{kcal(h.kcal)} kcal</td>
                  <td>{h.protein_g} g</td>
                  <td>{h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Card>
  );
}

function AiSection({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const { current } = useProfiles();
  const { data: s } = useQuery({ queryKey: ['aiStatus', pid], queryFn: () => api.aiStatus(pid) });
  const check = useMutation({
    mutationFn: () => api.checkAi(pid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aiStatus', pid] });
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  const access = current?.aiAccess;
  return (
    <Card title="AI access" subtitle={access === 'sign_in' ? 'Own Claude sign-in' : access === 'api_key' ? 'Claude Console API key' : 'Manual only'} testId="settings-ai">
      {s && (
        <p data-testid="ai-status">
          <span className={`badge ${s.status === 'ok' ? '' : s.status === 'manual' ? '' : 'badge-status-failed'}`}>{AUTH_TEXT[s.status]}</span> <span className="small muted">{s.message}</span>
        </p>
      )}
      {access !== 'manual' && (
        <>
          <p className="small" style={{ marginTop: 10 }}>
            {access === 'sign_in'
              ? `On ${current?.name}'s own computer, run claude setup-token with their Pro or Max plan. Then, on the home server:`
              : 'Create a key in the Claude Console, then on the home server:'}
          </p>
          <pre className="small" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10, overflowX: 'auto' }}>
            <code data-testid="ai-command">katori set-credential {pid}</code>
          </pre>
          <p className="small muted">Credentials stay in a mode-600 file on the server, never in the app or its database. Each profile uses only its own.</p>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => check.mutate()} disabled={check.isPending} data-testid="ai-check">
            {check.isPending ? 'Checking…' : 'Check now'}
          </button>
        </>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Change the access type under <Link to="/settings/profile">Edit profile</Link>.
      </p>
    </Card>
  );
}

function PinSection({ pid }: { pid: string }) {
  const { current } = useProfiles();
  const qc = useQueryClient();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const has = current?.hasPin ?? false;
  const pinId = useId();
  const curId = useId();
  const apply = useMutation({
    mutationFn: (next: string | null) => api.setPin(pid, next, has ? currentPin : undefined),
    onSuccess: (r) => {
      setUnlockToken(pid, r.token);
      toast(r.hasPin ? 'PIN set on this profile' : 'PIN removed');
      setPin('');
      setCurrentPin('');
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  return (
    <Card title="Profile PIN" subtitle={has ? 'This profile is locked with a PIN on other phones.' : 'Optional: anyone on your Wi-Fi can open any profile without one.'} testId="settings-pin">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === 4 && (!has || currentPin.length === 4)) apply.mutate(pin);
        }}
      >
        {has && (
          <Field label="Current PIN" htmlFor={curId}>
            <input id={curId} className="input" type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(e) => setCurrentPin(clean(e.target.value))} data-testid="pin-current" />
          </Field>
        )}
        <Field label={has ? 'New PIN' : '4-digit PIN'} htmlFor={pinId}>
          <input id={pinId} className="input" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(clean(e.target.value))} data-testid="pin-new" />
        </Field>
        {apply.error && <Banner tone="error">{apply.error instanceof Error ? apply.error.message : String(apply.error)}</Banner>}
        <div className="btn-row">
          <button className="btn btn-primary" disabled={pin.length !== 4 || (has && currentPin.length !== 4) || apply.isPending} data-testid="pin-set">
            {has ? 'Change PIN' : 'Set PIN'}
          </button>
          {has && (
            <button type="button" className="btn" disabled={currentPin.length !== 4 || apply.isPending} onClick={() => apply.mutate(null)} data-testid="pin-remove">
              Remove PIN
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function HouseholdSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const modelId = useId();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [s, setS] = useState<HouseholdSettings | null>(null);
  useEffect(() => {
    if (data && !s) setS(data.settings);
  }, [data, s]);
  const save = useMutation({
    mutationFn: () => api.saveSettings(s!),
    onSuccess: (v) => {
      setS(v.settings);
      toast('Household settings saved');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  if (!s || !data) return <Card title="Household">…</Card>;
  const set = (patch: Partial<HouseholdSettings>) => setS({ ...s, ...patch });
  return (
    <Card title="Household" subtitle="Shared by everyone. Weigh your katori and a roti once; estimates use these." testId="settings-household">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid-2">
          <NumberInput label="Katori (bowl)" unit="ml" value={s.katoriMl} onChange={(v) => set({ katoriMl: v ?? 150 })} testId="set-katori" />
          <NumberInput label="Typical roti" unit="g" value={s.rotiG} onChange={(v) => set({ rotiG: v ?? 35 })} testId="set-roti" />
          <NumberInput label="Ladle" unit="ml" value={s.ladleMl} onChange={(v) => set({ ladleMl: v ?? 60 })} testId="set-ladle" />
          <NumberInput label="Oil per serving" unit="ml" value={s.oilPerServingMl} onChange={(v) => set({ oilPerServingMl: v ?? 5 })} testId="set-oil" hint="1 tsp ≈ 5 ml" />
        </div>
        <Field label="Model" htmlFor={modelId} hint="Sonnet is the default; try Opus for a hard thali.">
          <select id={modelId} className="input" value={s.model} onChange={(e) => set({ model: e.target.value as HouseholdSettings['model'] })} data-testid="set-model">
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </select>
        </Field>
        <label className="toggle">
          <span>
            Ground estimates in IFCT / INDB
            <span className="small muted" style={{ display: 'block' }}>
              {data.system.reference.count ? `${data.system.reference.count.toLocaleString()} reference foods loaded` : 'Not loaded: run katori import-reference on the server'}
            </span>
          </span>
          <input type="checkbox" checked={s.referenceLookup} onChange={(e) => set({ referenceLookup: e.target.checked })} data-testid="set-reference" />
        </label>
        <NumberInput label="Calibration pass mark" unit="± %" value={s.calibrationTolerancePct} onChange={(v) => set({ calibrationTolerancePct: v ?? 15 })} testId="set-tolerance" />
        {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
        <button className="btn btn-primary" disabled={save.isPending} data-testid="household-save">
          Save household settings
        </button>
      </form>
    </Card>
  );
}

function SystemSection({ pid }: { pid: string }) {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: runs = [] } = useQuery({ queryKey: ['aiRuns'], queryFn: api.aiRuns });
  const sys = data?.system;
  return (
    <>
      <Card title="Export" subtitle="A human-readable copy; keep one each month" testId="settings-export">
        <div className="btn-row">
          <a className="btn" href={api.exportUrl(pid, 'meals')} download data-testid="export-meals">
            Meals CSV
          </a>
          <a className="btn" href={api.exportUrl(pid, 'body')} download data-testid="export-body">
            Body CSV
          </a>
        </div>
      </Card>
      <Card title="Backups" testId="settings-backups">
        {sys?.backup.configured ? (
          <p data-testid="backup-status">
            {sys.backup.ok ? '✓' : '⚠'} Last backup {sys.backup.lastAt ? new Date(sys.backup.lastAt).toLocaleString() : 'never'}
            {sys.backup.dest && <span className="small muted"> · {sys.backup.dest}</span>}
            {sys.backup.message && <span className="small delta-bad" style={{ display: 'block' }}>{sys.backup.message}</span>}
          </p>
        ) : (
          <p className="small muted" data-testid="backup-status">
            Not set up on this machine. On the home server the nightly katori-backup timer snapshots the database and photos (see deploy/README).
          </p>
        )}
      </Card>
      <Card title="System" testId="settings-system">
        {sys && (
          <dl className="kv">
            <dt>Estimates run by</dt>
            <dd data-testid="system-ai-mode">{sys.aiMode === 'fake' ? 'Fake runner (test mode)' : 'Claude Code'}</dd>
            <dt>Jobs waiting</dt>
            <dd>{sys.queue.pending}</dd>
            <dt>Reference foods</dt>
            <dd>{sys.reference.count.toLocaleString()}</dd>
            <dt>Version</dt>
            <dd>{sys.version}</dd>
          </dl>
        )}
        {runs.length > 0 && (
          <details className="tips" style={{ marginTop: 12 }}>
            <summary>Recent AI runs</summary>
            <table className="data">
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{r.profileId}</td>
                    <td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : '…'}</td>
                    <td className="small">{r.error ? '✗' : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Card>
    </>
  );
}

function DangerSection({ pid }: { pid: string }) {
  const { current } = useProfiles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmName, setConfirmName] = useState('');
  const del = useMutation({
    mutationFn: () => api.deleteProfile(pid),
    onSuccess: async () => {
      toast(`${current?.name}'s profile deleted`);
      await qc.refetchQueries({ queryKey: ['profiles'] });
      navigate('/');
    },
  });
  return (
    <Card title="Delete profile" subtitle="Deletes this person's meals, body logs, targets and saved foods. Back up first." testId="settings-danger">
      <div className="form">
        <input className="input" placeholder={`Type ${current?.name} to confirm`} aria-label="Type the profile name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} data-testid="delete-confirm" />
        <button className="btn btn-danger" disabled={confirmName !== current?.name || del.isPending} onClick={() => del.mutate()} data-testid="delete-profile">
          Delete {current?.name}
        </button>
      </div>
    </Card>
  );
}

export function Settings() {
  const pid = usePid();
  const { data: p, error, isLoading } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  const [scope, setScope] = useState<'profile' | 'household'>('profile');
  if (isLoading) return <Loading />;
  if (error || !p) return <ErrorNote error={error} />;
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <Segmented
        label="Settings scope"
        testId="settings-scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'profile', label: `${p.name}` },
          { value: 'household', label: 'Household' },
        ]}
      />
      {scope === 'profile' ? (
        <>
          <Card
            title={p.name}
            subtitle={`${p.sex === 'male' ? 'Male' : 'Female'}, ${p.age} · ${p.heightCm} cm · ${ACTIVITY_LABELS[p.activity]}`}
            testId="settings-profile"
            actions={
              <Link className="btn btn-sm" to="/settings/profile" data-testid="edit-profile">
                Edit
              </Link>
            }
          >
            <p className="small">
              Goal: {p.goal === 'maintain' ? 'maintain' : `${p.goal} ${p.paceKgWeek} kg a week`}
              {p.goalWeightKg ? ` to ${p.goalWeightKg} kg` : ''} · {p.diet.vegetarian ? `vegetarian${p.diet.eggs ? ' + eggs' : ''}` : 'non-vegetarian'} · meals: {p.mealSlots.map((s) => `${s.name} ${s.time}`).join(', ')}
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <Link className="btn btn-sm" to="/settings/foods" data-testid="link-foods">
                My foods
              </Link>
            </div>
          </Card>
          <TargetsSection pid={pid} />
          <AiSection pid={pid} />
          <PinSection pid={pid} />
          <AppCard />
          <SystemSection pid={pid} />
          <DangerSection pid={pid} />
        </>
      ) : (
        <>
          <HouseholdSection />
          <Card title="Calibration" subtitle="Weigh ~10 typical meals once, then see how far the estimates land" testId="settings-calibration">
            <Link className="btn" to="/settings/calibration" data-testid="link-calibration">
              Open calibration
            </Link>
          </Card>
        </>
      )}
    </>
  );
}
