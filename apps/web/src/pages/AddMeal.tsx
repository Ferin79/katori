import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { slotForTime, toLocalDateTime } from '@katori/shared';
import { api } from '../api';
import { CameraIcon, ImageIcon, XIcon } from '../components/Icons';
import { Banner, Card, ErrorNote, Field, Loading, Stepper } from '../components/ui';
import { initials, kcal } from '../lib/format';
import { resizePhoto } from '../lib/image';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

export function AddMeal() {
  const pid = usePid();
  const { profiles } = useProfiles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const noteId = useId();
  const whenId = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const { data: profile, error, isLoading } = useQuery({ queryKey: ['profile', pid], queryFn: () => api.profile(pid) });
  const { data: quick = [] } = useQuery({ queryKey: ['quickFoods', pid], queryFn: () => api.quickFoods(pid) });

  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState('');
  const [eatenAt, setEatenAt] = useState(() => toLocalDateTime(new Date()));
  const [slot, setSlot] = useState<string | null>(null);
  const [portion, setPortion] = useState(1);
  const [alsoFor, setAlsoFor] = useState<Record<string, number>>({});

  // Slot picked from the time of day, until the person picks one.
  const autoSlot = profile ? slotForTime(profile.mealSlots, eatenAt.slice(11, 16)) : null;
  const chosenSlot = slot ?? autoSlot ?? 'Meal';

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPreparing(true);
    try {
      const blob = await resizePhoto(file);
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  };

  const add = useMutation({
    mutationFn: () =>
      api.addMeal(
        pid,
        { note: note.trim(), slot: chosenSlot, eatenAt, portion, alsoFor: Object.entries(alsoFor).map(([profileId, p]) => ({ profileId, portion: p })) },
        photo,
      ),
    onSuccess: (meals) => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/meal/${meals[0]!.id}`);
    },
  });

  const quickAdd = useMutation({
    mutationFn: (food: { id: number; name: string }) => api.quickAdd(pid, food.id, chosenSlot, eatenAt),
    onSuccess: (m) => {
      toast(`Logged ${m.items[0]?.name ?? 'it'} · ${kcal(m.totals.kcal)} kcal`);
      void qc.invalidateQueries();
      navigate('/');
    },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), 'error'),
  });

  if (isLoading) return <Loading />;
  if (error || !profile) return <ErrorNote error={error} />;

  const manual = profile.aiAccess === 'manual';
  const others = profiles.filter((p) => p.id !== pid);
  const canSubmit = Boolean(photo || note.trim() || manual) && !preparing && !add.isPending;

  return (
    <>
      <div className="page-head">
        <h1>Add meal</h1>
        <span className="sub">{profile.name}</span>
      </div>

      {quick.length > 0 && (
        <Card title="Quick add" subtitle="One tap logs a saved food" testId="quick-add">
          <div className="chip-group">
            {quick.map((f) => (
              <button key={f.id} className="chip" onClick={() => quickAdd.mutate(f)} disabled={quickAdd.isPending} data-testid={`quick-${f.id}`} aria-label={`Log ${f.name}, ${f.servingDesc}, ${f.kcal} kcal`}>
                {f.name} <span className="muted">{kcal(f.kcal)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) add.mutate();
        }}
        data-testid="add-meal-form"
      >
        <div className="field">
          <span className="label">Photo</span>
          {preview ? (
            <div style={{ position: 'relative' }}>
              <img src={preview} alt="Meal to log" className="photo-preview" data-testid="photo-preview" />
              <button
                type="button"
                className="btn btn-sm"
                style={{ position: 'absolute', top: 8, right: 8 }}
                onClick={() => {
                  setPhoto(null);
                  setPreview(null);
                }}
                aria-label="Remove photo"
                data-testid="photo-remove"
              >
                <XIcon />
              </button>
            </div>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => cameraRef.current?.click()} data-testid="photo-camera" disabled={preparing}>
                <CameraIcon /> Take photo
              </button>
              <button type="button" className="btn" onClick={() => galleryRef.current?.click()} data-testid="photo-gallery" disabled={preparing}>
                <ImageIcon /> Gallery
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-input-camera" aria-label="Take a photo" />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-input" aria-label="Choose a photo" />
          {preparing && <span className="hint">Preparing photo…</span>}
          {photoError && <span className="delta-bad small">{photoError}</span>}
        </div>

        <Field label="Note" htmlFor={noteId} hint='Counts beat the photo: "2 rotis, 1 katori dal, little ghee", "no oil", "half katori rice".'>
          <input id={noteId} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="2 rotis, 1 katori dal, little ghee" data-testid="meal-note" />
        </Field>

        <div className="field">
          <span className="label">Meal</span>
          <div className="chip-group" role="group" aria-label="Meal slot">
            {profile.mealSlots.map((s) => (
              <button key={s.name} type="button" className="chip" aria-pressed={chosenSlot === s.name} onClick={() => setSlot(s.name)} data-testid={`slot-chip-${s.name}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <Field label="When" htmlFor={whenId}>
          <input id={whenId} className="input" type="datetime-local" value={eatenAt} max={toLocalDateTime(new Date())} onChange={(e) => e.target.value && setEatenAt(e.target.value.slice(0, 16))} data-testid="meal-when" />
        </Field>

        {others.length > 0 && (
          <div className="field">
            <span className="label">Also for</span>
            <span className="hint">Log this plate for others too, each with their own portion of what's shown.</span>
            <div className="stack" data-testid="also-for">
              {others.map((p) => {
                const on = alsoFor[p.id] != null;
                return (
                  <div className="row between" key={p.id}>
                    <label className="row" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setAlsoFor((a) => (e.target.checked ? { ...a, [p.id]: 1 } : Object.fromEntries(Object.entries(a).filter(([k]) => k !== p.id))))}
                        data-testid={`also-${p.id}`}
                        style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                      />
                      <span className="pchip" style={{ ['--chip-colour' as string]: p.colour, pointerEvents: 'none', minHeight: 32 }}>
                        <span className="avatar" style={{ width: 24, height: 24 }}>
                          {initials(p.name)}
                        </span>
                        {p.name}
                      </span>
                    </label>
                    {on && <Stepper label={`${p.name}'s portion`} value={alsoFor[p.id]!} onChange={(v) => setAlsoFor((a) => ({ ...a, [p.id]: v }))} testId={`also-portion-${p.id}`} />}
                  </div>
                );
              })}
              {Object.keys(alsoFor).length > 0 && (
                <div className="row between">
                  <span className="small">My portion</span>
                  <Stepper label="My portion" value={portion} onChange={setPortion} testId="my-portion" />
                </div>
              )}
            </div>
          </div>
        )}

        {manual && <Banner tone="info">This profile logs by hand: the next screen starts from any saved foods named in the note.</Banner>}
        {add.error && <Banner tone="error" testId="add-error">{add.error instanceof Error ? add.error.message : String(add.error)}</Banner>}

        <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit} data-testid="meal-submit">
          {add.isPending ? 'Saving…' : manual ? 'Save meal' : photo ? 'Estimate from photo' : 'Estimate from note'}
        </button>
      </form>
    </>
  );
}
