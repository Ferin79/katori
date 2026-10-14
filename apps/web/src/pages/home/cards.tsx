import { useState } from 'react';
import { Link } from 'react-router';
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { Dashboard, Meal } from '@katori/shared';
import { api } from '../../api';
import { axisProps, C, dayMs, first, gridProps, Legend, msToDate, niceTicks, Tip, type TipProps } from '../../components/charts';
import { ArcGauge, MiniRing } from '../../components/Meters';
import { BowlIcon, FlameIcon, PlusIcon } from '../../components/Icons';
import { Card, ChartCard, MiniStats, SectionHead } from '../../components/ui';
import { clock, compact, dayMonth, dayShort, fullDate, kcal, kg, longDate, num1, pct, signed } from '../../lib/format';

type D = Dashboard;

const weekday = (date: string) => new Date(`${date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' });

export function TodayCard({ d, isToday }: { d: D; isToday: boolean }) {
  const t = d.target;
  const eaten = d.today.totals.kcal;
  const left = d.today.remainingKcal;
  const over = left != null && left < 0;
  return (
    <section className="card goal-card" data-testid="card-today" aria-label={isToday ? "Today's goal" : weekday(d.date)}>
      <div className="goal-top">
        <h2>{isToday ? "Today's goal" : weekday(d.date)}</h2>
        <span className="date">
          {dayShort(d.date)}, {dayMonth(d.date)}
        </span>
      </div>
      <ArcGauge value={eaten} target={t?.kcal ?? null} label={`Calories: ${kcal(eaten)} of ${t ? `${kcal(t.kcal)} kcal` : 'no target'}`} testId="gauge">
        <span className="flame">
          <FlameIcon />
        </span>
        {left != null ? (
          <div data-testid="today-left" className={over ? 'over' : undefined}>
            <span className="big" style={{ display: 'block' }}>
              {kcal(Math.abs(left))}
            </span>{' '}
            <span className="lbl">{over ? 'kcal over' : 'kcal left'}</span>
          </div>
        ) : (
          <div>
            <span className="big" style={{ display: 'block' }}>
              {kcal(eaten)}
            </span>{' '}
            <span className="lbl">kcal eaten</span>
          </div>
        )}
      </ArcGauge>
      <div className="goal-figures">
        <div className="fig">
          <div className="k">Eaten</div>
          <div className="v">
            <span data-testid="today-kcal">{kcal(eaten)}</span>
            <small>kcal</small>
          </div>
        </div>
        <div className="fig">
          <div className="k">Daily target</div>
          <div className="v" data-testid="today-target">
            {t ? kcal(t.kcal) : '–'}
            <small>kcal</small>
          </div>
        </div>
      </div>
    </section>
  );
}

/** One tile per macro: grams left (or over) against the target, with a small ring. */
export function MacroTiles({ d }: { d: D }) {
  const t = d.target;
  const x = d.today.totals;
  const tiles = [
    { key: 'protein', name: 'Protein', value: x.protein_g, target: t?.protein_g ?? null, colour: C.protein, track: 'var(--s-protein-track)' },
    { key: 'carbs', name: 'Carbs', value: x.carbs_g, target: t?.carbs_g ?? null, colour: C.carbs, track: 'var(--s-carbs-track)' },
    { key: 'fat', name: 'Fat', value: x.fat_g, target: t?.fat_g ?? null, colour: C.fat, track: 'var(--s-fat-track)' },
    { key: 'fiber', name: 'Fiber', value: x.fiber_g, target: t?.fiber_g ?? null, colour: C.fiber, track: 'var(--s-fiber-track)' },
  ];
  // Tap any tile to flip the row between grams left and grams eaten so far.
  const [showEaten, setShowEaten] = useState(false);
  return (
    <div className="macro-tiles" data-testid="card-macros" role="group" aria-label="Macros">
      {tiles.map((m) => {
        const left = m.target != null ? m.target - m.value : null;
        const over = left != null && left < 0;
        const eatenView = showEaten || left == null;
        const shown = eatenView ? m.value : Math.abs(left ?? 0);
        const word = eatenView ? 'eaten' : over ? 'over' : 'left';
        return (
          <button
            key={m.key}
            type="button"
            className={`macro-tile${over && !eatenView ? ' over' : ''}`}
            data-testid={`macro-${m.key}`}
            data-view={eatenView ? 'eaten' : 'left'}
            aria-pressed={showEaten}
            aria-label={`${m.name}: ${Math.round(shown)} g ${word}${m.target != null ? ` of ${m.target} g` : ''}. Tap to show ${showEaten ? 'grams left' : 'grams eaten'}.`}
            onClick={() => setShowEaten((v) => !v)}
          >
            <span className="v">{Math.round(shown)}g</span>
            <span className="l">
              {m.name} {word}
            </span>
            <MiniRing frac={m.target ? m.value / m.target : 0} colour={m.colour} track={m.track} over={over} />
          </button>
        );
      })}
    </div>
  );
}

const STATUS_LABEL: Record<Meal['status'], string> = { pending: 'Estimating', estimated: 'To review', confirmed: 'Confirmed', failed: 'Failed' };

export function StatusBadge({ status }: { status: Meal['status'] }) {
  return (
    <span className={`badge badge-status-${status}`} data-testid={`status-${status}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MealRow({ pid, m }: { pid: string; m: Meal }) {
  const [broken, setBroken] = useState(false);
  const counted = m.status === 'confirmed' || m.status === 'estimated';
  return (
    <Link to={`/meal/${m.id}`} className="list-item" data-testid={`meal-row-${m.id}`}>
      {m.hasPhoto && !broken ? (
        <img className="thumb" src={api.mealPhotoUrl(pid, m.id)} alt="" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <span className="thumb">
          <BowlIcon />
        </span>
      )}
      <div className="grow">
        <div className="title">
          {m.slot}
          <span className="time">{clock(m.eatenAt)}</span>
        </div>
        <div className="meta">{m.items.length ? m.items.map((i) => i.name).join(', ') : m.note || 'No items yet'}</div>
      </div>
      <div className="end">
        {counted && (
          <span className="kcal">
            {kcal(m.totals.kcal)}
            <span className="muted small"> kcal</span>
          </span>
        )}
        {m.status !== 'confirmed' && <StatusBadge status={m.status} />}
      </div>
    </Link>
  );
}

export function TodayMealsCard({ pid, d, isToday }: { pid: string; d: D; isToday: boolean }) {
  // A past day's Add starts the meal on that day.
  const addTo = isToday ? '/add' : `/add?date=${d.date}`;
  const title = isToday ? "Today's meals" : `Meals on ${dayShort(d.date)} ${dayMonth(d.date)}`;
  return (
    <>
      <SectionHead
        title={title}
        action={
          <Link to={addTo} className="btn btn-sm btn-outline" data-testid="today-add-meal">
            <PlusIcon width={18} height={18} /> Add
          </Link>
        }
      />
      {d.today.meals.length === 0 ? (
        <section className="card" data-testid="card-meals" aria-label={title}>
          <div className="empty" style={{ padding: '10px 0' }}>
            <p>{isToday ? 'Nothing logged yet today.' : 'Nothing logged on this day.'}</p>
            <Link to={addTo} className="btn btn-primary btn-sm">
              Log a meal
            </Link>
          </div>
        </section>
      ) : (
        <section className="meal-list" data-testid="card-meals" aria-label={title}>
          {d.today.meals.map((m) => (
            <MealRow key={m.id} pid={pid} m={m} />
          ))}
        </section>
      )}
    </>
  );
}

export function Last7Card({ d }: { d: D }) {
  const data = d.last7.days.map((x) => ({ ...x, label: dayShort(x.date) }));
  const ticks = niceTicks(Math.max(...data.map((x) => Math.max(x.kcal, x.targetKcal ?? 0))));
  return (
    <ChartCard
      title="Last 7 days"
      subtitle={d.last7.avgKcal == null ? 'No complete days yet' : undefined}
      testId="card-last7"
      table={{ head: ['Day', 'kcal', 'Target'], rows: d.last7.days.map((x) => [`${dayShort(x.date)} ${dayMonth(x.date)}`, x.meals ? kcal(x.kcal) : '–', kcal(x.targetKcal)]) }}
    >
      {d.last7.avgKcal != null && (
        <MiniStats
          items={[
            { k: '7-day average', v: kcal(d.last7.avgKcal), u: 'kcal' },
            ...(d.target ? [{ k: 'Target', v: kcal(d.target.kcal), u: 'kcal' }] : []),
          ]}
        />
      )}
      <div className="chart">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} axisLine={false} tickFormatter={compact} width={44} ticks={ticks} domain={[0, ticks.at(-1)!]} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(p: TipProps<(typeof data)[number]>) =>
                first(p) ? (
                  <Tip
                    head={fullDate(first(p)!.date)}
                    rows={[
                      { label: 'eaten', value: `${kcal(first(p)!.kcal)} kcal`, colour: C.kcal },
                      { label: 'target', value: `${kcal(first(p)!.targetKcal)} kcal`, colour: C.ink2 },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="kcal" fill={C.kcal} radius={[6, 6, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Line dataKey="targetKcal" type="stepAfter" stroke={C.ink2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {d.last7.avgKcal != null && <ReferenceLine y={d.last7.avgKcal} stroke={C.kcal} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="4 4" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { label: 'Calories eaten', colour: C.kcal, kind: 'rect' },
          { label: 'Target', colour: C.ink2, kind: 'line' },
          { label: '7-day average', colour: C.kcal, kind: 'line' },
        ]}
      />
    </ChartCard>
  );
}

export function WeightCard({ d }: { d: D }) {
  const w = d.weight;
  if (!w.points.length) {
    return (
      <Card title="Weight trend" testId="card-weight">
        <p className="muted">
          Log a morning weigh-in on <Link to="/body">Body</Link> to start the trend.
        </p>
      </Card>
    );
  }
  const data = w.points.map((p) => ({ ...p, t: dayMs(p.date) }));
  const values = data.flatMap((p) => [p.weightKg, p.trendKg]).concat(w.goalKg != null ? [w.goalKg] : []);
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  return (
    <ChartCard
      title="Weight trend"
      testId="card-weight"
      table={{ head: ['Date', 'Weigh-in', 'Trend'], rows: [...w.points].reverse().map((p) => [dayMonth(p.date), kg(p.weightKg), kg(p.trendKg)]) }}
    >
      <MiniStats
        testId="weight-figures"
        items={[
          ...(w.currentTrendKg != null ? [{ k: 'Trend', v: num1(w.currentTrendKg), u: 'kg' }] : []),
          ...(w.weeklyRateKg != null ? [{ k: 'Per week', v: signed(w.weeklyRateKg), u: 'kg' }] : []),
          ...(w.projectedGoalDate ? [{ k: 'Goal by', v: longDate(w.projectedGoalDate) }] : []),
        ]}
      />
      <div className="chart chart-tall">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={msToDate} {...axisProps} minTickGap={24} />
            <YAxis domain={[lo, hi]} {...axisProps} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: C.axis }}
              content={(p: TipProps<(typeof data)[number]>) =>
                first(p) ? (
                  <Tip
                    head={fullDate(first(p)!.date)}
                    rows={[
                      { label: 'trend', value: kg(first(p)!.trendKg), colour: C.weight },
                      { label: 'weigh-in', value: kg(first(p)!.weightKg), colour: C.neutral },
                    ]}
                  />
                ) : null
              }
            />
            {w.goalKg != null && <ReferenceLine y={w.goalKg} stroke={C.ink2} strokeWidth={1} label={{ value: `Goal ${w.goalKg} kg`, position: 'insideBottomRight', fill: C.ink2, fontSize: 11 }} />}
            <Scatter dataKey="weightKg" fill={C.neutral} isAnimationActive={false} shape={(props: { cx?: number; cy?: number }) => <circle cx={props.cx} cy={props.cy} r={3} fill={C.neutral} />} />
            <defs>
              <linearGradient id="wfill-home" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.weight} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C.weight} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area dataKey="trendKg" type="monotone" stroke="none" fill="url(#wfill-home)" isAnimationActive={false} activeDot={false} />
            <Line dataKey="trendKg" type="monotone" stroke={C.weight} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { label: 'Trend (smoothed)', colour: C.weight, kind: 'line' },
          { label: 'Daily weigh-in', colour: C.neutral, kind: 'dot' },
          ...(w.goalKg != null ? [{ label: 'Goal', colour: C.ink2, kind: 'line' as const }] : []),
        ]}
      />
    </ChartCard>
  );
}

