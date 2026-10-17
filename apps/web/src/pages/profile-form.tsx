import { useId, type ReactNode } from 'react';
import {
  ACTIVITY_LABELS,
  activityFromLifestyle,
  ageOn,
  cmToFtIn,
  dailyEnergyDelta,
  DEFAULT_MEAL_SLOTS,
  ftInToCm,
  maxPaceKgWeek,
  toDateStr,
  type ActivityLevel,
  type AiAccess,
  type Goal,
  type JobType,
  type MealSlot,
  type Profile,
  type Sex,
  type SpecialStatus,
} from '@katori/shared';
import { Field, NumberInput, Segmented } from '../components/ui';

export const CHIP_COLOURS = ['#b9481a', '#2a78d6', '#1baf7a', '#7c5cbf', '#d55181', '#008300', '#c98500', '#52514e'];

export interface Draft {
  name: string;
  colour: string;
  sex: Sex | null;
  birthDate: string;
  heightCm: number | null;
  heightUnit: 'cm' | 'ftin';
  weightKg: number | null;
  startWeightKg: number | null;
  startDate: string;
  goal: Goal;
  goalWeightKg: number | null;
  paceKgWeek: number;
  jobType: JobType;
  workoutsPerWeek: number;
  activity: ActivityLevel;
  activityTouched: boolean;
  neckCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  vegetarian: boolean;
  eggs: boolean;
  mealSlots: MealSlot[];
  specialStatus: SpecialStatus;
  aiAccess: AiAccess;
}

export function emptyDraft(usedColours: string[]): Draft {
  return {
    name: '',
    colour: CHIP_COLOURS.find((c) => !usedColours.includes(c)) ?? CHIP_COLOURS[usedColours.length % CHIP_COLOURS.length]!,
    sex: null,
    birthDate: '',
    heightCm: null,
    heightUnit: 'cm',
    weightKg: null,
    startWeightKg: null,
    startDate: '',
    goal: 'lose',
    goalWeightKg: null,
    paceKgWeek: 0.25,
    jobType: 'desk',
    workoutsPerWeek: 3,
    activity: 'light',
    activityTouched: false,
    neckCm: null,
    waistCm: null,
    hipCm: null,
    vegetarian: true,
    eggs: false,
    mealSlots: DEFAULT_MEAL_SLOTS,
    specialStatus: 'none',
    aiAccess: 'sign_in',
  };
}

export function draftFromProfile(p: Profile): Draft {
  return {
    ...emptyDraft([]),
    name: p.name,
    colour: p.colour,
    sex: p.sex,
    birthDate: p.birthDate,
    heightCm: p.heightCm,
    weightKg: p.latestWeightKg,
    goal: p.goal,
    goalWeightKg: p.goalWeightKg,
    paceKgWeek: p.paceKgWeek,
    jobType: p.jobType,
    workoutsPerWeek: p.workoutsPerWeek,
    activity: p.activity,
    // Still follows job type and workouts unless someone picked a different level by hand, so
    // changing either here moves the activity level (and with it the targets).
    activityTouched: p.activity !== activityFromLifestyle(p.jobType, p.workoutsPerWeek),
    vegetarian: p.diet.vegetarian,
    eggs: p.diet.eggs,
    mealSlots: p.mealSlots,
    specialStatus: p.specialStatus,
    aiAccess: p.aiAccess,
  };
}

export const today = () => toDateStr(new Date());
export const draftAge = (d: Draft) => (d.birthDate ? ageOn(d.birthDate, today()) : null);

type Set = (patch: Partial<Draft>) => void;

export function NameFields({ d, set }: { d: Draft; set: Set }) {
  const id = useId();
  return (
    <>
      <Field label="Name" htmlFor={id}>
        <input id={id} className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={30} autoComplete="off" data-testid="ob-name" />
      </Field>
      <div className="field">
        <span className="label">Chip colour</span>
        <div className="colour-swatches" role="group" aria-label="Chip colour">
          {CHIP_COLOURS.map((c) => (
            <button key={c} type="button" style={{ background: c }} aria-pressed={d.colour === c} aria-label={`Colour ${c}`} onClick={() => set({ colour: c })} data-testid={`ob-colour-${c.slice(1)}`} />
          ))}
        </div>
      </div>
    </>
  );
}

