import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_LABELS, type AuthState, type HouseholdSettings, type ManualTargetInput, type Profile } from '@katori/shared';
import { api, setUnlockToken } from '../api';
import { ChevronRight } from '../components/Icons';
import { AppCard } from '../components/Install';
import { Banner, Card, ErrorNote, Field, Loading, MiniStats, NumberInput, Segmented } from '../components/ui';
import { dayMonth, initials, kcal } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

const AUTH_TEXT: Record<AuthState['status'], string> = {
  ok: 'Signed in',
  signed_out: 'Signed out',
  missing_credential: 'No credential yet',
  manual: 'Manual only',
  unknown: 'Not checked yet',
};
const AUTH_TONE: Record<AuthState['status'], string> = { ok: 'badge-good', signed_out: 'badge-bad', missing_credential: 'badge-bad', manual: '', unknown: '' };

/** One settings row: a label (and note) on the left, its value on the right; a link when `to` is set. */
function Row({ label, note, children, to, testId }: { label: string; note?: ReactNode; children?: ReactNode; to?: string; testId?: string }) {
  const inner = (
    <>
      <span className="srow-label">
        {label}
        {note && <span className="srow-note">{note}</span>}
      </span>
      {children != null && <span className="srow-value">{children}</span>}
      {to && <ChevronRight width={16} height={16} className="icon srow-go" />}
    </>
  );
  return to ? (
    <Link className="srow" to={to} data-testid={testId}>
      {inner}
    </Link>
  ) : (
    <div className="srow" data-testid={testId}>
      {inner}
    </div>
  );
}

function ProfileHero({ p }: { p: Profile }) {
  return (
    <section className="card profile-hero" aria-label={p.name} data-testid="settings-profile">
      <span className="avatar-lg" style={{ ['--chip-colour' as string]: p.colour }} aria-hidden>
        {initials(p.name)}
      </span>
      <div className="who">
        <h2>{p.name}</h2>
        <p className="small muted">
          {p.sex === 'male' ? 'Male' : 'Female'}, {p.age} years, {p.heightCm} cm
        </p>
        <p className="small muted">{ACTIVITY_LABELS[p.activity]}</p>
      </div>
      <Link className="btn btn-sm btn-primary" to="/settings/profile" data-testid="edit-profile">
        Edit
      </Link>
    </section>
  );
}