export function EnergyCard({ d }: { d: D }) {
  const e = d.energy;
  const rows = [
    { key: 'intake', name: `Average intake (${e.loggedDays} of last ${e.windowDays} days)`, value: e.avgIntakeKcal },
    { key: 'formula', name: 'Maintenance (formula)', value: e.formulaMaintenance },
    { key: 'learned', name: 'Maintenance (learned from your trend)', value: e.learnedMaintenance },
  ].filter((r): r is { key: string; name: string; value: number } => r.value != null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const maint = e.learnedMaintenance ?? e.formulaMaintenance;
  const gap = e.avgIntakeKcal != null && maint != null ? e.avgIntakeKcal - maint : null;
  return (
    <Card
      title="Energy balance"
      subtitle={
        gap != null
          ? `Eating about ${kcal(Math.abs(gap))} kcal a day ${gap < 0 ? 'below' : 'above'} maintenance ≈ ${num1(Math.abs((gap * 7) / 7700))} kg a week ${gap < 0 ? 'down' : 'up'}.`
          : e.learnedMaintenance == null
            ? 'Learned maintenance appears after 3 weeks of logging.'
            : undefined
      }
      testId="card-energy"
    >
      <div className="bar-rows">
        {rows.map((r) => (
          <div className="bar-row" key={r.key} data-testid={`energy-${r.key}`}>
            <div className="top">
              <span className="key">{r.name}</span>
              <span className="val">{kcal(r.value)} kcal</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: C.kcal }} />
            </div>
          </div>
        ))}
        {!rows.length && <p className="muted">Log a few days of meals to see this.</p>}
      </div>
    </Card>
  );
}