export function BasicsFields({ d, set }: { d: Draft; set: Set }) {
  const dob = useId();
  const ftin = d.heightCm ? cmToFtIn(d.heightCm) : null;
  const age = draftAge(d);
  return (
    <>
      <div className="field">
        <span className="label">Sex</span>
        <Segmented
          label="Sex"
          testId="ob-sex"
          value={d.sex ?? ('' as Sex)}
          onChange={(sex) => set({ sex, specialStatus: sex === 'male' ? 'none' : d.specialStatus, hipCm: sex === 'male' ? null : d.hipCm })}
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
        />
        <span className="hint">The calorie and body fat formulas differ by sex.</span>
      </div>
      <Field label="Date of birth" htmlFor={dob} hint={age != null ? `Age ${age}.${age < 18 ? ' Under 18: intake tracking only, with no deficit and no body fat estimate.' : ''}` : undefined}>
        <input id={dob} className="input" type="date" max={today()} value={d.birthDate} onChange={(e) => set({ birthDate: e.target.value })} data-testid="ob-dob" />
      </Field>
      <div className="field">
        <span className="label">Height</span>
        <Segmented
          label="Height unit"
          testId="ob-height-unit"
          value={d.heightUnit}
          onChange={(heightUnit) => set({ heightUnit })}
          options={[
            { value: 'cm', label: 'cm' },
            { value: 'ftin', label: 'ft / in' },
          ]}
        />
      </div>
      {d.heightUnit === 'cm' ? (
        <NumberInput label="Height (cm)" unit="cm" value={d.heightCm} onChange={(heightCm) => set({ heightCm })} testId="ob-height-cm" min={90} max={250} />
      ) : (
        <div className="grid-2">
          <NumberInput label="Feet" unit="ft" step="1" value={ftin?.ft ?? null} onChange={(ft) => set({ heightCm: ftInToCm(ft ?? 0, ftin?.in ?? 0) })} testId="ob-height-ft" />
          <NumberInput label="Inches" unit="in" step="1" value={ftin?.in ?? null} onChange={(inch) => set({ heightCm: ftInToCm(ftin?.ft ?? 5, inch ?? 0) })} testId="ob-height-in" />
        </div>
      )}
    </>
  );
}

