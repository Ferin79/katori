import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { slotForTime, toLocalDateTime } from '@katori/shared';
import { api } from '../api';
import { CameraIcon, ImageIcon, XIcon } from '../components/Icons';
import { Banner, Card, ErrorNote, Field, Loading, Stepper } from '../components/ui';
import { initials, kcal } from '../lib/format';
import { resizePhoto } from '../lib/image';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';

const PHRASES = ['2 rotis', '1 katori dal', '1 katori rice', 'sabzi', 'salad', 'little ghee', 'no oil', 'half portion'];

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
  // From a past day on Home (?date=YYYY-MM-DD): same clock time, on that day.
  const [params] = useSearchParams();
  const [eatenAt, setEatenAt] = useState(() => {
    const now = toLocalDateTime(new Date());
    const day = params.get('date');
    return day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < now.slice(0, 10) ? `${day}T${now.slice(11)}` : now;
  });
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
      toast(`Logged ${m.items[0]?.name ?? 'it'}, ${kcal(m.totals.kcal)} kcal`);
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

  const addPhrase = (p: string) => setNote((n) => (n.trim() ? `${n.trim().replace(/,$/, '')}, ${p}` : p));

  return (
    <>
      <div className="page-head">
        <h1>Add meal</h1>
        <span className="sub">for {profile.name}</span>
      </div>

      {quick.length > 0 && (
        <Card title="Quick add" subtitle="One tap logs a saved food" testId="quick-add">
          <div className="chip-scroll">
            {quick.map((f) => (
              <button key={f.id} className="chip" onClick={() => quickAdd.mutate(f)} disabled={quickAdd.isPending} data-testid={`quick-${f.id}`} aria-label={`Log ${f.name}, ${f.servingDesc}, ${f.kcal} kcal`}>
                {f.name} <span className="muted">{kcal(f.kcal)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) add.mutate();
        }}
        data-testid="add-meal-form"
      >
        <section className="card" aria-label="Photo">
          {preview ? (
            <div style={{ position: 'relative' }}>
              <img src={preview} alt="Meal to log" className="photo-preview" data-testid="photo-preview" />
              <button
                type="button"
                className="btn btn-sm"
                style={{ position: 'absolute', top: 10, right: 10, background: 'var(--surface)' }}
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
            <div className="photo-zone">
              <button type="button" className="take" onClick={() => cameraRef.current?.click()} data-testid="photo-camera" disabled={preparing}>
                <CameraIcon />
                Take a photo
                <small>Of the plate, from above</small>
              </button>
              <button type="button" className="btn btn-ghost library" onClick={() => galleryRef.current?.click()} data-testid="photo-gallery" disabled={preparing}>
                <ImageIcon /> Choose from library
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-input-camera" aria-label="Take a photo" />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-input" aria-label="Choose a photo" />
          {preparing && <p className="small muted" style={{ marginTop: 8 }}>Preparing photo…</p>}
          {photoError && <p className="small delta-bad" style={{ marginTop: 8 }}>{photoError}</p>}
        </section>

        <section className="card form" aria-label="Note">
          <Field label="What's on the plate" htmlFor={noteId} hint="Counts and cooking fat help most. Your note wins over the photo.">
            <input id={noteId} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="2 rotis, 1 katori dal, little ghee" data-testid="meal-note" />
          </Field>
          <div className="suggest" role="group" aria-label="Add a common phrase">
            {PHRASES.map((p, i) => (
              <button key={p} type="button" onClick={() => addPhrase(p)} data-testid={`phrase-${i}`}>
                + {p}
              </button>
            ))}
          </div>
        </section>

        <section className="card form" aria-label="When">
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
        </section>

        {others.length > 0 && (
          <section className="card" aria-label="Also for">
            <div className="card-head">
              <div>
                <h2>Also for</h2>
                <div className="subtitle">Log this plate for others too, each with their own portion of what's shown.</div>
              </div>
            </div>
            <div className="list" data-testid="also-for">
              {others.map((p) => {
                const on = alsoFor[p.id] != null;
                return (
                  <div className="list-item" key={p.id} style={{ minHeight: 56 }}>
                    <label className="row grow" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setAlsoFor((a) => (e.target.checked ? { ...a, [p.id]: 1 } : Object.fromEntries(Object.entries(a).filter(([k]) => k !== p.id))))}
                        data-testid={`also-${p.id}`}
                        style={{ width: 22, height: 22, accentColor: 'var(--primary)' }}
                      />
                      <span className="pchip" style={{ ['--chip-colour' as string]: p.colour, pointerEvents: 'none', minHeight: 32, padding: '0 6px 0 0' }}>
                        <span className="avatar" style={{ width: 28, height: 28 }}>
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
                <div className="list-item" style={{ minHeight: 56 }}>
                  <span className="grow">My portion</span>
                  <Stepper label="My portion" value={portion} onChange={setPortion} testId="my-portion" />
                </div>
              )}
            </div>
          </section>
        )}

        {manual && <Banner tone="info">This profile logs by hand: the next screen starts from any saved foods named in the note.</Banner>}
        {add.error && <Banner tone="error" testId="add-error">{add.error instanceof Error ? add.error.message : String(add.error)}</Banner>}

        <div className="sticky-actions">
          <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit} data-testid="meal-submit">
            {add.isPending ? 'Saving…' : manual ? 'Save meal' : photo ? 'Estimate from photo' : 'Estimate from note'}
          </button>
        </div>
      </form>
    </>
  );
}
