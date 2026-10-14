import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_MEAL_SLOTS, type Profile, type ProfileInput } from '@katori/shared';
import { api } from '../api';
import { Banner, Card } from '../components/ui';
import { kcal } from '../lib/format';
import { useProfiles } from '../profile';
import { ActivityFields, AiFields, BasicsFields, DietFields, emptyDraft, GoalFields, MeasureFields, NameFields, problems, WeightFields, type Draft } from './profile-form';

type StepKey = 'name' | 'basics' | 'weight' | 'goal' | 'activity' | 'measure' | 'diet' | 'ai';

const STEPS: { key: StepKey; title: string; lead: string }[] = [
  { key: 'name', title: 'Who is this profile for?', lead: 'Each person gets their own targets, meals and charts.' },
  { key: 'basics', title: 'A few basics', lead: 'Used for the calorie formula and BMI.' },
  { key: 'weight', title: 'Weight', lead: 'Your starting point. Weigh in the morning, before breakfast.' },
  { key: 'goal', title: 'Goal', lead: 'Sets the daily deficit or surplus.' },
  { key: 'activity', title: 'How active are you?', lead: 'Sets the activity multiplier on your resting energy.' },
  { key: 'measure', title: 'Tape measurements', lead: 'Neck and waist (and hips for women) for the body fat estimate.' },
  { key: 'diet', title: 'Diet and eating windows', lead: 'Shapes the estimate rules and your meal slots.' },
  { key: 'ai', title: 'How should estimates run?', lead: 'Photo estimates use Claude Code on the home server.' },
];

export function toProfileInput(d: Draft): ProfileInput {
  return {
    name: d.name.trim(),
    colour: d.colour,
    sex: d.sex!,
    birthDate: d.birthDate,
    heightCm: Math.round(d.heightCm! * 10) / 10,
    weightKg: d.weightKg!,
    goal: d.goal,
    goalWeightKg: d.goalWeightKg,
    paceKgWeek: d.goal === 'maintain' ? 0 : d.paceKgWeek,
    jobType: d.jobType,
    workoutsPerWeek: d.workoutsPerWeek,
    activity: d.activity,
    neckCm: d.neckCm,
    waistCm: d.waistCm,
    hipCm: d.sex === 'female' ? d.hipCm : null,
    diet: { vegetarian: d.vegetarian, eggs: d.vegetarian ? d.eggs : true },
    mealSlots: d.mealSlots.length ? d.mealSlots : DEFAULT_MEAL_SLOTS,
    specialStatus: d.sex === 'female' ? d.specialStatus : 'none',
    aiAccess: d.aiAccess,
    startWeightKg: d.startWeightKg,
    startDate: d.startDate || null,
  };
}

function TargetsResult({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { select } = useProfiles();
  const finish = async () => {
    // Refetch first so the new profile is in the list when it's selected.
    await qc.refetchQueries({ queryKey: ['profiles'] });
    select(profile.id);
    navigate('/');
  };
  const { data } = useQuery({ queryKey: ['targets', profile.id], queryFn: () => api.targets(profile.id) });
  const t = data?.current;
  const f = data?.formula;
  return (
    <main>
      <Card title={`${profile.name}'s daily targets`} subtitle="Calculated from your answers. You can override any number in Settings." testId="ob-result">
        {t ? (
          <div className="stack">
            <div>
              <span className="hero" data-testid="ob-result-kcal">
                {kcal(t.kcal)}
              </span>
              <span className="hero-unit">kcal a day</span>
            </div>
            <dl className="kv">
              <dt>Protein</dt>
              <dd data-testid="ob-result-protein">{t.protein_g} g</dd>
              <dt>Carbs</dt>
              <dd data-testid="ob-result-carbs">{t.carbs_g} g</dd>
              <dt>Fat</dt>
              <dd data-testid="ob-result-fat">{t.fat_g} g</dd>
              <dt>Fiber</dt>
              <dd data-testid="ob-result-fiber">{t.fiber_g} g</dd>
            </dl>
            {f && (
              <p className="small muted">
                Resting energy {kcal(f.bmr)} kcal × activity {f.activityFactor} = maintenance {kcal(f.maintenance)} kcal
                {f.appliedPaceKgWeek > 0 ? `, ${f.dailyDelta > 0 ? '−' : ''}${kcal(f.dailyDelta)} kcal for ${f.appliedPaceKgWeek} kg a week` : ''}. Protein can go up to {f.proteinHigh_g} g if you lift.
              </p>
            )}
            {f?.notes.map((n) => (
              <Banner key={n} tone="info" testId="ob-result-note">
                {n}
              </Banner>
            ))}
          </div>
        ) : (
          <p className="muted">Calculating…</p>
        )}
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={() => void finish()}
          data-testid="ob-finish"
        >
          Go to {profile.name}'s home
        </button>
      </Card>
    </main>
  );
}

export function Onboarding({ first = false }: { first?: boolean }) {
  const { profiles } = useProfiles();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(() => emptyDraft(profiles.map((p) => p.colour)));
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Profile | null>(null);
  const set = (patch: Partial<Draft>) => {
    setError(null);
    setD((x) => ({ ...x, ...patch }));
  };

  const create = useMutation({
    mutationFn: () => api.createProfile(toProfileInput(d)),
    onSuccess: (p) => setCreated(p),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (created) {
    return (
      <div className="app">
        <TargetsResult profile={created} />
      </div>
    );
  }

  const s = STEPS[step]!;
  const body: Record<StepKey, ReactNode> = {
    name: <NameFields d={d} set={set} />,
    basics: <BasicsFields d={d} set={set} />,
    weight: <WeightFields d={d} set={set} withStart />,
    goal: <GoalFields d={d} set={set} />,
    activity: <ActivityFields d={d} set={set} />,
    measure: <MeasureFields d={d} set={set} />,
    diet: <DietFields d={d} set={set} />,
    ai: <AiFields d={d} set={set} />,
  };
  const last = step === STEPS.length - 1;

  const next = () => {
    const p = problems(d, s.key);
    if (p) return setError(p);
    if (last) create.mutate();
    else {
      setStep(step + 1);
      window.scrollTo(0, 0);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="row between">
          <strong>{first ? 'Welcome to Katori' : 'New profile'}</strong>
          {!first && (
            <Link to="/" className="btn btn-ghost btn-sm" data-testid="ob-cancel">
              Cancel
            </Link>
          )}
        </div>
      </header>
      <main>
        <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`} data-testid="ob-progress">
          {STEPS.map((x, i) => (
            <span key={x.key} className={i <= step ? 'done' : ''} />
          ))}
        </div>
        {first && step === 0 && (
          <p className="muted">
            Snap your plate, add a short note like "2 rotis, 1 katori dal, little ghee", and Claude itemizes it for you to review. Start with a profile for each person in the house.
          </p>
        )}
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          data-testid={`ob-step-${s.key}`}
        >
          <div>
            <h1>{s.title}</h1>
            <p className="muted small">{s.lead}</p>
          </div>
          {body[s.key]}
          {error && (
            <p className="delta-bad" role="alert" data-testid="ob-error">
              {error}
            </p>
          )}
          <div className="btn-row">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)} data-testid="ob-back">
                Back
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid={last ? 'ob-create' : 'ob-next'}>
              {last ? (create.isPending ? 'Creating…' : 'Create profile') : 'Next'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
