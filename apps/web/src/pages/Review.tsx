import { useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { macroKcal, macrosDisagree, NUTRIENT_MAX, rescaleToGrams, scaleNutrients, sumNutrients, type Confidence, type ItemSource, type Meal, type MyFood, type Nutrients, type ReferenceFood } from '@katori/shared';
import { api } from '../api';
import { PencilIcon, XIcon } from '../components/Icons';
import { Banner, Card, ErrorNote, Field, Loading, NumberInput, Segmented, Sheet, Spinner } from '../components/ui';
import { clock, fullDate, kcal, num1 } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid } from '../profile';
import { StatusBadge } from './home/cards';

interface Line extends Nutrients {
  key: string;
  name: string;
  portion: string;
  grams: number;
  confidence: Confidence | null;
  source: ItemSource;
  myFoodId: number | null;
  /** Values (and portion wording) the grams field rescales from, so repeated edits don't compound rounding. */
  base: Nutrients & { grams: number; portion: string };
}

let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

function lineFrom(i: Omit<Line, 'key' | 'base'>): Line {
  return { ...i, key: nextKey(), base: { grams: i.grams, portion: i.portion, kcal: i.kcal, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g, fiber_g: i.fiber_g } };
}

function fromFood(f: MyFood, grams?: number): Line {
  const g = grams && grams > 0 ? grams : f.servingG;
  const factor = f.servingG > 0 ? g / f.servingG : 1;
  const n = scaleNutrients({ kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fiber_g: f.fiber_g }, factor);
  return lineFrom({ name: f.name, portion: factor === 1 ? f.servingDesc : `${num1(factor)} × ${f.servingDesc}`, grams: Math.round(g), ...n, confidence: 'high', source: 'my_food', myFoodId: f.id });
}

function fromReference(r: ReferenceFood, grams: number): Line {
  const n = scaleNutrients({ kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g }, grams / 100);
  return lineFrom({ name: r.name, portion: `${grams} g`, grams, ...n, confidence: 'high', source: 'reference', myFoodId: null });
}

const SOURCE_LABEL: Record<ItemSource, string> = { ai: 'AI', my_food: 'My food', reference: 'Reference', manual: 'Manual' };

