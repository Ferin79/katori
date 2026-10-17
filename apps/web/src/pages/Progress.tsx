import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { addMonths, monthOf, toDateStr, type JourneyView, type MonthView } from '@katori/shared';
import { api } from '../api';
import { axisProps, C, dayMs, first, gridProps, Legend, msToDate, niceTicks, Tip, type TipProps } from '../components/charts';
import { ChevronLeft, ChevronRight } from '../components/Icons';
import { Banner, Card, ChartCard, ErrorNote, Loading, MiniStats, Segmented, Spinner } from '../components/ui';
import { compact, dayMonth, fullDate, kcal, kg, longDate, monthName, monthShort, num1, pct, signed } from '../lib/format';
import { usePid, useProfiles } from '../profile';

function RecapCard({ pid, month }: { pid: string; month: MonthView }) {
  const qc = useQueryClient();
  const { current } = useProfiles();
  const r = month.recap;
  const request = useMutation({
    mutationFn: () => api.requestRecap(pid, month.month),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['month', pid, month.month] }),
  });
  const manual = current?.aiAccess === 'manual';
  return (
    <Card title="Monthly recap" subtitle="Written by Claude from this month's numbers" testId="recap">
      {r?.status === 'done' && (
        <p className="recap-text" data-testid="recap-text">
          {r.text}
        </p>
      )}
      {r?.status === 'pending' && (
        <div className="row" data-testid="recap-pending">
          <Spinner label="Writing recap" /> <span className="muted">Writing your recap…</span>
        </div>
      )}
      {r?.status === 'failed' && <Banner tone="error" title="The recap failed">{r.error}</Banner>}
      {manual ? (
        <p className="muted small">Recaps need AI access; this profile is manual-only.</p>
      ) : (
        r?.status !== 'pending' && (
          <button className="btn" style={{ marginTop: r ? 12 : 0 }} onClick={() => request.mutate()} disabled={request.isPending || month.averages.loggedDays === 0} data-testid="recap-request">
            {r?.status === 'done' ? 'Write it again' : 'Write my recap'}
          </button>
        )
      )}
    </Card>
  );
}

function MonthTab({ pid }: { pid: string }) {
  const thisMonth = monthOf(toDateStr(new Date()));
  const [month, setMonth] = useState(thisMonth);
  const { data: m, error, isLoading } = useQuery({
    queryKey: ['month', pid, month],
    queryFn: () => api.month(pid, month),
    refetchInterval: (q) => (q.state.data?.recap?.status === 'pending' ? 2000 : false),
  });
  const data = (m?.days ?? []).map((d) => ({ ...d, label: Number(d.date.slice(8)) }));
  const ticks = niceTicks(Math.max(0, ...data.map((d) => Math.max(d.kcal, d.targetKcal ?? 0))));
  return (
    <>
      <div className="row between">
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" data-testid="month-prev">
          <ChevronLeft />
        </button>
        <h2 data-testid="month-title">{monthName(month)}</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= thisMonth} aria-label="Next month" data-testid="month-next">
          <ChevronRight />
        </button>
      </div>
      {isLoading && <Loading />}
      {error && <ErrorNote error={error} />}
      {m && (
        <>
          <Card title="Averages" subtitle={`Over ${m.averages.loggedDays} logged day${m.averages.loggedDays === 1 ? '' : 's'}`} testId="month-averages">
            <div className="avg-hero">
              <span className="v" data-testid="month-avg-kcal">
                {kcal(m.averages.kcal)}
              </span>
              <span className="u">kcal a day</span>
              {m.targetKcal && <span className="badge">target {kcal(m.targetKcal)}</span>}
            </div>
            <MiniStats
              testId="month-macros"
              items={[
                { k: 'Protein', v: Math.round(m.averages.protein_g), u: 'g' },
                { k: 'Carbs', v: Math.round(m.averages.carbs_g), u: 'g' },
                { k: 'Fat', v: Math.round(m.averages.fat_g), u: 'g' },
                { k: 'Fiber', v: Math.round(m.averages.fiber_g), u: 'g' },
              ]}
            />
            <MiniStats
              testId="month-days"
              items={[
                { k: 'On target', v: m.daysOnTarget, u: m.daysOnTarget === 1 ? 'day' : 'days' },
                { k: 'Over', v: m.daysOver, u: m.daysOver === 1 ? 'day' : 'days' },
              ]}
            />
          </Card>
          <ChartCard
            title="Daily calories"
            testId="month-chart"
            table={{ head: ['Date', 'kcal', 'Target'], rows: m.days.map((d) => [dayMonth(d.date), d.meals ? kcal(d.kcal) : '–', kcal(d.targetKcal)]) }}
          >
            <div className="chart">
              <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval={4} />
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
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <Legend
              items={[
                { label: 'Calories eaten', colour: C.kcal, kind: 'rect' },
                { label: 'Target', colour: C.ink2, kind: 'line' },
              ]}
            />
          </ChartCard>
          <Card title="Body this month" testId="month-body">
            <dl className="kv">
              <dt>Weight</dt>
              <dd data-testid="month-weight">{m.weight.startKg != null ? `${kg(m.weight.startKg)} → ${kg(m.weight.endKg)} (${signed(m.weight.changeKg, ' kg')})` : '–'}</dd>
              <dt>Average weight</dt>
              <dd>{kg(m.weight.avgKg)}</dd>
              <dt>Waist</dt>
              <dd>{m.waist.startCm != null ? `${num1(m.waist.startCm)} → ${num1(m.waist.endCm)} cm` : '–'}</dd>
              <dt>Body fat</dt>
              <dd>{m.bodyFat.start != null ? `${pct(m.bodyFat.start)} → ${pct(m.bodyFat.end)}` : '–'}</dd>
            </dl>
          </Card>
          <RecapCard pid={pid} month={m} />
        </>
      )}
    </>
  );
}