function deltaClass(n: number | null, goodWhenDown: boolean) {
  if (n == null || n === 0) return '';
  return (n < 0) === goodWhenDown ? 'delta-good' : 'delta-bad';
}

export function BodyCompCard({ d }: { d: D }) {
  if (!d.body) return null;
  const pts = d.body.points;
  if (!pts.length) {
    return (
      <Card title="Body composition" testId="card-bodycomp">
        <p className="muted">
          Add neck and waist measurements (and hips for women) on <Link to="/body">Body</Link> for a Navy body fat estimate.
        </p>
      </Card>
    );
  }
  const start = pts[0]!;
  const last = pts.at(-1)!;
  const data = pts.map((p) => ({ ...p, t: dayMs(p.date) }));
  return (
    <ChartCard
      title="Body composition"
      subtitle="US Navy estimate from tape measurements; read the trend, not one reading"
      testId="card-bodycomp"
      table={{ head: ['Date', 'Body fat', 'Fat mass', 'Lean mass'], rows: [...pts].reverse().map((p) => [dayMonth(p.date), pct(p.bodyFatPct), kg(p.fatMassKg), kg(p.leanMassKg)]) }}
    >
      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat" data-testid="bf-latest">
          <div className="label">Body fat</div>
          <div className="value">{pct(last.bodyFatPct)}</div>
          <div className={`note ${deltaClass(last.bodyFatPct - start.bodyFatPct, true)}`}>{pts.length > 1 ? `${signed(last.bodyFatPct - start.bodyFatPct, ' pts')} since ${dayMonth(start.date)}` : 'first reading'}</div>
        </div>
        <div className="stat">
          <div className="label">Fat mass</div>
          <div className="value">{kg(last.fatMassKg)}</div>
          <div className={`note ${deltaClass(last.fatMassKg - start.fatMassKg, true)}`}>{pts.length > 1 ? signed(last.fatMassKg - start.fatMassKg, ' kg') : ''}</div>
        </div>
        <div className="stat">
          <div className="label">Lean mass</div>
          <div className="value">{kg(last.leanMassKg)}</div>
          <div className={`note ${deltaClass(last.leanMassKg - start.leanMassKg, false)}`}>{pts.length > 1 ? signed(last.leanMassKg - start.leanMassKg, ' kg') : ''}</div>
        </div>
      </div>
      {pts.length > 1 && (
        <div className="chart" style={{ height: 160 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={msToDate} {...axisProps} minTickGap={24} />
              <YAxis domain={['dataMin - 1', 'dataMax + 1']} {...axisProps} axisLine={false} width={40} tickFormatter={(v: number) => `${Math.round(v)}%`} />
              <Tooltip
                content={(p: TipProps<(typeof data)[number]>) =>
                  first(p) ? <Tip head={fullDate(first(p)!.date)} rows={[{ label: 'body fat', value: pct(first(p)!.bodyFatPct), colour: C.bf }]} /> : null
                }
              />
              <Line dataKey="bodyFatPct" stroke={C.bf} strokeWidth={2} dot={{ r: 4, fill: C.bf, stroke: C.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function WaistCard({ d }: { d: D }) {
  const w = d.waist;
  const data = w.points.map((p) => ({ ...p, t: dayMs(p.date) }));
  return (
    <ChartCard
      title="Waist and ratios"
      subtitle="Belly progress when the scale stalls"
      testId="card-waist"
      table={w.points.length ? { head: ['Date', 'Waist'], rows: [...w.points].reverse().map((p) => [dayMonth(p.date), `${num1(p.waistCm)} cm`]) } : null}
    >
      <div className="stats" style={{ marginBottom: w.points.length > 1 ? 12 : 0 }}>
        <div className="stat" data-testid="waist-latest">
          <div className="label">Waist</div>
          <div className="value">{w.latest.waistCm != null ? `${num1(w.latest.waistCm)} cm` : '–'}</div>
        </div>
        <div className="stat" data-testid="whtr">
          <div className="label">Waist ÷ height</div>
          <div className="value">{w.latest.waistToHeight != null ? w.latest.waistToHeight.toFixed(2) : '–'}</div>
          {w.latest.waistToHeight != null && <div className="note">{w.latest.waistToHeight < 0.5 ? 'under 0.5 ✓' : 'aim for under 0.5'}</div>}
        </div>
        {w.latest.waistToHip != null && (
          <div className="stat" data-testid="whr">
            <div className="label">Waist ÷ hip</div>
            <div className="value">{w.latest.waistToHip.toFixed(2)}</div>
          </div>
        )}
        <div className="stat" data-testid="bmi">
          <div className="label">BMI</div>
          <div className="value">{num1(w.latest.bmi)}</div>
          {w.latest.bmiCategory && <div className="note">{w.latest.bmiCategory}</div>}
        </div>
      </div>
      {w.points.length > 1 && (
        <div className="chart" style={{ height: 150 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={msToDate} {...axisProps} minTickGap={24} />
              <YAxis domain={['dataMin - 1', 'dataMax + 1']} {...axisProps} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={(p: TipProps<(typeof data)[number]>) => (first(p) ? <Tip head={fullDate(first(p)!.date)} rows={[{ label: 'waist', value: `${num1(first(p)!.waistCm)} cm`, colour: C.waist }]} /> : null)} />
              <Line dataKey="waistCm" stroke={C.waist} strokeWidth={2} dot={{ r: 4, fill: C.waist, stroke: C.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function ProteinCard({ d }: { d: D }) {
  const p = d.protein;
  const meter = (hit: number, of: number) => (
    <div className="bar-track" role="meter" aria-valuemin={0} aria-valuemax={of} aria-valuenow={hit}>
      <div className="bar-fill" style={{ width: `${of ? (hit / of) * 100 : 0}%`, background: C.protein }} />
    </div>
  );
  return (
    <Card title="Protein consistency" subtitle={p.targetG ? `Days within 5% of ${p.targetG} g` : undefined} testId="card-protein">
      <div className="bar-rows">
        <div className="bar-row" data-testid="protein-week">
          <div className="top">
            <span className="key">This week</span>
            <span className="val">
              {p.weekHit} of {p.weekDays} days
            </span>
          </div>
          {meter(p.weekHit, p.weekDays)}
        </div>
        <div className="bar-row" data-testid="protein-month">
          <div className="top">
            <span className="key">This month</span>
            <span className="val">
              {p.monthHit} of {p.monthDays} days
            </span>
          </div>
          {meter(p.monthHit, p.monthDays)}
        </div>
      </div>
    </Card>
  );
}

const HEAT_LABEL = { none: 'Not logged', under: 'Under 80% (likely incomplete)', on: 'On target', over: 'Over target' } as const;

export function StreakCard({ d }: { d: D }) {
  const [tip, setTip] = useState<string | null>(null);
  const cells = d.streak.heatmap;
  // Columns are weeks (Mon–Sun); pad the last week with future days.
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const rows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <Card title="Logging streak" testId="card-streak">
      <MiniStats
        items={[
          { k: 'Current streak', v: <span data-testid="streak-current">{d.streak.current}</span>, u: d.streak.current === 1 ? 'day' : 'days' },
          { k: 'Last 30 days', v: d.streak.daysLogged30, u: 'logged' },
        ]}
      />
      <div className="heatmap" role="grid" aria-label="Calendar of logged days, last 12 weeks" data-testid="heatmap">
        {rows.map((r, ri) => (
          <div key={r} style={{ display: 'contents' }} role="row">
            <span style={{ alignSelf: 'center' }}>{ri % 2 === 0 ? r : ''}</span>
            {Array.from({ length: 12 }, (_, wi) => {
              const c = weeks[wi]?.[ri];
              if (!c) return <span key={wi} className="cell" data-state="future" />;
              const text = `${fullDate(c.date)}: ${HEAT_LABEL[c.state]}${c.state !== 'none' ? `, ${kcal(c.kcal)} kcal` : ''}`;
              return (
                <button
                  key={wi}
                  type="button"
                  role="gridcell"
                  className="cell"
                  data-state={c.state}
                  data-today={c.date === d.date}
                  aria-label={text}
                  onPointerEnter={() => setTip(text)}
                  onFocus={() => setTip(text)}
                  onClick={() => setTip(text)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat-tip" aria-live="polite">
        {tip ?? 'Tap a day for details.'}
      </div>
      <div className="legend">
        {(['on', 'over', 'under', 'none'] as const).map((s) => (
          <span className="k" key={s}>
            <span className="rect-key" style={{ background: s === 'on' ? 'var(--good)' : s === 'over' ? 'var(--critical)' : s === 'under' ? 'var(--warning)' : 'var(--surface-3)' }} />
            {HEAT_LABEL[s]}
          </span>
        ))}
      </div>
    </Card>
  );
}

export function SlotsCard({ d }: { d: D }) {
  const max = Math.max(1, ...d.slots.map((s) => s.avgKcal));
  return (
    <Card title="Meal slots" subtitle="Average calories per logged day, last 30 days" testId="card-slots">
      {d.slots.length === 0 ? (
        <p className="muted">No meals in the last 30 days.</p>
      ) : (
        <div className="bar-rows">
          {d.slots.map((s) => (
            <div className="bar-row" key={s.name} data-testid={`slot-${s.name}`}>
              <div className="top">
                <span className="key">{s.name}</span>
                <span className="val">
                  {kcal(s.avgKcal)} kcal <span className="muted">({Math.round(s.share * 100)}%)</span>
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(s.avgKcal / max) * 100}%`, background: C.kcal }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TopCard({ d }: { d: D }) {
  return (
    <Card title="Top contributors" subtitle="This month" testId="card-top">
      {d.top.byKcal.length === 0 ? (
        <p className="muted">Nothing logged this month yet.</p>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <h3 className="small muted" style={{ marginBottom: 6 }}>
              Most calories
            </h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="top-kcal">
              {d.top.byKcal.map((t) => (
                <li key={t.name}>
                  {t.name} <span className="muted">{kcal(t.kcal)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="small muted" style={{ marginBottom: 6 }}>
              Most protein
            </h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="top-protein">
              {d.top.byProtein.map((t) => (
                <li key={t.name}>
                  {t.name} <span className="muted">{num1(t.protein_g)} g</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}

