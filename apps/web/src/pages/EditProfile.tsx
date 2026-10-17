import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile } from '@katori/shared';
import { api } from '../api';
import { Banner, Card, ErrorNote, Loading } from '../components/ui';
import { kcal } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid } from '../profile';
import { ActivityFields, AiFields, BasicsFields, DietFields, draftFromProfile, GoalFields, NameFields, problems, type Draft } from './profile-form';

function Form({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftFromProfile(profile));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setError(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const save = useMutation({
    // Read the daily target either side of the save, so the toast can say when it moved.
    mutationFn: async () => {
      const before = (await api.targets(profile.id)).current?.kcal ?? null;
      await saveProfile();
      const after = (await api.targets(profile.id)).current?.kcal ?? null;
      return { before, after };
    },
    onSuccess: ({ before, after }) => {
      toast(after != null && after !== before ? `Profile saved. Daily target now ${kcal(after)} kcal` : 'Profile saved');
      void qc.invalidateQueries();
      navigate('/settings');
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  function saveProfile() {
    return api.updateProfile(profile.id, {
      name: d.name.trim(),
      colour: d.colour,
      sex: d.sex!,
      birthDate: d.birthDate,
      heightCm: Math.round(d.heightCm! * 10) / 10,
      goal: d.goal,
      goalWeightKg: d.goalWeightKg,
      paceKgWeek: d.goal === 'maintain' ? 0 : d.paceKgWeek,
      jobType: d.jobType,
      workoutsPerWeek: d.workoutsPerWeek,
      activity: d.activity,
      diet: { vegetarian: d.vegetarian, eggs: d.vegetarian ? d.eggs : true },
      mealSlots: d.mealSlots,
      specialStatus: d.sex === 'female' ? d.specialStatus : 'none',
      aiAccess: d.aiAccess,
    });
  }
  const submit = () => {
    for (const step of ['name', 'basics', 'goal', 'diet'] as const) {
      const p = problems(d, step);
      if (p) return setError(p);
    }
    save.mutate();
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="edit-profile-form"
    >
      <Card title="About">
        <div className="form">
          <NameFields d={d} set={set} />
          <BasicsFields d={d} set={set} />
        </div>
      </Card>
      <Card title="Goal">
        <div className="form">
          <GoalFields d={d} set={set} />
        </div>
      </Card>
      <Card title="Activity">
        <div className="form">
          <ActivityFields d={d} set={set} />
        </div>
      </Card>
      <Card title="Diet and eating windows">
        <div className="form">
          <DietFields d={d} set={set} />
        </div>
      </Card>
      <Card title="AI access">
        <AiFields d={d} set={set} />
      </Card>
      <p className="small muted">Changes to sex, age, height, goal, pace or activity recalculate the targets. Weight and tape measurements live on Body.</p>
      {error && <Banner tone="error" testId="edit-error">{error}</Banner>}
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => navigate('/settings')}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending} data-testid="edit-save">
          Save
        </button>
      </div>
    </form>
  );
}

export function EditProfile() {
  const pid = usePid();
  const { data, error, isLoading } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <>
      <div className="page-head">
        <h1>Edit {data.name}</h1>
      </div>
      <Form key={data.id} profile={data} />
    </>
  );
}