export function WeightFields({ d, set, withStart }: { d: Draft; set: Set; withStart: boolean }) {
  const sd = useId();
  return (
    <>
      <NumberInput label="Current weight" unit="kg" value={d.weightKg} onChange={(weightKg) => set({ weightKg })} testId="ob-weight" min={20} max={300} />
      {withStart && (
        <div className="card stack" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <p className="small">
            <strong>Journey start (optional).</strong> If you started earlier, add that weight and date and the Journey chart begins there. You can backfill every weigh-in later on Body.
          </p>
          <div className="grid-2">
            <NumberInput label="Starting weight" unit="kg" value={d.startWeightKg} onChange={(startWeightKg) => set({ startWeightKg })} testId="ob-start-weight" />
            <Field label="Start date" htmlFor={sd}>
              <input id={sd} className="input" type="date" max={today()} value={d.startDate} onChange={(e) => set({ startDate: e.target.value })} data-testid="ob-start-date" />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

export function GoalFields({ d, set }: { d: Draft; set: Set }) {
  const cap = d.weightKg ? maxPaceKgWeek(d.weightKg) : null;
  const age = draftAge(d);
  const maintenanceOnly = (age != null && age < 18) || d.specialStatus !== 'none';
  return (
    <>
      <div className="field">
        <span className="label">Goal</span>
        <Segmented
          label="Goal"
          testId="ob-goal"
          value={d.goal}
          onChange={(goal) => set({ goal })}
          options={[
            { value: 'lose', label: 'Lose' },
            { value: 'maintain', label: 'Maintain' },
            { value: 'gain', label: 'Gain' },
          ]}
        />
      </div>
      <NumberInput label="Goal weight (optional)" unit="kg" value={d.goalWeightKg} onChange={(goalWeightKg) => set({ goalWeightKg })} testId="ob-goal-weight" />
      {d.goal !== 'maintain' && (
        <div className="field">
          <span className="label">Pace per week</span>
          <div className="chip-group" role="group" aria-label="Pace per week">
            {[0.25, 0.5, 0.75].map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={d.paceKgWeek === p} onClick={() => set({ paceKgWeek: p })} data-testid={`ob-pace-${p}`}>
                {p} kg
              </button>
            ))}
          </div>
          <NumberInput label="Or a custom pace" unit="kg / week" value={d.paceKgWeek} onChange={(paceKgWeek) => set({ paceKgWeek: paceKgWeek ?? 0 })} testId="ob-pace" step="0.05" min={0} max={2} />
          <span className="hint" data-testid="ob-pace-hint">
            {cap != null && d.paceKgWeek > cap
              ? `Capped at 1% of body weight: ${Math.round(cap * 100) / 100} kg a week ≈ ${Math.round(dailyEnergyDelta(cap)).toLocaleString('en-US')} kcal a day ${d.goal === 'lose' ? 'below' : 'above'} maintenance.`
              : `≈ ${Math.round(dailyEnergyDelta(d.paceKgWeek)).toLocaleString('en-US')} kcal a day ${d.goal === 'lose' ? 'below' : 'above'} maintenance.`}
          </span>
        </div>
      )}
      {maintenanceOnly && <p className="small muted">This profile gets a maintenance target only (under 18, pregnant or breastfeeding).</p>}
    </>
  );
}

export function ActivityFields({ d, set }: { d: Draft; set: Set }) {
  const sel = useId();
  const update = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch };
    set({ ...patch, ...(next.activityTouched ? {} : { activity: activityFromLifestyle(next.jobType, next.workoutsPerWeek) }) });
  };
  return (
    <>
      <div className="field">
        <span className="label">Job type</span>
        <Segmented
          label="Job type"
          testId="ob-job"
          value={d.jobType}
          onChange={(jobType) => update({ jobType })}
          options={[
            { value: 'desk', label: 'Desk' },
            { value: 'standing', label: 'On my feet' },
            { value: 'manual', label: 'Physical' },
          ]}
        />
      </div>
      <NumberInput label="Workouts per week" value={d.workoutsPerWeek} onChange={(w) => update({ workoutsPerWeek: Math.max(0, Math.round(w ?? 0)) })} testId="ob-workouts" step="1" min={0} max={14} />
      <Field label="Activity level" htmlFor={sel} hint="Worked out from the two answers above; change it if it feels off.">
        <select id={sel} className="input" value={d.activity} onChange={(e) => set({ activity: e.target.value as ActivityLevel, activityTouched: true })} data-testid="ob-activity">
          {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
            <option key={a} value={a}>
              {ACTIVITY_LABELS[a]}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

export function MeasureTips() {
  return (
    <details className="tips" data-testid="measure-tips">
      <summary>How to measure</summary>
      <ul>
        <li>Neck: just below the Adam's apple.</li>
        <li>Waist: level with the navel for men; at the narrowest point for women.</li>
        <li>Hips: at the widest point.</li>
        <li>Same time of day, relaxed, every 2 weeks. Any single tape reading is rough; the trend is what counts.</li>
      </ul>
    </details>
  );
}

export function MeasureFields({ d, set }: { d: Draft; set: Set }) {
  return (
    <>
      <p className="small muted">Optional, but needed for the body fat estimate. You can add them later on Body.</p>
      <div className="grid-2">
        <NumberInput label="Neck" unit="cm" value={d.neckCm} onChange={(neckCm) => set({ neckCm })} testId="ob-neck" />
        <NumberInput label="Waist" unit="cm" value={d.waistCm} onChange={(waistCm) => set({ waistCm })} testId="ob-waist" />
      </div>
      {d.sex === 'female' && <NumberInput label="Hips" unit="cm" value={d.hipCm} onChange={(hipCm) => set({ hipCm })} testId="ob-hips" />}
      <MeasureTips />
    </>
  );
}

export function DietFields({ d, set }: { d: Draft; set: Set }) {
  const setSlot = (i: number, patch: Partial<MealSlot>) => set({ mealSlots: d.mealSlots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <>
      <label className="toggle">
        <span>Vegetarian</span>
        <input type="checkbox" checked={d.vegetarian} onChange={(e) => set({ vegetarian: e.target.checked })} data-testid="ob-veg" />
      </label>
      {d.vegetarian && (
        <label className="toggle">
          <span>Eats eggs</span>
          <input type="checkbox" checked={d.eggs} onChange={(e) => set({ eggs: e.target.checked })} data-testid="ob-eggs" />
        </label>
      )}
      <div className="field">
        <span className="label">Eating windows</span>
        <span className="hint">Meals land in the slot nearest the time you log them.</span>
        <div className="stack">
          {d.mealSlots.map((s, i) => (
            <div className="slot-row" key={i} data-testid={`ob-slot-${i}`}>
              <input className="input" aria-label={`Slot ${i + 1} name`} value={s.name} maxLength={24} onChange={(e) => setSlot(i, { name: e.target.value })} data-testid={`ob-slot-name-${i}`} />
              <input className="input" type="time" aria-label={`Slot ${i + 1} time`} value={s.time} onChange={(e) => setSlot(i, { time: e.target.value })} data-testid={`ob-slot-time-${i}`} />
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove slot ${s.name}`} disabled={d.mealSlots.length <= 1} onClick={() => set({ mealSlots: d.mealSlots.filter((_, j) => j !== i) })} data-testid={`ob-slot-remove-${i}`}>
                ✕
              </button>
            </div>
          ))}
          {d.mealSlots.length < 8 && (
            <button type="button" className="btn btn-sm" onClick={() => set({ mealSlots: [...d.mealSlots, { name: 'Snack', time: '17:00' }] })} data-testid="ob-slot-add">
              + Add a slot
            </button>
          )}
        </div>
      </div>
      {d.sex === 'female' && (
        <div className="field">
          <span className="label">Pregnant or breastfeeding (optional)</span>
          <Segmented
            label="Pregnant or breastfeeding"
            testId="ob-special"
            value={d.specialStatus}
            onChange={(specialStatus) => set({ specialStatus })}
            options={[
              { value: 'none', label: 'Neither' },
              { value: 'pregnant', label: 'Pregnant' },
              { value: 'breastfeeding', label: 'Breastfeeding' },
            ]}
          />
          <span className="hint">Switches targets to maintenance, with no deficit.</span>
        </div>
      )}
    </>
  );
}

const AI_OPTIONS: { value: AiAccess; title: string; body: ReactNode }[] = [
  {
    value: 'sign_in',
    title: 'My own Claude sign-in',
    body: (
      <>
        Uses your own Pro or Max plan. Run <code>claude setup-token</code> once, then on the home server: <code>katori set-credential &lt;profile&gt;</code>.
      </>
    ),
  },
  { value: 'api_key', title: 'Claude Console API key', body: 'Billed per use; at a few photos a day, likely a few dollars a month (approximate).' },
  { value: 'manual', title: 'Manual only', body: 'No AI. Log with saved foods, quick add and the reference tables.' },
];

export function AiFields({ d, set }: { d: Draft; set: Set }) {
  return (
    <div className="stack" role="radiogroup" aria-label="AI access">
      <p className="small muted">Each person's estimates run on their own AI access; profiles never borrow someone else's sign-in.</p>
      {AI_OPTIONS.map((o) => (
        <label key={o.value} className="choice">
          <input type="radio" name="ai" checked={d.aiAccess === o.value} onChange={() => set({ aiAccess: o.value })} data-testid={`ob-ai-${o.value}`} />
          <span>
            <strong>{o.title}</strong>
            <span className="small muted" style={{ display: 'block' }}>
              {o.body}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Problems that block saving, per field group. */
export function problems(d: Draft, step: 'name' | 'basics' | 'weight' | 'goal' | 'activity' | 'measure' | 'diet' | 'ai'): string | null {
  switch (step) {
    case 'name':
      return d.name.trim() ? null : 'Add a name.';
    case 'basics':
      if (!d.sex) return 'Choose a sex.';
      if (!d.birthDate || d.birthDate >= today()) return 'Add a date of birth.';
      if (!d.heightCm || d.heightCm < 90 || d.heightCm > 250) return 'Add a height between 90 and 250 cm.';
      return null;
    case 'weight':
      if (!d.weightKg || d.weightKg < 20 || d.weightKg > 300) return 'Add a weight between 20 and 300 kg.';
      if ((d.startWeightKg == null) !== !d.startDate) return 'Add both a starting weight and its date, or neither.';
      return null;
    case 'goal':
      return d.goal !== 'maintain' && (d.paceKgWeek < 0 || d.paceKgWeek > 2) ? 'Pace must be between 0 and 2 kg a week.' : null;
    case 'diet':
      return d.mealSlots.every((s) => s.name.trim() && /^\d{2}:\d{2}$/.test(s.time)) ? null : 'Every slot needs a name and a time.';
    default:
      return null;
  }
}