/** Goal, diet and meal times at a glance; each opens the profile editor. Saved foods have their own page. */
function PlanCard({ pid, p }: { pid: string; p: Profile }) {
  const { data: foods } = useQuery({ queryKey: ['foods', pid], queryFn: () => api.foods(pid) });
  const goal = p.goal === 'maintain' ? 'Maintain' : `${p.goal === 'lose' ? 'Lose' : 'Gain'} ${p.paceKgWeek} kg a week`;
  return (
    <section className="card rows-card" aria-label="Your plan" data-testid="settings-plan">
      <h2 className="rows-title">Your plan</h2>
      <Row label="Goal" to="/settings/profile" testId="plan-goal">
        <span className="srow-lines">
          <span>{goal}</span>
          {p.goalWeightKg ? <span className="muted">to {p.goalWeightKg} kg</span> : null}
        </span>
      </Row>
      <Row label="Diet" to="/settings/profile" testId="plan-diet">
        {p.diet.vegetarian ? `Vegetarian${p.diet.eggs ? ', eggs' : ''}` : 'Non-vegetarian'}
      </Row>
      <Row label="Meal times" to="/settings/profile" testId="plan-meals">
        <span className="srow-lines">
          {p.mealSlots.map((s) => (
            <span key={s.name}>
              {s.name} <span className="muted">{s.time}</span>
            </span>
          ))}
        </span>
      </Row>
      <Row label="My foods" note="Logged in one tap from Add meal" to="/settings/foods" testId="link-foods">
        {foods ? `${foods.length} saved` : null}
      </Row>
    </section>
  );
}

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
  if (!t) return <Card title="Daily targets">…</Card>;
  const c = t.current;
  const f = t.formula;
  const source = c ? (c.source === 'formula' ? 'Calculated' : c.source === 'learned' ? 'Learned from your trend' : 'Set by hand') : null;
  return (
    <Card
      title="Daily targets"
      subtitle={c && source ? `${source} since ${dayMonth(c.effectiveFrom)}` : undefined}
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
        <>
          <div className="avg-hero">
            <span className="v" data-testid="target-kcal">
              {kcal(c.kcal)}
              <span className="u"> kcal</span>
            </span>
            <span className="u">a day</span>
          </div>
          <MiniStats
            testId="target-macros"
            items={[
              { k: 'Protein', v: c.protein_g, u: 'g', testId: 'target-protein' },
              { k: 'Carbs', v: c.carbs_g, u: 'g' },
              { k: 'Fat', v: c.fat_g, u: 'g' },
              { k: 'Fiber', v: c.fiber_g, u: 'g' },
            ]}
          />
        </>
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
      {c && c.source !== 'formula' && !editing && (
        <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => reset.mutate()} disabled={reset.isPending} data-testid="targets-reset">
          Use the calculated targets
        </button>
      )}
      <div className="card-more">
        {f && (
          <details className="tips">
            <summary>How it's calculated</summary>
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
        {t.history.length > 1 && (
          <details className="tips">
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
      </div>
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
  const ok = s?.status === 'ok' || s?.status === 'manual';
  return (
    <Card
      title="AI access"
      subtitle={access === 'sign_in' ? 'Own Claude sign-in' : access === 'api_key' ? 'Claude Console API key' : 'Manual only: no AI'}
      testId="settings-ai"
      actions={
        s && (
          <span className={`badge ${AUTH_TONE[s.status]}`} data-testid="ai-status">
            {AUTH_TEXT[s.status]}
          </span>
        )
      }
    >
      {s?.message && !ok && <p className="small muted">{s.message}</p>}
      {access !== 'manual' && (
        <>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => check.mutate()} disabled={check.isPending} data-testid="ai-check">
            {check.isPending ? 'Checking…' : 'Check now'}
          </button>
          {/* The setup steps matter only until the sign-in works, so they open by themselves when it doesn't. */}
          <div className="card-more">
            <details className="tips" open={s != null && !ok}>
              <summary>How to set up the sign-in</summary>
              <p className="small" style={{ marginTop: 8 }}>
                {access === 'sign_in'
                  ? `On ${current?.name}'s own computer, run claude setup-token with their Pro or Max plan. Then, on the home server:`
                  : 'Create a key in the Claude Console, then on the home server:'}
              </p>
              <pre className="small code-block">
                <code data-testid="ai-command">katori set-credential {pid}</code>
              </pre>
              <p className="small muted">
                Credentials stay in a mode-600 file on the server, never in the app or its database. Change the access type under <Link to="/settings/profile">Edit profile</Link>.
              </p>
            </details>
          </div>
        </>
      )}
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
  const [open, setOpen] = useState(false);
  const pinId = useId();
  const curId = useId();
  const apply = useMutation({
    mutationFn: (next: string | null) => api.setPin(pid, next, has ? currentPin : undefined),
    onSuccess: (r) => {
      setUnlockToken(pid, r.token);
      toast(r.hasPin ? 'PIN set on this profile' : 'PIN removed');
      setPin('');
      setCurrentPin('');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  const ready = pin.length === 4 && (!has || currentPin.length === 4);
  return (
    <Card
      title="Profile PIN"
      subtitle={has ? 'Other phones need the PIN to open this profile.' : 'Anyone on your Wi-Fi can open this profile.'}
      testId="settings-pin"
      actions={<span className={`badge ${has ? 'badge-good' : ''}`}>{has ? 'On' : 'Off'}</span>}
    >
      {has && !open ? (
        <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setOpen(true)} data-testid="pin-change">
          Change or remove
        </button>
      ) : (
        <form
          className="form"
          style={{ marginTop: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) apply.mutate(pin);
          }}
        >
          {has && (
            <Field label="Current PIN" htmlFor={curId}>
              <input id={curId} className="input" type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(e) => setCurrentPin(clean(e.target.value))} data-testid="pin-current" />
            </Field>
          )}
          <div className="inline-form">
            <Field label={has ? 'New PIN' : '4-digit PIN'} htmlFor={pinId}>
              <input id={pinId} className="input" type="password" inputMode="numeric" autoComplete="new-password" placeholder="••••" value={pin} onChange={(e) => setPin(clean(e.target.value))} data-testid="pin-new" />
            </Field>
            <button className="btn btn-primary" disabled={!ready || apply.isPending} data-testid="pin-set">
              {has ? 'Change' : 'Set PIN'}
            </button>
          </div>
          {apply.error && <Banner tone="error">{apply.error instanceof Error ? apply.error.message : String(apply.error)}</Banner>}
          {has && (
            <div className="btn-row">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={currentPin.length !== 4 || apply.isPending} onClick={() => apply.mutate(null)} data-testid="pin-remove">
                Remove PIN
              </button>
            </div>
          )}
        </form>
      )}
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
  if (!s || !data) return <Card title="Kitchen measures">…</Card>;
  const set = (patch: Partial<HouseholdSettings>) => setS({ ...s, ...patch });
  return (
    <Card title="Kitchen measures" subtitle="Shared by everyone. Weigh your katori and a roti once; the estimates use them." testId="settings-household">
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
        <details className="tips" data-testid="set-ai-options">
          <summary>AI options</summary>
          <div className="form" style={{ marginTop: 12 }}>
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
          </div>
        </details>
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
      <section className="sub-section" aria-label="Export" data-testid="settings-export">
        <h3>Export</h3>
        <p className="small muted">A spreadsheet copy of this profile; keep one each month.</p>
        <div className="btn-row">
          <a className="btn" href={api.exportUrl(pid, 'meals')} download data-testid="export-meals">
            Meals CSV
          </a>
          <a className="btn" href={api.exportUrl(pid, 'body')} download data-testid="export-body">
            Body CSV
          </a>
        </div>
      </section>
      <section className="sub-section" aria-label="Backups" data-testid="settings-backups">
        <h3>Backups</h3>
        {sys?.backup.configured ? (
          <p className="small" data-testid="backup-status">
            {sys.backup.ok ? '✓' : '⚠'} Last backup {sys.backup.lastAt ? new Date(sys.backup.lastAt).toLocaleString() : 'never'}
            {sys.backup.dest && <span className="muted" style={{ display: 'block' }}>{sys.backup.dest}</span>}
            {sys.backup.message && <span className="delta-bad" style={{ display: 'block' }}>{sys.backup.message}</span>}
          </p>
        ) : (
          <p className="small muted" data-testid="backup-status">
            Not set up on this machine. On the home server the nightly katori-backup timer snapshots the database and photos (see deploy/README).
          </p>
        )}
      </section>
      <section className="sub-section" aria-label="System" data-testid="settings-system">
        <h3>System</h3>
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
      </section>
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
    <section className="sub-section" aria-label="Delete profile" data-testid="settings-danger">
      <h3>Delete profile</h3>
      <p className="small muted">Deletes this person's meals, body logs, targets and saved foods. Export first.</p>
      <div className="form" style={{ marginTop: 10 }}>
        <input className="input" placeholder={`Type ${current?.name} to confirm`} aria-label="Type the profile name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} data-testid="delete-confirm" />
        <button className="btn btn-danger" disabled={confirmName !== current?.name || del.isPending} onClick={() => del.mutate()} data-testid="delete-profile">
          Delete {current?.name}
        </button>
      </div>
    </section>
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
        label="Settings for"
        testId="settings-scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'profile', label: p.name },
          { value: 'household', label: 'Household' },
        ]}
      />
      {scope === 'profile' ? (
        <>
          <ProfileHero p={p} />
          <TargetsSection pid={pid} />
          <PlanCard pid={pid} p={p} />
          <AiSection pid={pid} />
          <PinSection pid={pid} />
          <AppCard />
          <details className="card disclosure" data-testid="settings-more">
            <summary>Data and system</summary>
            <div className="stack-lg">
              <SystemSection pid={pid} />
              <DangerSection pid={pid} />
            </div>
          </details>
        </>
      ) : (
        <>
          <HouseholdSection />
          <section className="card rows-card" aria-label="Calibration" data-testid="settings-calibration">
            <Row label="Calibration" note="Weigh ~10 typical meals once, then see how far the estimates land" to="/settings/calibration" testId="link-calibration" />
          </section>
        </>
      )}
    </>
  );
}
