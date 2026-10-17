import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyFood, MyFoodInput } from '@katori/shared';
import { api } from '../api';
import { ChevronRight } from '../components/Icons';
import { Banner, Card, ErrorNote, Field, Loading, NumberInput, Segmented, Sheet } from '../components/ui';
import { kcal, num1 } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

const blank: MyFoodInput = { name: '', aliases: [], servingDesc: '1 serving', servingG: 100, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, household: true };

function FoodSheet({ pid, food, onClose }: { pid: string; food: MyFood | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<MyFoodInput>(() => (food ? { ...food, household: food.household } : blank));
  const [aliases, setAliases] = useState(food?.aliases.join(', ') ?? '');
  const nameId = useId();
  const servId = useId();
  const aliasId = useId();
  const save = useMutation({
    mutationFn: () => {
      const input = { ...f, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) };
      return food ? api.updateFood(pid, food.id, input) : api.createFood(pid, input);
    },
    onSuccess: (x) => {
      toast(`Saved "${x.name}"`);
      void qc.invalidateQueries({ queryKey: ['foods'] });
      void qc.invalidateQueries({ queryKey: ['quickFoods'] });
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteFood(pid, food!.id),
    onSuccess: () => {
      toast(`Deleted "${food!.name}"`);
      void qc.invalidateQueries({ queryKey: ['foods'] });
      onClose();
    },
  });
  const set = (patch: Partial<MyFoodInput>) => setF({ ...f, ...patch });
  return (
    <Sheet title={food ? `Edit ${food.name}` : 'New saved food'} onClose={onClose} testId="food-sheet">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" htmlFor={nameId}>
          <input id={nameId} className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} data-testid="food-name" />
        </Field>
        <Field label="Other names" htmlFor={aliasId} hint='Comma-separated, e.g. "my usual dal, dal". The estimate matches these.'>
          <input id={aliasId} className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} data-testid="food-aliases" />
        </Field>
        <div className="grid-2">
          <Field label="Serving" htmlFor={servId}>
            <input id={servId} className="input" value={f.servingDesc} onChange={(e) => set({ servingDesc: e.target.value })} data-testid="food-serving" />
          </Field>
          <NumberInput label="Serving weight" unit="g" value={f.servingG} onChange={(v) => set({ servingG: v ?? 0 })} testId="food-grams" />
        </div>
        <p className="small muted">Per serving, from the label or the tables:</p>
        <div className="grid-2">
          <NumberInput label="Calories" unit="kcal" value={f.kcal} onChange={(v) => set({ kcal: v ?? 0 })} testId="food-kcal" />
          <NumberInput label="Protein" unit="g" value={f.protein_g} onChange={(v) => set({ protein_g: v ?? 0 })} testId="food-protein" />
          <NumberInput label="Carbs" unit="g" value={f.carbs_g} onChange={(v) => set({ carbs_g: v ?? 0 })} testId="food-carbs" />
          <NumberInput label="Fat" unit="g" value={f.fat_g} onChange={(v) => set({ fat_g: v ?? 0 })} testId="food-fat" />
          <NumberInput label="Fiber" unit="g" value={f.fiber_g} onChange={(v) => set({ fiber_g: v ?? 0 })} testId="food-fiber" />
        </div>
        <Segmented
          label="Who it's for"
          testId="food-scope"
          value={f.household ? 'household' : 'mine'}
          onChange={(v) => set({ household: v === 'household' })}
          options={[
            { value: 'household', label: 'Household' },
            { value: 'mine', label: 'Just me' },
          ]}
        />
        {save.error && <Banner tone="error">{save.error instanceof Error ? save.error.message : String(save.error)}</Banner>}
        <button className="btn btn-primary" disabled={!f.name.trim() || save.isPending} data-testid="food-save">
          Save
        </button>
        {food && (
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            disabled={del.isPending}
            onClick={() => window.confirm(`Delete ${food.name}? Meals already logged keep their numbers.`) && del.mutate()}
            data-testid={`food-delete-${food.id}`}
          >
            Delete {food.name}
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function Foods() {
  const pid = usePid();
  const { current } = useProfiles();
  const { data: foods, error, isLoading } = useQuery({ queryKey: ['foods', pid], queryFn: () => api.foods(pid) });
  const [editing, setEditing] = useState<MyFood | 'new' | null>(null);
  if (isLoading) return <Loading />;
  if (error || !foods) return <ErrorNote error={error} />;
  const household = foods.filter((f) => f.household);
  const mine = foods.filter((f) => !f.household);
  // One tappable row per food; editing and deleting happen in the sheet.
  const list = (items: MyFood[], testId: string) =>
    items.length === 0 ? (
      <p className="muted small">None yet.</p>
    ) : (
      <div className="food-list" data-testid={testId}>
        {items.map((f) => (
          <button key={f.id} type="button" className="food-row" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`} data-testid={`food-edit-${f.id}`}>
            <span className="food-main" data-testid={`food-${f.id}`}>
              <span className="food-name">{f.name}</span>
              <span className="food-meta">
                {f.servingDesc}, {f.servingG} g, {num1(f.protein_g)} g protein
              </span>
            </span>
            <span className="food-kcal">
              {kcal(f.kcal)}
              <small>kcal</small>
            </span>
            <ChevronRight width={16} height={16} className="icon food-go" />
          </button>
        ))}
      </div>
    );
  return (
    <>
      <div className="page-head">
        <h1>My foods</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')} data-testid="food-new">
          + New
        </button>
      </div>
      <p className="small muted">Dishes you eat often, with real numbers. Estimates use them when the name matches, and Add meal logs them in one tap.</p>
      <Card title="Household" subtitle="Everyone sees these; each person logs their own portion" testId="foods-household">
        {list(household, 'foods-household-list')}
      </Card>
      <Card title={`Just ${current?.name}`} testId="foods-mine">
        {list(mine, 'foods-mine-list')}
      </Card>
      {editing && <FoodSheet pid={pid} food={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