function FoodPicker({ pid, title, onPick, onClose }: { pid: string; title: string; onPick: (l: Line) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'saved' | 'reference' | 'custom'>('saved');
  const { data: foods = [] } = useQuery({ queryKey: ['foods', pid], queryFn: () => api.foods(pid) });
  const [q, setQ] = useState('');
  const { data: refs = [], isFetching } = useQuery({ queryKey: ['ref', q], queryFn: () => api.searchReference(q), enabled: tab === 'reference' && q.trim().length >= 2 });
  const [refGrams, setRefGrams] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState({ name: '', grams: 100 as number | null, kcal: null as number | null, protein_g: 0 as number | null, carbs_g: 0 as number | null, fat_g: 0 as number | null, fiber_g: 0 as number | null });
  const searchId = useId();
  const nameId = useId();
  return (
    <Sheet title={title} onClose={onClose} testId="food-picker">
      <Segmented
        label="Source"
        testId="picker-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'saved', label: 'My foods' },
          { value: 'reference', label: 'Tables' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {tab === 'saved' && (
        <div className="list" data-testid="picker-saved">
          {foods.length === 0 && <p className="muted">No saved foods yet. Use "Save as my food" on any reviewed line.</p>}
          {foods.map((f) => (
            <button key={f.id} className="list-item" style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer' }} onClick={() => onPick(fromFood(f))} data-testid={`pick-food-${f.id}`}>
              <div className="grow">
                <div className="title">{f.name}</div>
                <div className="meta">
                  {f.servingDesc}, {f.servingG} g{f.household ? ', household' : ''}
                </div>
              </div>
              <div className="end">{kcal(f.kcal)} kcal</div>
            </button>
          ))}
        </div>
      )}
      {tab === 'reference' && (
        <div className="stack">
          <Field label="Search IFCT 2017 and INDB" htmlFor={searchId} hint="Values are per 100 g; set the grams you ate.">
            <input id={searchId} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="toor dal, chapati, paneer…" data-testid="picker-search" />
          </Field>
          {isFetching && <Spinner />}
          {q.trim().length >= 2 && !isFetching && refs.length === 0 && <p className="muted">No matches. Reference tables load with `katori import-reference`.</p>}
          <div className="list" data-testid="picker-reference">
            {refs.map((r) => {
              const g = refGrams[r.id] ?? r.servingG ?? 100;
              return (
                <div key={r.id} className="list-item">
                  <div className="grow">
                    <div className="title">{r.name}</div>
                    <div className="meta">
                      {r.source}, {kcal(r.kcal)} kcal per 100 g{r.servingG ? `, serving ${r.servingG} g` : ''}
                    </div>
                  </div>
                  <input className="input" style={{ width: 80, minHeight: 36 }} type="number" inputMode="decimal" aria-label={`Grams of ${r.name}`} value={g} onChange={(e) => setRefGrams((x) => ({ ...x, [r.id]: Number(e.target.value) }))} />
                  <button className="btn btn-sm" onClick={() => onPick(fromReference(r, g))} data-testid={`pick-ref-${r.id}`}>
                    Add
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === 'custom' && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custom.name.trim() || custom.kcal == null) return;
            onPick(lineFrom({ name: custom.name.trim(), portion: `${custom.grams ?? 0} g`, grams: custom.grams ?? 0, kcal: custom.kcal, protein_g: custom.protein_g ?? 0, carbs_g: custom.carbs_g ?? 0, fat_g: custom.fat_g ?? 0, fiber_g: custom.fiber_g ?? 0, confidence: 'high', source: 'manual', myFoodId: null }));
          }}
          data-testid="picker-custom"
        >
          <Field label="Name" htmlFor={nameId}>
            <input id={nameId} className="input" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} data-testid="custom-name" />
          </Field>
          <div className="grid-2">
            <NumberInput label="Grams" unit="g" value={custom.grams} onChange={(grams) => setCustom({ ...custom, grams })} testId="custom-grams" />
            <NumberInput label="Calories" unit="kcal" value={custom.kcal} onChange={(v) => setCustom({ ...custom, kcal: v })} testId="custom-kcal" />
            <NumberInput label="Protein" unit="g" value={custom.protein_g} onChange={(v) => setCustom({ ...custom, protein_g: v })} testId="custom-protein" />
            <NumberInput label="Carbs" unit="g" value={custom.carbs_g} onChange={(v) => setCustom({ ...custom, carbs_g: v })} testId="custom-carbs" />
            <NumberInput label="Fat" unit="g" value={custom.fat_g} onChange={(v) => setCustom({ ...custom, fat_g: v })} testId="custom-fat" />
            <NumberInput label="Fiber" unit="g" value={custom.fiber_g} onChange={(v) => setCustom({ ...custom, fiber_g: v })} testId="custom-fiber" />
          </div>
          <button className="btn btn-primary" disabled={!custom.name.trim() || custom.kcal == null} data-testid="custom-add">
            Add line
          </button>
        </form>
      )}
    </Sheet>
  );
}

function SaveFoodSheet({ pid, line, onSaved, onClose }: { pid: string; line: Line; onSaved: (f: MyFood) => void; onClose: () => void }) {
  const [name, setName] = useState(line.name);
  const [servingDesc, setServingDesc] = useState(line.portion || '1 serving');
  const [household, setHousehold] = useState(true);
  const toast = useToast();
  const nameId = useId();
  const servId = useId();
  const save = useMutation({
    mutationFn: () => api.createFood(pid, { name: name.trim(), aliases: name.trim().toLowerCase() !== line.name.toLowerCase() ? [line.name] : [], servingDesc: servingDesc.trim(), servingG: line.grams, kcal: line.kcal, protein_g: line.protein_g, carbs_g: line.carbs_g, fat_g: line.fat_g, fiber_g: line.fiber_g, household }),
    onSuccess: (f) => {
      toast(`Saved "${f.name}"${f.household ? ' for the household' : ''}`);
      onSaved(f);
    },
  });
  return (
    <Sheet title="Save as my food" onClose={onClose} testId="save-food-sheet">
      <p className="small muted">
        Next time this matches, your numbers replace the AI's. Per {servingDesc || 'serving'} ({line.grams} g): {kcal(line.kcal)} kcal, protein {num1(line.protein_g)} g.
      </p>
      <Field label="Name" htmlFor={nameId}>
        <input id={nameId} className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="save-food-name" />
      </Field>
      <Field label="Serving" htmlFor={servId} hint="How you'd say one portion: 1 katori, 1 glass, 2 rotis.">
        <input id={servId} className="input" value={servingDesc} onChange={(e) => setServingDesc(e.target.value)} data-testid="save-food-serving" />
      </Field>
      <Segmented
        label="Who it's for"
        testId="save-food-scope"
        value={household ? 'household' : 'mine'}
        onChange={(v) => setHousehold(v === 'household')}
        options={[
          { value: 'household', label: 'Household' },
          { value: 'mine', label: 'Just me' },
        ]}
      />
      {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
      <button className="btn btn-primary" disabled={!name.trim() || !servingDesc.trim() || save.isPending} onClick={() => save.mutate()} data-testid="save-food-submit">
        Save
      </button>
    </Sheet>
  );
}

const NUTRIENT_FIELDS: { key: keyof Nutrients; label: string; unit: string; testId: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', testId: 'edit-kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g', testId: 'edit-protein' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', testId: 'edit-carbs' },
  { key: 'fat_g', label: 'Fat', unit: 'g', testId: 'edit-fat' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g', testId: 'edit-fiber' },
];

function fieldError(v: number | null, max: number): string | null {
  if (v == null) return 'Enter a number (0 if none)';
  if (v < 0) return "Can't be negative";
  if (v > max) return `Up to ${max.toLocaleString('en-US')}`;
  return null;
}

/** Type a line's calories and macros by hand, e.g. when you know the AI's number is off. */
function EditLineSheet({ line, mealKcal, sharedWith, onSave, onClose }: { line: Line; mealKcal: number; sharedWith: string[]; onSave: (name: string, n: Nutrients) => void; onClose: () => void }) {
  const nameId = useId();
  const [name, setName] = useState(line.name);
  const [vals, setVals] = useState<Record<keyof Nutrients, number | null>>({ kcal: line.kcal, protein_g: line.protein_g, carbs_g: line.carbs_g, fat_g: line.fat_g, fiber_g: line.fiber_g });
  const errors = Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f.key, fieldError(vals[f.key], NUTRIENT_MAX[f.key])])) as Record<keyof Nutrients, string | null>;
  const nameError = name.trim() ? null : 'Enter a name';
  const valid = !nameError && NUTRIENT_FIELDS.every((f) => !errors[f.key]);
  const n = valid ? (vals as Nutrients) : null;
  const newMealKcal = Math.round(mealKcal - line.kcal + (vals.kcal != null && !errors.kcal ? vals.kcal : line.kcal));
  return (
    <Sheet title="Edit nutrition" onClose={onClose} testId="edit-line">
      <form
        noValidate
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (n) onSave(name.trim(), n);
        }}
      >
        <p className="small muted">
          For the {num1(line.grams)} g on this line{line.portion && line.portion !== `${line.grams} g` ? ` (${line.portion})` : ''}. Changing grams later rescales from these numbers.
        </p>
        <Field label="Name" htmlFor={nameId} hint={nameError && <span className="delta-bad" data-testid="edit-name-error">{nameError}</span>}>
          <input id={nameId} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="edit-name" />
        </Field>
        <div className="grid-2">
          {NUTRIENT_FIELDS.map((f) => (
            <NumberInput
              key={f.key}
              label={f.label}
              unit={f.unit}
              min={0}
              max={NUTRIENT_MAX[f.key]}
              value={vals[f.key]}
              onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))}
              testId={f.testId}
              hint={errors[f.key] && <span className="delta-bad" data-testid={`${f.testId}-error`}>{errors[f.key]}</span>}
            />
          ))}
        </div>
        {n && macrosDisagree(n) && (
          <div className="banner banner-warn" role="status" data-testid="edit-macro-warning">
            <div style={{ flex: 1, minWidth: 0 }}>
              Protein, carbs and fat add up to about {kcal(macroKcal(n))} kcal, not {kcal(n.kcal)}. Fine if you know better; otherwise check the numbers.
            </div>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setVals((x) => ({ ...x, kcal: macroKcal(n) }))} data-testid="edit-use-macro-kcal">
              Use {kcal(macroKcal(n))}
            </button>
          </div>
        )}
        {line.source === 'my_food' && <p className="small muted">This line stops being linked to your saved food; the saved food itself doesn't change.</p>}
        {sharedWith.length > 0 && <p className="small muted">Only your meal changes. {sharedWith.join(' and ')} keep{sharedWith.length === 1 ? 's' : ''} their own share.</p>}
        <p className="small" data-testid="edit-meal-total">
          Meal total: <strong>{kcal(newMealKcal)} kcal</strong>
          {newMealKcal !== Math.round(mealKcal) && <span className="muted"> (was {kcal(mealKcal)})</span>}
        </p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose} data-testid="edit-cancel">
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} data-testid="edit-save">
            Done
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const itemPayload = (l: Omit<Line, 'key' | 'base'>) => ({ name: l.name, portion: l.portion, grams: l.grams, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g, fiber_g: l.fiber_g, confidence: l.confidence, source: l.source, myFoodId: l.myFoodId });