function JourneyTab({ pid }: { pid: string }) {
  const { data: j, error, isLoading } = useQuery({ queryKey: ['journey', pid], queryFn: () => api.journey(pid) });
  if (isLoading) return <Loading />;
  if (error || !j) return <ErrorNote error={error} />;
  return <JourneyBody j={j} />;
}

function JourneyBody({ j }: { j: JourneyView }) {
  if (!j.points.length) return <p className="muted">Log or backfill weigh-ins on Body to start your journey.</p>;
  const data = j.points.map((p) => ({ ...p, t: dayMs(p.date) }));
  const values = data.flatMap((p) => [p.weightKg, p.trendKg]).concat(j.goalKg != null ? [j.goalKg] : []);
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  return (
    <>
      <Card title="Since the start" subtitle={j.startDate ? `From ${fullDate(j.startDate)}` : undefined} testId="journey-summary">
        <div className="stats">
          <div className="stat">
            <div className="label">Start</div>
            <div className="value" data-testid="journey-start">
              {kg(j.startKg)}
            </div>
          </div>
          <div className="stat">
            <div className="label">Now (trend)</div>
            <div className="value" data-testid="journey-now">
              {kg(j.currentTrendKg)}
            </div>
          </div>
          <div className="stat">
            <div className="label">Change</div>
            <div className={`value ${j.changeKg != null && j.changeKg < 0 ? 'delta-good' : ''}`} data-testid="journey-change">
              {signed(j.changeKg, ' kg')}
            </div>
          </div>
          {j.goalKg != null && (
            <div className="stat">
              <div className="label">Goal</div>
              <div className="value">{kg(j.goalKg)}</div>
              <div className="note">{j.projectedGoalDate ? `by ${longDate(j.projectedGoalDate)}` : 'no ETA yet'}</div>
            </div>
          )}
        </div>
      </Card>
      <ChartCard title="Weight journey" testId="journey-chart" table={{ head: ['Date', 'Weigh-in', 'Trend'], rows: [...j.points].reverse().map((p) => [dayMonth(p.date), kg(p.weightKg), kg(p.trendKg)]) }}>
        <div className="chart chart-tall">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={msToDate} {...axisProps} minTickGap={28} />
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
              {j.goalKg != null && <ReferenceLine y={j.goalKg} stroke={C.ink2} strokeWidth={1} label={{ value: `Goal ${j.goalKg} kg`, position: 'insideBottomRight', fill: C.ink2, fontSize: 11 }} />}
              <Scatter dataKey="weightKg" fill={C.neutral} isAnimationActive={false} shape={(props: { cx?: number; cy?: number }) => <circle cx={props.cx} cy={props.cy} r={3} fill={C.neutral} />} />
              <defs>
                <linearGradient id="wfill-journey" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.weight} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.weight} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area dataKey="trendKg" type="monotone" stroke="none" fill="url(#wfill-journey)" isAnimationActive={false} activeDot={false} />
              <Line dataKey="trendKg" type="monotone" stroke={C.weight} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legend
          items={[
            { label: 'Trend (smoothed)', colour: C.weight, kind: 'line' },
            { label: 'Weigh-in', colour: C.neutral, kind: 'dot' },
          ]}
        />
      </ChartCard>
      <Card title="Monthly averages" testId="journey-months">
        <table className="data">
          <thead>
            <tr>
              <th>Month</th>
              <th>Weight</th>
              <th>Calories</th>
              <th>Days</th>
              <th>Waist</th>
            </tr>
          </thead>
          <tbody>
            {[...j.months].reverse().map((m) => (
              <tr key={m.month} data-testid={`journey-month-${m.month}`}>
                <td>
                  {monthShort(m.month)} {m.month.slice(2, 4)}
                </td>
                <td>{m.avgWeightKg != null ? num1(m.avgWeightKg) : '–'}</td>
                <td>{m.avgKcal != null ? kcal(m.avgKcal) : '–'}</td>
                <td>{m.loggedDays}</td>
                <td>{m.avgWaistCm != null ? num1(m.avgWaistCm) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export function Progress() {
  const pid = usePid();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'journey' ? 'journey' : 'month';
  return (
    <>
      <div className="page-head">
        <h1>Progress</h1>
      </div>
      <Segmented
        label="View"
        testId="progress-view"
        value={view}
        onChange={(v) => setParams(v === 'journey' ? { view: 'journey' } : {}, { replace: true })}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'journey', label: 'Journey' },
        ]}
      />
      {view === 'month' ? <MonthTab pid={pid} /> : <JourneyTab pid={pid} />}
    </>
  );
}