function Editor({ pid, meal, slots }: { pid: string; meal: Meal; slots: string[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>(() => meal.items.map((i) => lineFrom(i)));
  const [slot, setSlot] = useState(meal.slot);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'swap'; key: string } | null>(null);
  const [saving, setSaving] = useState<Line | null>(null);
  const [editing, setEditing] = useState<Line | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const totals = useMemo(() => sumNutrients(lines), [lines]);
  const confirmed = meal.status === 'confirmed';
  // Nothing is stored until Confirm / Save changes, so say when there's something to save.
  const [initial] = useState(() => JSON.stringify({ slot: meal.slot, items: meal.items.map(itemPayload) }));
  const dirty = JSON.stringify({ slot, items: lines.map(itemPayload) }) !== initial;

  const update = (key: string, fn: (l: Line) => Line) => setLines((ls) => ls.map((l) => (l.key === key ? fn(l) : l)));

  const answer = useMutation({
    mutationFn: (a: { question: string; answer: string }) => api.answerMeal(pid, meal.id, [a]),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meal', pid, meal.id] }),
  });
  const confirm = useMutation({
    mutationFn: () =>
      api.confirmMeal(pid, meal.id, {
        slot,
        items: lines.map(itemPayload),
      }),
    onSuccess: (m) => {
      toast(`Confirmed, ${kcal(m.totals.kcal)} kcal`);
      void qc.invalidateQueries();
      navigate('/');
    },
  });

  return (
    <>
      {meal.questions.length > 0 && (
        <Card title="A quick question" subtitle="Your answer re-runs the estimate" testId="questions">
          <div className="stack">
            {meal.questions.map((q, qi) => (
              <div className="question" key={q.text} data-testid={`question-${qi}`}>
                <strong>{q.text}</strong>
                <div className="chip-group">
                  {q.options.map((o) => (
                    <button key={o} className="chip" disabled={answer.isPending} onClick={() => answer.mutate({ question: q.text, answer: o })} data-testid={`answer-${qi}-${o}`}>
                      {o}
                    </button>
                  ))}
                </div>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const a = answers[q.text]?.trim();
                    if (a) answer.mutate({ question: q.text, answer: a });
                  }}
                >
                  <input className="input" placeholder="Or type an answer" aria-label={`Answer: ${q.text}`} value={answers[q.text] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.text]: e.target.value })} data-testid={`answer-text-${qi}`} />
                  <button className="btn btn-sm" disabled={!answers[q.text]?.trim() || answer.isPending} data-testid={`answer-send-${qi}`}>
                    Send
                  </button>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Items" subtitle="Change grams and the macros rescale, or tap the numbers to type your own. Low-confidence lines are highlighted." testId="items">
        <div className="stack">
          {lines.length === 0 && <p className="muted">No items yet. Add what you ate below.</p>}
          {lines.map((l, i) => (
            <div key={l.key} className={`item-card ${l.confidence === 'low' ? 'low' : ''}`} data-testid={`item-${i}`}>
              <div className="item-head">
                <div style={{ minWidth: 0 }}>
                  <div className="name" data-testid={`item-name-${i}`}>
                    {l.name}
                  </div>
                  <div className="portion">{l.portion}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {l.confidence === 'low' && (
                    <span className="badge badge-low" data-testid={`item-low-${i}`}>
                      ⚠ Check this
                    </span>
                  )}
                  <span className="badge">{SOURCE_LABEL[l.source]}</span>
                </div>
              </div>
              <button
                type="button"
                className="item-macros"
                onClick={() => setEditing(l)}
                aria-label={`Edit ${l.name}: ${kcal(l.kcal)} kcal, protein ${num1(l.protein_g)} g, carbs ${num1(l.carbs_g)} g, fat ${num1(l.fat_g)} g, fiber ${num1(l.fiber_g)} g`}
                data-testid={`item-macros-${i}`}
              >
                <span>
                  <strong data-testid={`item-kcal-${i}`}>{kcal(l.kcal)}</strong>kcal
                </span>
                <span>
                  <strong data-testid={`item-protein-${i}`}>{num1(l.protein_g)}</strong>protein
                </span>
                <span>
                  <strong data-testid={`item-carbs-${i}`}>{num1(l.carbs_g)}</strong>carbs
                </span>
                <span>
                  <strong data-testid={`item-fat-${i}`}>{num1(l.fat_g)}</strong>fat
                </span>
                <span>
                  <strong data-testid={`item-fiber-${i}`}>{num1(l.fiber_g)}</strong>fiber
                </span>
              </button>
              <div className="item-actions">
                <label className="row small" style={{ gap: 6 }}>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={l.grams}
                    aria-label={`Grams of ${l.name}`}
                    onChange={(e) => {
                      const g = Math.max(0, Number(e.target.value) || 0);
                      update(l.key, (x) => ({ ...x, ...rescaleToGrams(x.base, g), grams: g, portion: x.base.grams > 0 && g !== x.base.grams ? `${g} g` : x.base.portion }));
                    }}
                    data-testid={`item-grams-${i}`}
                  />
                  g
                </label>
                <button className="btn btn-sm" onClick={() => setEditing(l)} aria-label={`Edit nutrition for ${l.name}`} data-testid={`item-edit-${i}`}>
                  <PencilIcon width={16} height={16} /> Edit
                </button>
                <button className="btn btn-sm" onClick={() => setPicker({ mode: 'swap', key: l.key })} data-testid={`item-swap-${i}`}>
                  Swap
                </button>
                {l.source !== 'my_food' && (
                  <button className="btn btn-sm" onClick={() => setSaving(l)} data-testid={`item-save-${i}`}>
                    Save as my food
                  </button>
                )}
                <button className="btn btn-sm btn-ghost btn-danger" style={{ marginLeft: 'auto', padding: '0 8px' }} aria-label={`Remove ${l.name}`} title="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} data-testid={`item-remove-${i}`}>
                  <XIcon width={18} height={18} />
                </button>
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => setPicker({ mode: 'add' })} data-testid="item-add">
            + Add item
          </button>
        </div>
      </Card>

      <Card title="Meal slot" testId="review-slot">
        <div className="chip-group">
          {slots.map((s) => (
            <button key={s} className="chip" aria-pressed={slot === s} onClick={() => setSlot(s)} data-testid={`review-slot-${s}`}>
              {s}
            </button>
          ))}
        </div>
      </Card>

      <div className="totals-bar" data-testid="review-totals">
        <div className="row between">
          <div>
            <strong data-testid="review-total-kcal">{kcal(totals.kcal)} kcal</strong>
            <div className="small muted">
              <span>Protein {num1(totals.protein_g)} g</span> <span style={{ marginLeft: 8 }}>Carbs {num1(totals.carbs_g)} g</span>{' '}
              <span style={{ marginLeft: 8 }}>Fat {num1(totals.fat_g)} g</span> <span style={{ marginLeft: 8 }}>Fiber {num1(totals.fiber_g)} g</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => confirm.mutate()} disabled={confirm.isPending || (confirmed && !dirty)} data-testid="review-confirm">
            {confirmed ? 'Save changes' : 'Confirm'}
          </button>
        </div>
        {dirty && (
          <p className="small" data-testid="review-unsaved">
            Unsaved changes: tap {confirmed ? 'Save changes' : 'Confirm'} to keep them.
          </p>
        )}
        {confirm.error && <p className="delta-bad small">{confirm.error instanceof Error ? confirm.error.message : String(confirm.error)}</p>}
      </div>

      {picker && (
        <FoodPicker
          pid={pid}
          title={picker.mode === 'add' ? 'Add item' : 'Swap to…'}
          onClose={() => setPicker(null)}
          onPick={(l) => {
            if (picker.mode === 'add') setLines((ls) => [...ls, l]);
            else
              setLines((ls) =>
                ls.map((x) => {
                  if (x.key !== picker.key) return x;
                  // Keep the grams you ate when swapping to a saved food.
                  if (l.source === 'my_food' && x.grams > 0 && l.base.grams > 0) {
                    const scaled = rescaleToGrams(l.base, x.grams);
                    return { ...l, ...scaled, grams: x.grams, portion: `${x.grams} g` };
                  }
                  return l;
                }),
              );
            setPicker(null);
          }}
        />
      )}
      {editing && (
        <EditLineSheet
          line={editing}
          mealKcal={totals.kcal}
          sharedWith={meal.sharedWith.map((s) => s.name)}
          onClose={() => setEditing(null)}
          onSave={(name, n) => {
            const changed = (Object.keys(n) as (keyof Nutrients)[]).some((k) => n[k] !== editing[k]);
            // Typed numbers become the line's own: marked manual, unlinked from any saved food,
            // no longer "check this", and the base that later gram changes rescale from.
            update(editing.key, (x) => (changed ? { ...x, name, ...n, source: 'manual', myFoodId: null, confidence: 'high', base: { grams: x.grams, portion: x.portion, ...n } } : { ...x, name }));
            setEditing(null);
          }}
        />
      )}
      {saving && (
        <SaveFoodSheet
          pid={pid}
          line={saving}
          onClose={() => setSaving(null)}
          onSaved={(f) => {
            update(saving.key, (x) => ({ ...x, source: 'my_food', myFoodId: f.id, name: f.name }));
            void qc.invalidateQueries({ queryKey: ['foods'] });
            void qc.invalidateQueries({ queryKey: ['quickFoods'] });
            setSaving(null);
          }}
        />
      )}
    </>
  );
}

export function Review() {
  const pid = usePid();
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [manual, setManual] = useState(false);
  const { data: meal, error, isLoading } = useQuery({
    queryKey: ['meal', pid, id],
    queryFn: () => api.meal(pid, id),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 1500 : false),
  });
  const { data: profile } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  const retry = useMutation({
    mutationFn: () => api.retryMeal(pid, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meal', pid, id] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMeal(pid, id),
    onSuccess: () => {
      toast('Meal deleted');
      void qc.invalidateQueries();
      navigate('/');
    },
  });

  if (isLoading) return <Loading />;
  if (error || !meal) return <ErrorNote error={error ?? new Error('Meal not found')} />;

  const slots = [...new Set([...(profile?.mealSlots.map((s) => s.name) ?? []), meal.slot])];
  const editable = meal.status === 'estimated' || meal.status === 'confirmed' || (meal.status === 'failed' && manual);
  // Remount the editor whenever a new estimate lands.
  const editorKey = `${meal.status}-${meal.attempts}-${meal.items.map((i) => i.id).join('.')}`;

  return (
    <>
      <div className="page-head">
        <h1>
          {meal.slot} <span className="muted small">{clock(meal.eatenAt)}</span>
        </h1>
        <StatusBadge status={meal.status} />
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        {fullDate(meal.eatenAt.slice(0, 10))}
        {meal.portion !== 1 && <span className="badge" style={{ marginLeft: 8 }}>Your portion {meal.portion}×</span>}
        {meal.calibration && <span className="badge" style={{ marginLeft: 8 }}>Calibration, not counted</span>}
      </p>

      {(meal.hasPhoto || meal.note) && (
        <Card testId="review-source">
          <div className="stack">
            {meal.hasPhoto && <img className="photo-preview" src={api.mealPhotoUrl(pid, meal.id)} alt="The meal" data-testid="review-photo" />}
            {meal.note && (
              <p>
                <span className="muted">Note:</span> {meal.note}
              </p>
            )}
            {meal.answers.length > 0 && <p className="small muted">Answers: {meal.answers.map((a) => `${a.question} ${a.answer}`).join('; ')}</p>}
            {meal.sharedWith.length > 0 && (
              <p className="small" data-testid="shared-with">
                Also logged for {meal.sharedWith.map((s) => `${s.name} (${s.portion}×)`).join(', ')}
              </p>
            )}
          </div>
        </Card>
      )}

      {meal.status === 'pending' && (
        <Card testId="review-pending">
          <div className="row">
            <Spinner label="Estimating" />
            <div>
              <strong>Estimating…</strong>
              <p className="small muted">Usually seconds to tens of seconds. You can leave this screen; it carries on.</p>
            </div>
          </div>
          {meal.error && (
            <p className="small" style={{ marginTop: 10 }} data-testid="review-retrying">
              {meal.error}
            </p>
          )}
        </Card>
      )}

      {meal.status === 'failed' && !manual && (
        <Banner
          tone="error"
          title="The estimate failed"
          testId="review-failed"
          action={
            <div className="stack">
              <button className="btn btn-sm" onClick={() => retry.mutate()} disabled={retry.isPending} data-testid="review-retry">
                Retry
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setManual(true)} data-testid="review-manual">
                Enter by hand
              </button>
            </div>
          }
        >
          <p data-testid="review-error">{meal.error}</p>
        </Banner>
      )}

      {editable && <Editor key={editorKey} pid={pid} meal={meal} slots={slots} />}

      <div className="btn-row">
        <Link to="/" className="btn btn-ghost">
          Back
        </Link>
        <button
          className="btn btn-ghost btn-danger"
          onClick={() => {
            if (window.confirm('Delete this meal?')) remove.mutate();
          }}
          data-testid="review-delete"
        >
          Delete meal
        </button>
      </div>
    </>
  );
}
